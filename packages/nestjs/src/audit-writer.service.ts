import { Inject, Injectable } from '@nestjs/common';
import type {
  AuditActor,
  AuditEntity,
  ChainRow,
  PendingAuditEvent,
  StoragePort,
} from '@vellum/core';
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

/**
 * The write path shared by `AuditInterceptor` and `AuditService` — fills in the fields callers
 * never pass by hand (`occurredAt`, `hashVersion`) and dispatches to the configured mode.
 * `mode: 'inline'` delegates straight to `StoragePort.appendInline`, which already does the
 * advisory-lock → seq → prev_hash → row_hash → insert sequence from ARCHITECTURE.md §4.3.
 */
@Injectable()
export class AuditWriter {
  constructor(
    @Inject(AUDIT_STORAGE) private readonly storage: StoragePort<unknown>,
    @Inject(AUDIT_MODULE_OPTIONS) private readonly options: AuditModuleOptions,
  ) {}

  buildPending(input: BuildPendingInput): PendingAuditEvent {
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

  /**
   * The non-transactional write path: `@Audited()` and `audit.record()` both land here.
   * `mode: 'inline'` appends synchronously; `mode: 'outbox'` queues a standalone (no caller tx)
   * outbox row for `AuditOutboxWorker` to chain later — same on-disk chain either way, per
   * DOMAIN_CHECKLIST.md Phase 4's "config switch produces an identical chain".
   */
  async write(pending: PendingAuditEvent): Promise<ChainRow | void> {
    const mode = this.options.mode ?? 'inline';
    try {
      if (mode === 'inline') {
        return await this.storage.appendInline(pending);
      }
      await this.storage.enqueue(undefined, pending);
      return undefined;
    } catch (err) {
      if (this.options.onError) {
        this.options.onError(err, pending);
        return undefined;
      }
      throw err;
    }
  }

  /** The transactional write path: `audit.enqueue(tx, …)` — atomic with the caller's own tx. */
  async enqueue(tx: unknown, pending: PendingAuditEvent): Promise<void> {
    await this.storage.enqueue(tx, pending);
  }
}
