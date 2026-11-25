import { SetMetadata } from '@nestjs/common';
import { computeDiff } from './diff.js';
import { getAuditContext } from './context.js';
import { redact } from './redact.js';
import { getActiveAuditWriter } from './runtime.js';
import { AUDITED_METADATA_KEY } from './tokens.js';
import type { AuditedOptions, AuditPointcut, CaptureMode } from './types.js';

export function Audited(options: AuditedOptions): MethodDecorator {
  return (target, propertyKey, descriptor: PropertyDescriptor): PropertyDescriptor => {
    SetMetadata(AUDITED_METADATA_KEY, options)(target, propertyKey, descriptor);

    const originalMethod = descriptor.value as ((...args: unknown[]) => unknown) | undefined;
    if (typeof originalMethod !== 'function') return descriptor;

    descriptor.value = async function auditedMethod(
      this: unknown,
      ...args: unknown[]
    ): Promise<unknown> {
      const auditContext = getAuditContext();
      if (!auditContext) {
        throw new Error(
          `@Audited('${options.action}') ran with no audit context: wrap the call in ` +
            'AuditContextMiddleware (HTTP) or withAuditContext() (jobs/CLI/tests) before invoking it.',
        );
      }

      const capture: CaptureMode = options.capture ?? 'snapshot';
      const pointcutBeforeHandler: AuditPointcut = {
        args,
        result: undefined,
        self: this,
        request: auditContext.request,
        tenantId: auditContext.tenantId,
        actor: auditContext.actor,
      };

      const beforeState = options.loadBefore
        ? await options.loadBefore(pointcutBeforeHandler)
        : undefined;

      const handlerResult = await originalMethod.apply(this, args);

      await writeAuditedEvent(options, capture, beforeState, {
        ...pointcutBeforeHandler,
        result: handlerResult,
      });

      return handlerResult;
    };

    return descriptor;
  };
}

function buildCapturedChanges(
  options: AuditedOptions,
  capture: CaptureMode,
  beforeState: unknown,
  pointcut: AuditPointcut,
  redactPaths: string[],
): unknown {
  if (capture === 'snapshot') {
    const snapshotSubject = options.loadBefore ? beforeState : pointcut.result;
    return { after: redact(snapshotSubject, redactPaths) };
  }

  if (capture === 'diff') {
    const redactedBefore = redact(beforeState, redactPaths);
    const redactedAfter = redact(pointcut.result, redactPaths);
    return {
      before: redactedBefore,
      after: redactedAfter,
      diff: computeDiff(redactedBefore, redactedAfter),
    };
  }

  return {};
}

async function writeAuditedEvent(
  options: AuditedOptions,
  capture: CaptureMode,
  beforeState: unknown,
  pointcut: AuditPointcut,
): Promise<void> {
  const writer = getActiveAuditWriter();
  const redactPaths = [...writer.globalRedact, ...(options.redact ?? [])];

  const changes = buildCapturedChanges(options, capture, beforeState, pointcut, redactPaths);

  const entityId = options.entityId ? (options.entityId(pointcut) ?? null) : null;
  const customMetadata = options.metadata ? (options.metadata(pointcut) ?? {}) : {};
  const requestMeta = getAuditContext()?.requestMeta ?? {};
  const metadata = redact({ ...requestMeta, ...customMetadata }, redactPaths);

  const pendingEvent = writer.buildPendingEvent({
    tenantId: pointcut.tenantId,
    actor: pointcut.actor,
    action: options.action,
    entity: { type: options.entity, id: entityId },
    changes,
    metadata,
  });

  await writer.write(pendingEvent);
}
