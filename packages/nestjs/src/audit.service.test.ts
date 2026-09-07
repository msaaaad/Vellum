import { describe, expect, it, vi } from 'vitest';
import type { PendingAuditEvent, StoragePort } from '@vellum/core';
import { GENESIS_HASH } from '@vellum/core';
import { AuditWriter } from './audit-writer.service.js';
import { AuditService } from './audit.service.js';
import { withAuditContext } from './context.js';
import type { AuditModuleOptions } from './types.js';

function fakeStorage(): StoragePort<unknown> {
  return {
    head: vi.fn().mockResolvedValue(null),
    appendInline: vi.fn(async (event: PendingAuditEvent) => ({
      ...event,
      seq: 1,
      prevHash: GENESIS_HASH,
      rowHash: 'x'.repeat(64),
    })),
    readRange: vi.fn().mockResolvedValue([]),
    enqueue: vi.fn().mockResolvedValue(undefined),
    drainOutbox: vi.fn().mockResolvedValue([]),
  };
}

function baseOptions(overrides: Partial<AuditModuleOptions> = {}): AuditModuleOptions {
  return {
    storage: { adapter: 'pg', pool: {} as never },
    tenantResolver: () => 't1',
    actorResolver: () => ({ id: 'u1', type: 'user', label: null }),
    ...overrides,
  };
}

const ctx = {
  tenantId: 't1',
  actor: { id: 'u1', type: 'user' as const, label: 'sam@x.io' },
  requestMeta: { ip: null, userAgent: null, requestId: null, route: null },
};

describe('AuditService.record', () => {
  it('throws when called with no audit context', async () => {
    const storage = fakeStorage();
    const service = new AuditService(new AuditWriter(storage, baseOptions()), baseOptions());
    await expect(service.record({ action: 'thing.done', entity: 'Thing' })).rejects.toThrow(
      /no audit context/,
    );
  });

  it('fills tenantId/actor from context and never takes them as parameters', async () => {
    const storage = fakeStorage();
    const service = new AuditService(new AuditWriter(storage, baseOptions()), baseOptions());

    await withAuditContext(ctx, () =>
      service.record({
        action: 'claim.submitted',
        entity: 'Claim',
        entityId: 'c1',
        changes: { after: { amount: 5 } },
      }),
    );

    expect(storage.appendInline).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        actor: ctx.actor,
        action: 'claim.submitted',
        entity: { type: 'Claim', id: 'c1' },
        changes: { after: { amount: 5 } },
      }),
    );
  });

  it('applies the global redact list to changes and metadata', async () => {
    // The redact list applies to `changes`/`metadata` as the caller shaped them — no implicit
    // `after.`/`before.` prefixing — so a nested field needs its full path, e.g. `'after.secret'`.
    const storage = fakeStorage();
    const service = new AuditService(
      new AuditWriter(storage, baseOptions({ redact: ['after.secret', 'secret'] })),
      baseOptions({ redact: ['after.secret', 'secret'] }),
    );

    await withAuditContext(ctx, () =>
      service.record({
        action: 'thing.done',
        entity: 'Thing',
        changes: { after: { secret: 'shh', kept: 1 } },
        metadata: { secret: 'shh', reason: 'because' },
      }),
    );

    expect(storage.appendInline).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { after: { kept: 1 } },
        metadata: { reason: 'because' },
      }),
    );
  });
});

describe('AuditService.enqueue', () => {
  it('writes to the outbox via the caller-supplied tx, atomic with their own transaction', async () => {
    const storage = fakeStorage();
    const service = new AuditService(new AuditWriter(storage, baseOptions()), baseOptions());
    const tx = { fakeTx: true };

    await withAuditContext(ctx, () =>
      service.enqueue(tx, { action: 'claim.submitted', entity: 'Claim', entityId: 'c1' }),
    );

    expect(storage.enqueue).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ tenantId: 't1', action: 'claim.submitted' }),
    );
  });

  it('throws when called with no audit context', async () => {
    const storage = fakeStorage();
    const service = new AuditService(new AuditWriter(storage, baseOptions()), baseOptions());
    await expect(
      service.enqueue({}, { action: 'claim.submitted', entity: 'Claim' }),
    ).rejects.toThrow(/no audit context/);
  });
});
