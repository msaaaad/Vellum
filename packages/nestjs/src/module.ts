import {
  Global,
  Module,
  type DynamicModule,
  type FactoryProvider,
  type Provider,
} from '@nestjs/common';
import { AuditWriter } from './audit-writer.service.js';
import { AuditService } from './audit.service.js';
import { AuditContextMiddleware } from './middleware.js';
import { AuditOutboxWorker } from './outbox-worker.service.js';
import { buildStorage } from './storage.js';
import { AUDIT_MODULE_OPTIONS, AUDIT_STORAGE } from './tokens.js';
import type { AuditModuleOptions } from './types.js';

export interface AuditModuleAsyncOptions {
  imports?: DynamicModule['imports'];
  useFactory: (...args: unknown[]) => AuditModuleOptions | Promise<AuditModuleOptions>;
  inject?: FactoryProvider['inject'];
}

const EXPORTS = [
  AuditService,
  AuditWriter,
  AuditContextMiddleware,
  AuditOutboxWorker,
  AUDIT_STORAGE,
  AUDIT_MODULE_OPTIONS,
];

const SHARED_PROVIDERS: Provider[] = [
  { provide: AUDIT_STORAGE, useFactory: buildStorage, inject: [AUDIT_MODULE_OPTIONS] },
  AuditWriter,
  AuditService,
  AuditContextMiddleware,
  AuditOutboxWorker,
];

@Global()
@Module({})
export class AuditModule {
  static forRoot(options: AuditModuleOptions): DynamicModule {
    return {
      module: AuditModule,
      providers: [{ provide: AUDIT_MODULE_OPTIONS, useValue: options }, ...SHARED_PROVIDERS],
      exports: EXPORTS,
    };
  }

  static forRootAsync(asyncOptions: AuditModuleAsyncOptions): DynamicModule {
    return {
      module: AuditModule,
      imports: asyncOptions.imports ?? [],
      providers: [
        {
          provide: AUDIT_MODULE_OPTIONS,
          useFactory: asyncOptions.useFactory,
          inject: asyncOptions.inject ?? [],
        },
        ...SHARED_PROVIDERS,
      ],
      exports: EXPORTS,
    };
  }
}
