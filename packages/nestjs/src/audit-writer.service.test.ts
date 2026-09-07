import { describe, expect, it, vi } from 'vitest';
import type { ChainRow, PendingAuditEvent, StoragePort } from '@vellum/core';
import { GENESIS_HASH } from '@vellum/core';
import { AuditWriter } from './audit-writer.service.js';
import type { AuditModuleOptions } from './types.js';

function fakeStorage(overrides: Partial<StoragePort<unknown>> = {}): StoragePort<unknown> {
  return {
    head: vi.fn().mockResolvedValue(null),
    appendInline: vi.fn(async (event: PendingAuditEvent): Promise<ChainRow> => ({
      ...event,
      seq: 1,
      prevHash: GENESIS_HASH,
      rowHash: 'x'.repeat(64),
    })),
    readRange: vi.fn().mockResolvedValue([]),
    enqueue: vi.fn().mockResolvedValue(undefined),
    drainOutbox: vi.fn().mockResolvedValue([]),
    listOutboxTenants: vi.fn().mockResolvedValue([]),
    ...overrides,
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

const pendingInput = {
  tenantId: 't1',
  actor: { id: 'u1', type: 'user' as const, label: null },
  action: 'thing.done',
  entity: { type: 'Thing', id: 't-1' },
  changes: { after: { x: 1 } },
  metadata: {},
};

describe('AuditWriter.buildPending', () => {
  it('defaults hashVersion to 1 and stamps occurredAt from the clock', () => {
    const clock = () => new Date('2026-01-01T00:00:00.000Z');
    const writer = new AuditWriter(fakeStorage(), baseOptions({ clock }));
    const pending = writer.buildPending(pendingInput);
    expect(pending.hashVersion).toBe(1);
    expect(pending.occurredAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('honours a configured hash version', () => {
    const writer = new AuditWriter(fakeStorage(), baseOptions({ hash: { version: 2 } }));
    expect(writer.buildPending(pendingInput).hashVersion).toBe(2);
  });
});

describe('AuditWriter.write', () => {
  it('appends inline by default', async () => {
    const storage = fakeStorage();
    const writer = new AuditWriter(storage, baseOptions());
    const pending = writer.buildPending(pendingInput);
    const row = await writer.write(pending);
    expect(storage.appendInline).toHaveBeenCalledWith(pending);
    expect(row).toMatchObject({ action: 'thing.done' });
  });

  it('rethrows a storage failure when no onError hook is configured', async () => {
    const storage = fakeStorage({ appendInline: vi.fn().mockRejectedValue(new Error('db down')) });
    const writer = new AuditWriter(storage, baseOptions());
    await expect(writer.write(writer.buildPending(pendingInput))).rejects.toThrow('db down');
  });

  it('routes a storage failure to onError instead of throwing when configured', async () => {
    const onError = vi.fn();
    const storage = fakeStorage({ appendInline: vi.fn().mockRejectedValue(new Error('db down')) });
    const writer = new AuditWriter(storage, baseOptions({ onError }));
    await expect(writer.write(writer.buildPending(pendingInput))).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'thing.done' }),
    );
  });

  it("mode: 'outbox' queues a standalone (no tx) outbox row instead of appending inline", async () => {
    const storage = fakeStorage();
    const writer = new AuditWriter(storage, baseOptions({ mode: 'outbox' }));
    const pending = writer.buildPending(pendingInput);

    const result = await writer.write(pending);

    expect(storage.enqueue).toHaveBeenCalledWith(undefined, pending);
    expect(storage.appendInline).not.toHaveBeenCalled();
    // No ChainRow yet — AuditOutboxWorker assigns seq/prevHash/rowHash when it drains this later.
    expect(result).toBeUndefined();
  });

  it('routes an outbox-mode enqueue failure to onError instead of throwing when configured', async () => {
    const onError = vi.fn();
    const storage = fakeStorage({ enqueue: vi.fn().mockRejectedValue(new Error('db down')) });
    const writer = new AuditWriter(storage, baseOptions({ mode: 'outbox', onError }));
    await expect(writer.write(writer.buildPending(pendingInput))).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'thing.done' }),
    );
  });
});

describe('AuditWriter.enqueue', () => {
  it('delegates straight to storage.enqueue with the caller-supplied tx', async () => {
    const storage = fakeStorage();
    const writer = new AuditWriter(storage, baseOptions());
    const tx = { fake: 'tx' };
    const pending = writer.buildPending(pendingInput);
    await writer.enqueue(tx, pending);
    expect(storage.enqueue).toHaveBeenCalledWith(tx, pending);
  });
});
