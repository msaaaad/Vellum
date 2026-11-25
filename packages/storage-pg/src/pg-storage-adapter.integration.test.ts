import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GENESIS_HASH, verifyChain, type PendingAuditEvent } from '@attestly/core';
import { connectionStringFor, TEST_DATABASE_URL } from './test/db.js';
import { PgStorageAdapter } from './pg-storage-adapter.js';
import { readMigrationSql } from './migration.js';

function buildEvent(
  tenantId: string,
  overrides: Partial<PendingAuditEvent> = {},
): PendingAuditEvent {
  return {
    hashVersion: 1,
    tenantId,
    occurredAt: new Date().toISOString(),
    actor: { id: '00000000-0000-4000-8000-000000000002', type: 'user', label: 'sam@x.io' },
    action: 'thing.done',
    entity: { type: 'Thing', id: '00000000-0000-4000-8000-000000000003' },
    changes: {},
    metadata: {},
    ...overrides,
  };
}

describe('PgStorageAdapter (integration)', () => {
  let appPool: Pool;
  let adapter: PgStorageAdapter;

  beforeAll(() => {
    appPool = new Pool({ connectionString: connectionStringFor('vellum_app') });
    adapter = new PgStorageAdapter(appPool);
  });

  afterAll(async () => {
    await appPool.end();
  });

  it('appendInline + head + readRange round-trip into a verifiable chain', async () => {
    const tenantId = randomUUID();

    await adapter.appendInline(buildEvent(tenantId, { action: 'tenant.created' }));
    await adapter.appendInline(buildEvent(tenantId, { action: 'participant.created' }));
    const third = await adapter.appendInline(
      buildEvent(tenantId, { action: 'participant.updated' }),
    );

    const head = await adapter.head(tenantId);
    expect(head).toEqual({ seq: 3, rowHash: third.rowHash });

    const rows = await adapter.readRange(tenantId);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);

    const result = verifyChain(rows);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
    expect(result.head).toBe(third.rowHash);
  });

  it('readRange respects fromSeq/toSeq', async () => {
    const tenantId = randomUUID();
    await adapter.appendInline(buildEvent(tenantId, { action: 'a' }));
    await adapter.appendInline(buildEvent(tenantId, { action: 'b' }));
    await adapter.appendInline(buildEvent(tenantId, { action: 'c' }));

    const middle = await adapter.readRange(tenantId, { fromSeq: 2, toSeq: 2 });
    expect(middle).toHaveLength(1);
    expect(middle[0]!.action).toBe('b');
  });

  it('a committed business transaction: enqueue lands, and the worker (drainOutbox) chains it into a real event', async () => {
    const tenantId = randomUUID();
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('vellum.tenant_id', $1, true)", [tenantId]);
      await adapter.enqueue(client, buildEvent(tenantId, { action: 'outbox.one' }));
      await adapter.enqueue(client, buildEvent(tenantId, { action: 'outbox.two' }));
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const beforeDrain = await appPool.query('SELECT 1 FROM audit_outbox WHERE tenant_id = $1', [
      tenantId,
    ]);
    expect(beforeDrain.rowCount).toBe(2);
    expect(await adapter.readRange(tenantId)).toHaveLength(0);

    const drained = await adapter.drainOutbox(tenantId, 100);
    expect(drained.map((r) => [r.seq, r.action])).toEqual([
      [1, 'outbox.one'],
      [2, 'outbox.two'],
    ]);
    expect(verifyChain(drained).ok).toBe(true);

    const rows = await adapter.readRange(tenantId);
    expect(rows).toHaveLength(2);

    const remaining = await appPool.query('SELECT 1 FROM audit_outbox WHERE tenant_id = $1', [
      tenantId,
    ]);
    expect(remaining.rowCount).toBe(0);
  });

  it('a rolled-back business transaction leaves no outbox row and no audit event (atomicity)', async () => {
    const tenantId = randomUUID();
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('vellum.tenant_id', $1, true)", [tenantId]);
      await adapter.enqueue(client, buildEvent(tenantId, { action: 'never.happened' }));
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const outboxRow = await appPool.query('SELECT 1 FROM audit_outbox WHERE tenant_id = $1', [
      tenantId,
    ]);
    expect(outboxRow.rowCount).toBe(0);

    const drained = await adapter.drainOutbox(tenantId, 100);
    expect(drained).toEqual([]);
    expect(await adapter.readRange(tenantId)).toHaveLength(0);
  });

  it('parallel appends across tenants stay independent; within a tenant, order is preserved', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();

    const enqueueAll = async (tenantId: string, actions: string[]) => {
      for (const action of actions) {
        await adapter.enqueue(undefined, buildEvent(tenantId, { action }));
      }
    };
    await Promise.all([
      enqueueAll(tenantA, ['a.1', 'a.2', 'a.3']),
      enqueueAll(tenantB, ['b.1', 'b.2']),
    ]);

    const [drainedA, drainedB] = await Promise.all([
      adapter.drainOutbox(tenantA, 100),
      adapter.drainOutbox(tenantB, 100),
    ]);

    expect(drainedA.map((r) => r.action)).toEqual(['a.1', 'a.2', 'a.3']);
    expect(drainedB.map((r) => r.action)).toEqual(['b.1', 'b.2']);
    expect(verifyChain(drainedA).ok).toBe(true);
    expect(verifyChain(drainedB).ok).toBe(true);

    const rowsA = await adapter.readRange(tenantA);
    const rowsB = await adapter.readRange(tenantB);
    expect(rowsA.every((r) => r.tenantId === tenantA)).toBe(true);
    expect(rowsB.every((r) => r.tenantId === tenantB)).toBe(true);
  });

  it('enqueue without a tx does a standalone insert (the outbox-mode fire-and-forget path)', async () => {
    const tenantId = randomUUID();
    await adapter.enqueue(undefined, buildEvent(tenantId, { action: 'outbox.standalone' }));

    const drained = await adapter.drainOutbox(tenantId, 100);
    expect(drained.map((r) => r.action)).toEqual(['outbox.standalone']);
  });

  it('listOutboxTenants finds pending tenants oldest-enqueued first, and forgets drained ones', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();

    await adapter.enqueue(undefined, buildEvent(tenantA, { action: 'a.one' }));
    await new Promise((r) => setTimeout(r, 5));
    await adapter.enqueue(undefined, buildEvent(tenantB, { action: 'b.one' }));

    const pending = await adapter.listOutboxTenants(100);
    expect(pending).toContain(tenantA);
    expect(pending).toContain(tenantB);
    expect(pending.indexOf(tenantA)).toBeLessThan(pending.indexOf(tenantB));

    await adapter.drainOutbox(tenantA, 100);
    await adapter.drainOutbox(tenantB, 100);

    const afterDrain = await adapter.listOutboxTenants(100);
    expect(afterDrain).not.toContain(tenantA);
    expect(afterDrain).not.toContain(tenantB);
  });

  describe('recordCheckpoint', () => {
    it('records the current head for external anchoring - ARCHITECTURE.md section 7', async () => {
      const tenantId = randomUUID();
      await adapter.appendInline(buildEvent(tenantId, { action: 'a' }));
      await adapter.appendInline(buildEvent(tenantId, { action: 'b' }));
      const third = await adapter.appendInline(buildEvent(tenantId, { action: 'c' }));

      const checkpoint = await adapter.recordCheckpoint(
        tenantId,
        's3://evidence-bucket/2026-09-16',
      );
      expect(checkpoint).toMatchObject({
        tenantId,
        headSeq: 3,
        headHash: third.rowHash,
        anchoredRef: 's3://evidence-bucket/2026-09-16',
      });
      expect(checkpoint.id).toEqual(expect.any(String));
    });

    it('checkpoints an empty chain at the genesis hash', async () => {
      const tenantId = randomUUID();
      const checkpoint = await adapter.recordCheckpoint(tenantId, null);
      expect(checkpoint).toMatchObject({
        tenantId,
        headSeq: 0,
        headHash: GENESIS_HASH,
        anchoredRef: null,
      });
    });
  });

  it('the migration is safe to re-run against an already-migrated database', async () => {
    const superuser = new Client({ connectionString: TEST_DATABASE_URL });
    await superuser.connect();
    try {
      await expect(superuser.query(readMigrationSql())).resolves.toBeDefined();
    } finally {
      await superuser.end();
    }

    const tenantId = randomUUID();
    await adapter.appendInline(buildEvent(tenantId));
    expect(await adapter.readRange(tenantId)).toHaveLength(1);
  });

  describe('RLS tenant isolation', () => {
    it('blocks a cross-tenant SELECT at the database layer', async () => {
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      await adapter.appendInline(buildEvent(tenantA, { action: 'secret.for.a' }));

      const client = new Client({ connectionString: connectionStringFor('vellum_app') });
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('vellum.tenant_id', $1, true)", [tenantA]);
        const ownRows = await client.query('SELECT * FROM audit_events WHERE tenant_id = $1', [
          tenantA,
        ]);
        expect(ownRows.rowCount).toBe(1);
        await client.query('COMMIT');

        await client.query('BEGIN');
        await client.query("SELECT set_config('vellum.tenant_id', $1, true)", [tenantB]);
        const crossTenantRows = await client.query(
          'SELECT * FROM audit_events WHERE tenant_id = $1',
          [tenantA],
        );
        expect(crossTenantRows.rowCount).toBe(0);
        await client.query('COMMIT');
      } finally {
        await client.end();
      }
    });
  });

  describe('append-only enforcement', () => {
    it('rejects UPDATE/DELETE from the app role (grants revoked)', async () => {
      const tenantId = randomUUID();
      await adapter.appendInline(buildEvent(tenantId));

      const client = new Client({ connectionString: connectionStringFor('vellum_app') });
      await client.connect();
      try {
        await expect(
          client.query("UPDATE audit_events SET action = 'x' WHERE tenant_id = $1", [tenantId]),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          client.query('DELETE FROM audit_events WHERE tenant_id = $1', [tenantId]),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await client.end();
      }
    });

    it('rejects UPDATE/DELETE even from a superuser connection (the trigger itself)', async () => {
      const tenantId = randomUUID();
      await adapter.appendInline(buildEvent(tenantId));

      const client = new Client({ connectionString: TEST_DATABASE_URL });
      await client.connect();
      try {
        await expect(
          client.query("UPDATE audit_events SET action = 'x' WHERE tenant_id = $1", [tenantId]),
        ).rejects.toThrow(/append-only/i);
        await expect(
          client.query('DELETE FROM audit_events WHERE tenant_id = $1', [tenantId]),
        ).rejects.toThrow(/append-only/i);
      } finally {
        await client.end();
      }
    });
  });
});
