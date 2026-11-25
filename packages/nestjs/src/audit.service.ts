import { Inject, Injectable } from '@nestjs/common';
import type { ChainRow } from '@attestly/core';
import { AuditWriter } from './audit-writer.service.js';
import { getAuditContext } from './context.js';
import { redact } from './redact.js';
import { AUDIT_MODULE_OPTIONS } from './tokens.js';
import type { AuditContext, AuditModuleOptions, RecordEventInput } from './types.js';

function getAuditContextOrFail(action: string): AuditContext {
  const auditContext = getAuditContext();
  if (!auditContext) {
    throw new Error(
      `audit.record/enqueue('${action}') was called with no audit context: wrap the call in ` +
        'AuditContextMiddleware (HTTP) or withAuditContext() (jobs/CLI/tests) first.',
    );
  }
  return auditContext;
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(AuditWriter) private readonly writer: AuditWriter,
    @Inject(AUDIT_MODULE_OPTIONS) private readonly options: AuditModuleOptions,
  ) {}

  async record(input: RecordEventInput): Promise<ChainRow | void> {
    const auditContext = getAuditContextOrFail(input.action);
    return this.writer.write(this.buildPendingEvent(auditContext, input));
  }

  async enqueue<TTx>(tx: TTx, input: RecordEventInput): Promise<void> {
    const auditContext = getAuditContextOrFail(input.action);
    await this.writer.enqueue(tx, this.buildPendingEvent(auditContext, input));
  }

  private buildPendingEvent(auditContext: AuditContext, input: RecordEventInput) {
    const redactPaths = this.options.redact ?? [];
    return this.writer.buildPendingEvent({
      tenantId: auditContext.tenantId,
      actor: auditContext.actor,
      action: input.action,
      entity: { type: input.entity, id: input.entityId ?? null },
      changes: redact(input.changes ?? {}, redactPaths),
      metadata: redact(input.metadata ?? {}, redactPaths),
    });
  }
}
