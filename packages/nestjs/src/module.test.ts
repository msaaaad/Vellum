import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { PgStorageAdapter } from '@vellum/storage-pg';
import { AuditContextMiddleware } from './middleware.js';
import { AuditInterceptor } from './interceptor.js';
import { AuditModule } from './module.js';
import { AuditOutboxWorker } from './outbox-worker.service.js';
import { AuditService } from './audit.service.js';
import { AUDIT_MODULE_OPTIONS, AUDIT_STORAGE } from './tokens.js';
import type { AuditModuleOptions } from './types.js';

// Only the outbox-mode lifecycle test below actually triggers AuditOutboxWorker.onModuleInit()
// (via moduleRef.init()); bullmq is mocked so that doesn't try to open a real Redis connection.
const addMock = vi.fn().mockResolvedValue(undefined);
vi.mock('bullmq', () => ({
  Queue: vi
    .fn()
    .mockImplementation(() => ({ add: addMock, close: vi.fn().mockResolvedValue(undefined) })),
  Worker: vi
    .fn()
    .mockImplementation(() => ({ on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) })),
}));

// `pg.Pool` never opens a socket until a query runs, so this is safe to construct without a
// real database — module wiring shouldn't touch the network.
function dummyPool(): Pool {
  return new Pool();
}

describe('AuditModule.forRoot', () => {
  it('wires AuditService, AuditContextMiddleware, and a pg-backed StoragePort', async () => {
    const options: AuditModuleOptions = {
      storage: { adapter: 'pg', pool: dummyPool() },
      tenantResolver: () => 't1',
      actorResolver: () => ({ id: 'u1', type: 'user', label: null }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AuditModule.forRoot(options)],
    }).compile();

    expect(moduleRef.get(AuditService)).toBeInstanceOf(AuditService);
    expect(moduleRef.get(AuditContextMiddleware)).toBeInstanceOf(AuditContextMiddleware);
    expect(moduleRef.get(AUDIT_STORAGE)).toBeInstanceOf(PgStorageAdapter);
    expect(moduleRef.get(AUDIT_MODULE_OPTIONS)).toBe(options);

    // Registered globally (APP_INTERCEPTOR), not just available for manual @UseInterceptors().
    expect(moduleRef.get(AuditInterceptor)).toBeInstanceOf(AuditInterceptor);
  });

  it("throws a clear error for storage.adapter 'prisma' (not implemented until storage-prisma ships)", async () => {
    const options: AuditModuleOptions = {
      storage: { adapter: 'prisma', client: () => ({}) },
      tenantResolver: () => 't1',
      actorResolver: () => ({ id: 'u1', type: 'user', label: null }),
    };

    await expect(
      Test.createTestingModule({ imports: [AuditModule.forRoot(options)] }).compile(),
    ).rejects.toThrow(/storage-prisma/);
  });
});

describe("AuditModule.forRoot with mode: 'outbox'", () => {
  it('resolves AuditOutboxWorker via DI and starts it on module init', async () => {
    const options: AuditModuleOptions = {
      storage: { adapter: 'pg', pool: dummyPool() },
      mode: 'outbox',
      outbox: { connection: {} },
      tenantResolver: () => 't1',
      actorResolver: () => ({ id: 'u1', type: 'user', label: null }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AuditModule.forRoot(options)],
    }).compile();

    expect(moduleRef.get(AuditOutboxWorker)).toBeInstanceOf(AuditOutboxWorker);

    await moduleRef.init();
    expect(addMock).toHaveBeenCalledWith('vellum:drain-tick', {}, expect.any(Object));

    await moduleRef.close();
  });
});

describe('AuditModule.forRootAsync', () => {
  it('resolves options via the factory before building the storage port', async () => {
    const options: AuditModuleOptions = {
      storage: { adapter: 'pg', pool: dummyPool() },
      tenantResolver: () => 't1',
      actorResolver: () => ({ id: 'u1', type: 'user', label: null }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AuditModule.forRootAsync({ useFactory: () => options })],
    }).compile();

    expect(moduleRef.get(AUDIT_MODULE_OPTIONS)).toBe(options);
    expect(moduleRef.get(AUDIT_STORAGE)).toBeInstanceOf(PgStorageAdapter);
  });
});
