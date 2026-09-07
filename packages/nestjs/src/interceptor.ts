import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import { from, Observable, of, throwError } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { AuditWriter } from './audit-writer.service.js';
import { getAuditContext } from './context.js';
import { computeDiff } from './diff.js';
import { redact } from './redact.js';
import { AUDIT_MODULE_OPTIONS, AUDITED_METADATA_KEY } from './tokens.js';
import type { AuditedOptions, AuditModuleOptions, AuditPointcut, CaptureMode } from './types.js';

/**
 * Turns `@Audited()` methods into chained events — ARCHITECTURE.md §4.2. Registered globally by
 * `AuditModule`, so it runs on every request but is a no-op unless the handler carries metadata.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    // Explicit @Inject() on every param, including class tokens: type-based (paramtypes-metadata)
    // injection needs `emitDecoratorMetadata`, which only a full `tsc` build emits — esbuild-based
    // toolchains (Vite/Vitest here, but also esbuild/swc apps consuming this package) silently
    // don't, so relying on it would make DI fragile depending on how the consumer compiles.
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
    @Inject(AuditWriter) private readonly writer: AuditWriter,
    @Inject(AUDIT_MODULE_OPTIONS) private readonly options: AuditModuleOptions,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<AuditedOptions | undefined>(
      AUDITED_METADATA_KEY,
      context.getHandler(),
    );
    if (!options) return next.handle();

    const auditContext = getAuditContext();
    if (!auditContext) {
      return throwError(
        () =>
          new Error(
            `@Audited('${options.action}') ran with no audit context — wrap the call in ` +
              'AuditContextMiddleware (HTTP) or withAuditContext() (jobs/CLI/tests) before invoking it.',
          ),
      );
    }

    const request = this.extractRequest(context);
    const self = this.resolveSelf(context);
    const args = context.getArgs();
    const capture: CaptureMode = options.capture ?? 'snapshot';

    const basePointcut: AuditPointcut = {
      args,
      result: undefined,
      self,
      request,
      tenantId: auditContext.tenantId,
      actor: auditContext.actor,
    };

    const loadBefore$: Observable<unknown> =
      capture === 'diff' && options.loadBefore
        ? from(Promise.resolve(options.loadBefore(basePointcut)))
        : of(undefined);

    return loadBefore$.pipe(
      mergeMap((before) =>
        next
          .handle()
          .pipe(
            mergeMap((result) =>
              this.writeEvent(options, capture, before, { ...basePointcut, result }).then(
                () => result,
              ),
            ),
          ),
      ),
    );
  }

  private async writeEvent(
    options: AuditedOptions,
    capture: CaptureMode,
    before: unknown,
    pointcut: AuditPointcut,
  ): Promise<void> {
    const redactPaths = [...(this.options.redact ?? []), ...(options.redact ?? [])];

    let changes: unknown;
    if (capture === 'snapshot') {
      changes = { after: redact(pointcut.result, redactPaths) };
    } else if (capture === 'diff') {
      const redactedBefore = redact(before, redactPaths);
      const redactedAfter = redact(pointcut.result, redactPaths);
      changes = {
        before: redactedBefore,
        after: redactedAfter,
        diff: computeDiff(redactedBefore, redactedAfter),
      };
    } else {
      changes = {};
    }

    const entityId = options.entityId ? (options.entityId(pointcut) ?? null) : null;
    const customMetadata = options.metadata ? (options.metadata(pointcut) ?? {}) : {};
    const requestMeta = getAuditContext()?.requestMeta ?? {};
    const metadata = redact({ ...requestMeta, ...customMetadata }, redactPaths);

    const pending = this.writer.buildPending({
      tenantId: pointcut.tenantId,
      actor: pointcut.actor,
      action: options.action,
      entity: { type: options.entity, id: entityId },
      changes,
      metadata,
    });

    await this.writer.write(pending);
  }

  private extractRequest(context: ExecutionContext): unknown {
    try {
      return context.switchToHttp().getRequest();
    } catch {
      return undefined;
    }
  }

  /** Assumes default (singleton) provider scope — the common case for controllers/services. */
  private resolveSelf(context: ExecutionContext): unknown {
    try {
      return this.moduleRef.get(context.getClass(), { strict: false });
    } catch {
      return undefined;
    }
  }
}
