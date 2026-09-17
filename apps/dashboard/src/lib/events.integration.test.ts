import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { PendingAuditEvent } from '@vellum/core';
import { PgStorageAdapter } from '@vellum/storage-pg';
import { queryEvents } from './events';
import { connectionStringFor } from './test/db';

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

describe('queryEvents (integration)', () => {
  const appPool = new Pool({ connectionString: connectionStringFor('vellum_app') });
  const readonlyPool = new Pool({ connectionString: connectionStringFor('vellum_readonly') });
  const adapter = new PgStorageAdapter(appPool);

  afterAll(async () => {
    await appPool.end();
    await readonlyPool.end();
  });

  it('reads through the read-only role and filters by entity/actor/action/date', async () => {
    const tenantId = randomUUID();
    await adapter.appendInline(
      buildEvent(tenantId, {
        action: 'participant.created',
        entity: { type: 'Participant', id: 'p1' },
      }),
    );
    await adapter.appendInline(
      buildEvent(tenantId, {
        action: 'consent.granted',
        entity: { type: 'Consent', id: 'c1' },
        actor: { id: 'u2', type: 'user', label: null },
      }),
    );
    await adapter.appendInline(
      buildEvent(tenantId, { action: 'consent.revoked', entity: { type: 'Consent', id: 'c1' } }),
    );

    const all = await queryEvents(readonlyPool, tenantId);
    expect(all).toHaveLength(3);
    expect(all.map((e) => e.seq)).toEqual([3, 2, 1]); // seq DESC — most recent first

    const byEntity = await queryEvents(readonlyPool, tenantId, { entityType: 'Consent' });
    expect(byEntity.map((e) => e.action)).toEqual(['consent.revoked', 'consent.granted']);

    const byActor = await queryEvents(readonlyPool, tenantId, { actorId: 'u2' });
    expect(byActor.map((e) => e.action)).toEqual(['consent.granted']);

    const byAction = await queryEvents(readonlyPool, tenantId, { action: 'participant.created' });
    expect(byAction.map((e) => e.entityId)).toEqual(['p1']);
  });

  it("never returns another tenant's rows, even without an explicit filter for it", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await adapter.appendInline(buildEvent(tenantA, { action: 'secret.for.a' }));
    await adapter.appendInline(buildEvent(tenantB, { action: 'secret.for.b' }));

    const rowsForA = await queryEvents(readonlyPool, tenantA);
    expect(rowsForA.map((e) => e.action)).toEqual(['secret.for.a']);
  });

  it('respects limit/offset for pagination', async () => {
    const tenantId = randomUUID();
    for (let i = 0; i < 5; i += 1) {
      await adapter.appendInline(buildEvent(tenantId, { action: `thing.${i}` }));
    }

    const page1 = await queryEvents(readonlyPool, tenantId, { limit: 2, offset: 0 });
    const page2 = await queryEvents(readonlyPool, tenantId, { limit: 2, offset: 2 });
    expect(page1.map((e) => e.seq)).toEqual([5, 4]);
    expect(page2.map((e) => e.seq)).toEqual([3, 2]);
  });
});
