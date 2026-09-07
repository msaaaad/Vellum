import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyChain, type PendingAuditEvent } from '@vellum/core';
import { connectionStringFor, TEST_DATABASE_URL } from './test/db.js';
import { PgStorageAdapter } from './pg-storage-adapter.js';

function buildEvent(
  tenantId: string,
  overrides: Partial<PendingAuditEvent> = {},
): PendingAuditEvent {
  return {
    hashVersion: 1,
    tenantId,
    occurredAt: new Date().toISOString(),
    actor: { id: 'u1', type: 'user', label: 'sam@x.io' },
    action: 'thing.done',
    entity: { type: 'Thing', id: 't-1' },
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

    // Before the worker runs: the outbox row exists, but there's no audit event yet.
    const beforeDrain = await appPool.query('SELECT 1 FROM audit_outbox WHERE tenant_id = $1', [
      tenantId,
    ]);
    expect(beforeDrain.rowCount).toBe(2);
    expect(await adapter.readRange(tenantId)).toHaveLength(0);

    // The worker runs (drainOutbox is what AuditOutboxWorker's drain tick calls per tenant).
    const drained = await adapter.drainOutbox(tenantId);
    expect(drained.map((r) => [r.seq, r.action])).toEqual([
      [1, 'outbox.one'],
      [2, 'outbox.two'],
    ]);
    expect(verifyChain(drained).ok).toBe(true);

    const rows = await adapter.readRange(tenantId);
    expect(rows).toHaveLength(2);

    // audit_outbox has no RLS, so no tenant context needs to be set for this check.
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
      await client.query('ROLLBACK'); // business tx failed after enqueue — everything unwinds
    } finally {
      client.release();
    }

    const outboxRow = await appPool.query('SELECT 1 FROM audit_outbox WHERE tenant_id = $1', [
      tenantId,
    ]);
    expect(outboxRow.rowCount).toBe(0);

    const drained = await adapter.drainOutbox(tenantId);
    expect(drained).toEqual([]);
    expect(await adapter.readRange(tenantId)).toHaveLength(0);
  });

  it('parallel appends across tenants stay independent; within a tenant, order is preserved', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();

    // Interleave enqueues for two tenants concurrently — nothing here should let one tenant's
    // events land in the other's chain, or reorder a tenant's own events relative to each other.
    await Promise.all([
      adapter.enqueue(undefined, buildEvent(tenantA, { action: 'a.1' })),
      adapter.enqueue(undefined, buildEvent(tenantB, { action: 'b.1' })),
      adapter.enqueue(undefined, buildEvent(tenantA, { action: 'a.2' })),
      adapter.enqueue(undefined, buildEvent(tenantB, { action: 'b.2' })),
      adapter.enqueue(undefined, buildEvent(tenantA, { action: 'a.3' })),
    ]);

    // Draining two different tenants concurrently is exactly what happens when a drain tick
    // processes several pending tenants — ARCHITECTURE.md §5 "cross-tenant: fully parallel".
    const [drainedA, drainedB] = await Promise.all([
      adapter.drainOutbox(tenantA),
      adapter.drainOutbox(tenantB),
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

    const drained = await adapter.drainOutbox(tenantId);
    expect(drained.map((r) => r.action)).toEqual(['outbox.standalone']);
  });

  it('listOutboxTenants finds pending tenants oldest-enqueued first, and forgets drained ones', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();

    await adapter.enqueue(undefined, buildEvent(tenantA, { action: 'a.one' }));
    await new Promise((r) => setTimeout(r, 5));
    await adapter.enqueue(undefined, buildEvent(tenantB, { action: 'b.one' }));

    const pending = await adapter.listOutboxTenants();
    expect(pending).toContain(tenantA);
    expect(pending).toContain(tenantB);
    expect(pending.indexOf(tenantA)).toBeLessThan(pending.indexOf(tenantB));

    await adapter.drainOutbox(tenantA);
    await adapter.drainOutbox(tenantB);

    const afterDrain = await adapter.listOutboxTenants();
    expect(afterDrain).not.toContain(tenantA);
    expect(afterDrain).not.toContain(tenantB);
  });

  describe('RLS tenant isolation', () => {
    it('blocks a cross-tenant SELECT at the database layer', async () => {
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      await adapter.appendInline(buildEvent(tenantA, { action: 'secret.for.a' }));

      const client = new Client({ connectionString: connectionStringFor('vellum_app') });
      await client.connect();
      try {
        // Positive control: tenant A's own context can see its row.
        await client.query('BEGIN');
        await client.query("SELECT set_config('vellum.tenant_id', $1, true)", [tenantA]);
        const ownRows = await client.query('SELECT * FROM audit_events WHERE tenant_id = $1', [
          tenantA,
        ]);
        expect(ownRows.rowCount).toBe(1);
        await client.query('COMMIT');

        // Tenant B's context must not see tenant A's row, even asking for it by id directly.
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
