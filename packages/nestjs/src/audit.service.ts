import { Inject, Injectable } from '@nestjs/common';
import type { ChainRow } from '@vellum/core';
import { AuditWriter } from './audit-writer.service.js';
import { getAuditContext } from './context.js';
import { redact } from './redact.js';
import { AUDIT_MODULE_OPTIONS } from './tokens.js';
import type { AuditContext, AuditModuleOptions, RecordEventInput } from './types.js';

function requireAuditContext(action: string): AuditContext {
  const ctx = getAuditContext();
  if (!ctx) {
    throw new Error(
      `audit.record/enqueue('${action}') was called with no audit context — wrap the call in ` +
        'AuditContextMiddleware (HTTP) or withAuditContext() (jobs/CLI/tests) first.',
    );
  }
  return ctx;
}

/**
 * The imperative + transactional API — README "Imperative + transactional (atomic) API".
 * `tenantId`/`actor` always come from the current `AuditContext`, never as parameters, so a
 * caller can't accidentally pass the wrong tenant (DOMAIN_CHECKLIST.md §6.6).
 */
@Injectable()
export class AuditService {
  constructor(
    // @Inject(AuditWriter) explicitly — see the comment on AuditInterceptor's constructor.
    @Inject(AuditWriter) private readonly writer: AuditWriter,
    @Inject(AUDIT_MODULE_OPTIONS) private readonly options: AuditModuleOptions,
  ) {}

  /** Fire-and-forget: writes immediately (inline mode), not tied to any business transaction. */
  async record(input: RecordEventInput): Promise<ChainRow | void> {
    const ctx = requireAuditContext(input.action);
    return this.writer.write(this.buildPending(ctx, input));
  }

  /**
   * Writes inside the caller's own transaction (`tx`), so it commits/rolls back atomically with
   * the business change — ARCHITECTURE.md §4.4. `TTx` must match the storage adapter's native
   * transaction type (e.g. a `pg` `PoolClient`).
   */
  async enqueue<TTx>(tx: TTx, input: RecordEventInput): Promise<void> {
    const ctx = requireAuditContext(input.action);
    await this.writer.enqueue(tx, this.buildPending(ctx, input));
  }

  private buildPending(ctx: AuditContext, input: RecordEventInput) {
    const redactPaths = this.options.redact ?? [];
    return this.writer.buildPending({
      tenantId: ctx.tenantId,
      actor: ctx.actor,
      action: input.action,
      entity: { type: input.entity, id: input.entityId ?? null },
      changes: redact(input.changes ?? {}, redactPaths),
      metadata: redact(input.metadata ?? {}, redactPaths),
    });
  }
}
