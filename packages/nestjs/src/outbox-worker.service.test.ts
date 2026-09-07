import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainRow, PendingAuditEvent, StoragePort } from '@vellum/core';
import { GENESIS_HASH } from '@vellum/core';
import { AuditOutboxWorker } from './outbox-worker.service.js';
import type { AuditModuleOptions } from './types.js';

// `bullmq` opens a real Redis connection as soon as a Queue/Worker is constructed, so it's
// mocked out entirely — these tests exercise our own wiring/dispatch logic, not BullMQ itself
// or a real Redis. `pollMs`/retry-and-backoff options are asserted on the mock call, not by
// actually waiting for a timer to fire.
const addMock = vi.fn().mockResolvedValue(undefined);
const queueCloseMock = vi.fn().mockResolvedValue(undefined);
const workerCloseMock = vi.fn().mockResolvedValue(undefined);
const workerOnMock = vi.fn();
let lastQueueArgs: unknown[] = [];
let lastWorkerArgs: unknown[] = [];

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation((...args: unknown[]) => {
    lastQueueArgs = args;
    return { add: addMock, close: queueCloseMock };
  }),
  Worker: vi.fn().mockImplementation((...args: unknown[]) => {
    lastWorkerArgs = args;
    return { on: workerOnMock, close: workerCloseMock };
  }),
}));

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

beforeEach(() => {
  addMock.mockClear();
  queueCloseMock.mockClear();
  workerCloseMock.mockClear();
  workerOnMock.mockClear();
  lastQueueArgs = [];
  lastWorkerArgs = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AuditOutboxWorker.onModuleInit', () => {
  it("does nothing for mode: 'inline' (the default) — no Queue/Worker constructed", async () => {
    const worker = new AuditOutboxWorker(fakeStorage(), baseOptions());
    await worker.onModuleInit();
    expect(addMock).not.toHaveBeenCalled();
    expect(lastQueueArgs).toEqual([]);
  });

  it("throws a clear error for mode: 'outbox' with no outbox config", async () => {
    const worker = new AuditOutboxWorker(fakeStorage(), baseOptions({ mode: 'outbox' }));
    await expect(worker.onModuleInit()).rejects.toThrow(/outbox.*config/i);
  });

  it('constructs a single-consumer Worker and schedules a repeatable drain tick', async () => {
    const connection = { host: 'localhost' };
    const worker = new AuditOutboxWorker(
      fakeStorage(),
      baseOptions({
        mode: 'outbox',
        outbox: { connection, queueName: 'my-queue', pollMs: 2000, batchSize: 50 },
      }),
    );

    await worker.onModuleInit();

    expect(lastQueueArgs[0]).toBe('my-queue');
    expect(lastQueueArgs[1]).toMatchObject({ connection });

    expect(lastWorkerArgs[0]).toBe('my-queue');
    expect(lastWorkerArgs[2]).toMatchObject({ connection, concurrency: 1 });

    expect(addMock).toHaveBeenCalledWith(
      'vellum:drain-tick',
      {},
      expect.objectContaining({
        repeat: { every: 2000 },
        jobId: 'vellum:drain-tick',
        attempts: expect.any(Number),
        backoff: expect.any(Object),
      }),
    );
  });

  it('defaults queueName and pollMs when not configured', async () => {
    const worker = new AuditOutboxWorker(
      fakeStorage(),
      baseOptions({ mode: 'outbox', outbox: { connection: {} } }),
    );

    await worker.onModuleInit();

    expect(lastQueueArgs[0]).toBe('vellum-audit');
    expect(addMock).toHaveBeenCalledWith(
      'vellum:drain-tick',
      {},
      expect.objectContaining({ repeat: { every: 1000 } }),
    );
  });

  it('routes a failed job to the configured onError hook', async () => {
    const onError = vi.fn();
    const worker = new AuditOutboxWorker(
      fakeStorage(),
      baseOptions({ mode: 'outbox', outbox: { connection: {} }, onError }),
    );

    await worker.onModuleInit();

    expect(workerOnMock).toHaveBeenCalledWith('failed', expect.any(Function));
    const [, handler] = workerOnMock.mock.calls.find(([event]) => event === 'failed')!;
    handler({ id: 'job-1' }, new Error('boom'));
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { job: 'job-1' });
  });
});

describe('AuditOutboxWorker.onModuleDestroy', () => {
  it('closes both the worker and the queue if they were created', async () => {
    const worker = new AuditOutboxWorker(
      fakeStorage(),
      baseOptions({ mode: 'outbox', outbox: { connection: {} } }),
    );
    await worker.onModuleInit();
    await worker.onModuleDestroy();
    expect(workerCloseMock).toHaveBeenCalledOnce();
    expect(queueCloseMock).toHaveBeenCalledOnce();
  });

  it('is a no-op when the worker was never started (inline mode)', async () => {
    const worker = new AuditOutboxWorker(fakeStorage(), baseOptions());
    await worker.onModuleInit();
    await expect(worker.onModuleDestroy()).resolves.toBeUndefined();
    expect(workerCloseMock).not.toHaveBeenCalled();
  });
});

describe('AuditOutboxWorker.drainTick', () => {
  it('drains every pending tenant once each when nothing exceeds the batch size', async () => {
    const drainOutbox = vi.fn().mockResolvedValue([]);
    const storage = fakeStorage({
      listOutboxTenants: vi.fn().mockResolvedValue(['t1', 't2']),
      drainOutbox,
    });
    const worker = new AuditOutboxWorker(storage, baseOptions());

    await worker.drainTick({ connection: {}, batchSize: 10 });

    expect(drainOutbox).toHaveBeenCalledTimes(2);
    expect(drainOutbox).toHaveBeenNthCalledWith(1, 't1', 10);
    expect(drainOutbox).toHaveBeenNthCalledWith(2, 't2', 10);
  });

  it('keeps draining a tenant while a batch comes back full, in case more rows arrived', async () => {
    const fullBatch = Array.from({ length: 3 }, (_, i) => ({ seq: i + 1 }) as unknown as ChainRow);
    const drainOutbox = vi
      .fn()
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce([]);
    const storage = fakeStorage({
      listOutboxTenants: vi.fn().mockResolvedValue(['t1']),
      drainOutbox,
    });
    const worker = new AuditOutboxWorker(storage, baseOptions());

    await worker.drainTick({ connection: {}, batchSize: 3 });

    expect(drainOutbox).toHaveBeenCalledTimes(3);
    expect(drainOutbox).toHaveBeenCalledWith('t1', 3);
  });

  it('defaults batchSize to 100 when not configured', async () => {
    const drainOutbox = vi.fn().mockResolvedValue([]);
    const storage = fakeStorage({
      listOutboxTenants: vi.fn().mockResolvedValue(['t1']),
      drainOutbox,
    });
    const worker = new AuditOutboxWorker(storage, baseOptions());

    await worker.drainTick({ connection: {} });

    expect(drainOutbox).toHaveBeenCalledWith('t1', 100);
  });
});
