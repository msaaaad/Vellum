import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { PgStorageAdapter } from '@vellum/storage-pg';
import { AuditContextMiddleware } from './middleware.js';
import { AuditInterceptor } from './interceptor.js';
import { AuditModule } from './module.js';
import { AuditService } from './audit.service.js';
import { AUDIT_MODULE_OPTIONS, AUDIT_STORAGE } from './tokens.js';
import type { AuditModuleOptions } from './types.js';

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
