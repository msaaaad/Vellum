import { Inject, Injectable } from '@nestjs/common';
import type {
  AuditActor,
  AuditEntity,
  ChainRow,
  PendingAuditEvent,
  StoragePort,
} from '@getattestly/core';
import { setActiveAuditWriter } from './runtime.js';
import { AUDIT_MODULE_OPTIONS, AUDIT_STORAGE } from './tokens.js';
import type { AuditModuleOptions } from './types.js';

export interface BuildPendingInput {
  tenantId: string;
  actor: AuditActor;
  action: string;
  entity: AuditEntity;
  changes: unknown;
  metadata: unknown;
}

@Injectable()
export class AuditWriter {
  constructor(
    @Inject(AUDIT_STORAGE) private readonly storage: StoragePort<unknown>,
    @Inject(AUDIT_MODULE_OPTIONS) private readonly options: AuditModuleOptions,
  ) {
    setActiveAuditWriter(this);
  }

  get globalRedact(): string[] {
    return this.options.redact ?? [];
  }

  buildPendingEvent(input: BuildPendingInput): PendingAuditEvent {
    const clock = this.options.clock ?? (() => new Date());
    return {
      hashVersion: this.options.hash?.version ?? 1,
      tenantId: input.tenantId,
      occurredAt: clock().toISOString(),
      actor: input.actor,
      action: input.action,
      entity: input.entity,
      changes: input.changes ?? {},
      metadata: input.metadata ?? {},
    };
  }

  async write(pendingEvent: PendingAuditEvent): Promise<ChainRow | void> {
    const mode = this.options.mode ?? 'inline';
    try {
      if (mode === 'inline') {
        return await this.storage.appendInline(pendingEvent);
      }
      await this.storage.enqueue(undefined, pendingEvent);
      return undefined;
    } catch (err) {
      if (this.options.onError) {
        this.options.onError(err, pendingEvent);
        return undefined;
      }
      throw err;
    }
  }

  async enqueue(tx: unknown, pendingEvent: PendingAuditEvent): Promise<void> {
    await this.storage.enqueue(tx, pendingEvent);
  }
}
