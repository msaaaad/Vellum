import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyChain, type PendingAuditEvent } from '@getattestly/core';
import { PgStorageAdapter } from '@getattestly/storage-pg';
import { PrismaStorageAdapter, type PrismaQueryable } from './prisma-storage-adapter.js';

const ADMIN_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/vellum_test';
const TEST_ROLE_PASSWORD = 'vellum_test_only';

function urlFor(role: string): string {
  const url = new URL(ADMIN_URL);
  url.username = role;
  url.password = TEST_ROLE_PASSWORD;
  return url.toString();
}

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
    changes: { name: { from: 'a', to: 'b' } },
    metadata: { reason: 'because' },
    ...overrides,
  };
}

describe('PrismaStorageAdapter (integration)', () => {
  let prisma: PrismaClient;
  let adapter: PrismaStorageAdapter;
  let pgPool: Pool;
  let pgAdapter: PgStorageAdapter;

  beforeAll(() => {
    prisma = new PrismaClient({ datasourceUrl: urlFor('vellum_app') });
    adapter = new PrismaStorageAdapter(prisma);
    pgPool = new Pool({ connectionString: urlFor('vellum_app') });
    pgAdapter = new PgStorageAdapter(pgPool);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pgPool.end();
  });

  it('appendInline + head + readRange round-trip into a verifiable chain', async () => {
    const tenantId = randomUUID();
    await adapter.appendInline(buildEvent(tenantId, { action: 'tenant.created' }));
    await adapter.appendInline(buildEvent(tenantId, { action: 'participant.created' }));
    const third = await adapter.appendInline(
      buildEvent(tenantId, { action: 'participant.updated' }),
    );

    expect(await adapter.head(tenantId)).toEqual({ seq: 3, rowHash: third.rowHash });
    expect(await adapter.head(randomUUID())).toBeNull();

    const rows = await adapter.readRange(tenantId);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    const result = verifyChain(rows);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
    expect(result.head).toBe(third.rowHash);
  });

  it('parity: rows written by one adapter read back identically through the other', async () => {
    const tenantId = randomUUID();
    await adapter.appendInline(buildEvent(tenantId, { action: 'a.one' }));
    await pgAdapter.appendInline(buildEvent(tenantId, { action: 'a.two' }));
    await adapter.appendInline(buildEvent(tenantId, { action: 'a.three' }));

    const viaPrisma = await adapter.readRange(tenantId);
    const viaPg = await pgAdapter.readRange(tenantId);
    expect(viaPrisma).toEqual(viaPg);
    expect(verifyChain(viaPrisma).ok).toBe(true);
    expect(viaPrisma.map((r) => r.action)).toEqual(['a.one', 'a.two', 'a.three']);
  });

  it('readRange respects fromSeq/toSeq', async () => {
    const tenantId = randomUUID();
    for (let i = 0; i < 5; i++) await adapter.appendInline(buildEvent(tenantId));
    const rows = await adapter.readRange(tenantId, { fromSeq: 2, toSeq: 4 });
    expect(rows.map((r) => r.seq)).toEqual([2, 3, 4]);
  });

  it('a committed business transaction: enqueue lands, and drainOutbox chains it', async () => {
    const tenantId = randomUUID();
    await prisma.$transaction(async (tx) => {
      await adapter.enqueue(tx as PrismaQueryable, buildEvent(tenantId, { action: 'outbox.one' }));
      await adapter.enqueue(tx as PrismaQueryable, buildEvent(tenantId, { action: 'outbox.two' }));
    });

    expect(await adapter.readRange(tenantId)).toHaveLength(0);
    expect(await adapter.listOutboxTenants(1000)).toContain(tenantId);

    const drained = await adapter.drainOutbox(tenantId, 100);
    expect(drained.map((r) => [r.seq, r.action])).toEqual([
      [1, 'outbox.one'],
      [2, 'outbox.two'],
    ]);
    expect(verifyChain(drained).ok).toBe(true);
    expect(await adapter.readRange(tenantId)).toHaveLength(2);
    expect(await adapter.listOutboxTenants(1000)).not.toContain(tenantId);
    expect(await adapter.drainOutbox(tenantId, 100)).toEqual([]);
  });

  it('a rolled-back business transaction leaves no outbox row and no audit event (atomicity)', async () => {
    const tenantId = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await adapter.enqueue(tx as PrismaQueryable, buildEvent(tenantId));
        throw new Error('business logic failed after enqueue');
      }),
    ).rejects.toThrow('business logic failed');

    expect(await adapter.drainOutbox(tenantId, 100)).toEqual([]);
    expect(await adapter.readRange(tenantId)).toHaveLength(0);
    expect(await adapter.listOutboxTenants(1000)).not.toContain(tenantId);
  });

  it('enqueue without a tx does a standalone insert', async () => {
    const tenantId = randomUUID();
    await adapter.enqueue(undefined, buildEvent(tenantId, { action: 'standalone' }));
    const drained = await adapter.drainOutbox(tenantId, 100);
    expect(drained.map((r) => r.action)).toEqual(['standalone']);
  });

  it('parallel appends within a tenant serialize into one gap-free chain; tenants stay independent', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => [
        adapter.appendInline(buildEvent(tenantA, { action: `a.${i}` })),
        adapter.appendInline(buildEvent(tenantB, { action: `b.${i}` })),
      ]).flat(),
    );
    for (const t of [tenantA, tenantB]) {
      const rows = await adapter.readRange(t);
      expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(verifyChain(rows).ok).toBe(true);
    }
  });

  it('recordCheckpoint records the head (and genesis for an empty chain)', async () => {
    const tenantId = randomUUID();
    const empty = await adapter.recordCheckpoint(tenantId, null);
    expect(empty.headSeq).toBe(0);
    expect(empty.headHash).toBe('0'.repeat(64));

    const last = await adapter.appendInline(buildEvent(tenantId));
    const cp = await adapter.recordCheckpoint(tenantId, 'ref://anchor/1');
    expect(cp).toMatchObject({
      tenantId,
      headSeq: 1,
      headHash: last.rowHash,
      anchoredRef: 'ref://anchor/1',
    });
    expect(typeof cp.createdAt).toBe('string');
  });

  it('RLS: a different tenant context cannot see another tenant rows', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await adapter.appendInline(buildEvent(tenantA));

    const seenByB = await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe("SELECT set_config('vellum.tenant_id', $1, true)", tenantB);
      return tx.$queryRawUnsafe<unknown[]>(
        'SELECT 1 FROM audit_events WHERE tenant_id = $1::uuid',
        tenantA,
      );
    });
    expect(seenByB).toHaveLength(0);
  });

  it('append-only: the app role cannot UPDATE or DELETE', async () => {
    const tenantId = randomUUID();
    await adapter.appendInline(buildEvent(tenantId));
    await expect(
      prisma.$executeRawUnsafe(
        "UPDATE audit_events SET action = 'x' WHERE tenant_id = $1::uuid",
        tenantId,
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      prisma.$executeRawUnsafe('DELETE FROM audit_events WHERE tenant_id = $1::uuid', tenantId),
    ).rejects.toThrow(/permission denied/i);
  });
});
