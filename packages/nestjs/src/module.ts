import {
  Global,
  Module,
  type DynamicModule,
  type FactoryProvider,
  type Provider,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditWriter } from './audit-writer.service.js';
import { AuditService } from './audit.service.js';
import { AuditContextMiddleware } from './middleware.js';
import { AuditInterceptor } from './interceptor.js';
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
  AuditInterceptor,
  // OnModuleInit no-ops unless mode: 'outbox' — see AuditOutboxWorker's own doc comment.
  AuditOutboxWorker,
  // Registered globally so the quick-start needs no manual `@UseInterceptors(AuditInterceptor)` —
  // `useExisting` (not `useClass`) so this shares the one `AuditInterceptor` instance rather than
  // constructing a second one under the APP_INTERCEPTOR token.
  { provide: APP_INTERCEPTOR, useExisting: AuditInterceptor },
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
