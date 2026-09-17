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
  // AuditWriter's own constructor registers itself as the active writer @Audited() reaches for
  // (runtime.ts) — nothing needs to inject it explicitly for that to happen, since Nest
  // instantiates every provider declared here regardless of whether anything else depends on it.
  AuditWriter,
  AuditService,
  AuditContextMiddleware,
  // OnModuleInit no-ops unless mode: 'outbox' — see AuditOutboxWorker's own doc comment.
  AuditOutboxWorker,
];

/**
 * Wires Vellum into a NestJS app — README "Quick start". `@Global()` so one `forRoot()` in the
 * root module is enough: `AuditContextMiddleware`/`AuditService` resolve in every feature module
 * without re-importing `AuditModule` everywhere.
 */
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
