import { SetMetadata } from '@nestjs/common';
import { computeDiff } from './diff.js';
import { getAuditContext } from './context.js';
import { redact } from './redact.js';
import { getActiveAuditWriter } from './runtime.js';
import { AUDITED_METADATA_KEY } from './tokens.js';
import type { AuditedOptions, AuditPointcut, CaptureMode } from './types.js';

/**
 * Marks a method for automatic audit capture — README "The @Audited() decorator".
 *
 * This wraps the method itself; it is deliberately **not** a `NestInterceptor`. A NestJS
 * interceptor only ever runs for a controller (or resolver/gateway) method Nest's own
 * HTTP/RPC/WS dispatch invokes — never for a plain service method called directly from other
 * application code, which is most of what "add one decorator, every call is audited" needs to
 * cover (a service calling another service, a seed script, a cron job). Wrapping the function
 * runs identically no matter who calls it, controller or not, with no `ExecutionContext`
 * needed — `self` is simply `this` at call time, and `request` comes from the ambient
 * `AuditContext` (set by `AuditContextMiddleware` for an HTTP request, absent otherwise) rather
 * than a transport-specific abstraction.
 *
 * `SetMetadata` still runs too, purely for external introspection (e.g. a tool that lists every
 * audited action in a codebase) — the write path above does not depend on it.
 */
export function Audited(options: AuditedOptions): MethodDecorator {
  return (target, propertyKey, descriptor: PropertyDescriptor): PropertyDescriptor => {
    SetMetadata(AUDITED_METADATA_KEY, options)(target, propertyKey, descriptor);

    const original = descriptor.value as ((...args: unknown[]) => unknown) | undefined;
    if (typeof original !== 'function') return descriptor;

    descriptor.value = async function auditedMethod(
      this: unknown,
      ...args: unknown[]
    ): Promise<unknown> {
      const auditContext = getAuditContext();
      if (!auditContext) {
        throw new Error(
          `@Audited('${options.action}') ran with no audit context — wrap the call in ` +
            'AuditContextMiddleware (HTTP) or withAuditContext() (jobs/CLI/tests) before invoking it.',
        );
      }

      const capture: CaptureMode = options.capture ?? 'snapshot';
      const basePointcut: AuditPointcut = {
        args,
        result: undefined,
        self: this,
        request: auditContext.request,
        tenantId: auditContext.tenantId,
        actor: auditContext.actor,
      };

      const before = options.loadBefore ? await options.loadBefore(basePointcut) : undefined;

      // Errors from the original method propagate before any event is written — ARCHITECTURE.md §4.2.
      const result = await original.apply(this, args);

      await writeAuditedEvent(options, capture, before, { ...basePointcut, result });

      return result;
    };

    return descriptor;
  };
}

async function writeAuditedEvent(
  options: AuditedOptions,
  capture: CaptureMode,
  before: unknown,
  pointcut: AuditPointcut,
): Promise<void> {
  const writer = getActiveAuditWriter();
  const redactPaths = [...writer.globalRedact, ...(options.redact ?? [])];

  let changes: unknown;
  if (capture === 'snapshot') {
    // Prefer the pre-fetched `before` when loadBefore is configured — the natural subject for a
    // delete/revoke-shaped action is "what existed", which the method's own return value often
    // can't express (void return, or the record no longer existing at all afterwards).
    const subject = options.loadBefore ? before : pointcut.result;
    changes = { after: redact(subject, redactPaths) };
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

  const pending = writer.buildPending({
    tenantId: pointcut.tenantId,
    actor: pointcut.actor,
    action: options.action,
    entity: { type: options.entity, id: entityId },
    changes,
    metadata,
  });

  await writer.write(pending);
}
