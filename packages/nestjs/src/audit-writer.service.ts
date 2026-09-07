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

  /** The non-transactional write path: `@Audited()` and `audit.record()` both land here. */
  async write(pending: PendingAuditEvent): Promise<ChainRow | void> {
    const mode = this.options.mode ?? 'inline';
    if (mode !== 'inline') {
      // Draining audit_outbox via a BullMQ worker is Phase 4 (DOMAIN_CHECKLIST.md). The
      // transactional `enqueue()` API below works today regardless of mode — it just writes
      // audit_outbox rows, which is all that requires no worker yet.
      throw new Error(
        "AuditWriter: mode 'outbox' isn't wired up for @Audited()/record() yet (the BullMQ worker " +
          'ships in Phase 4). Use audit.enqueue(tx, …) inside your own transaction in the meantime.',
      );
    }

    try {
      return await this.storage.appendInline(pending);
    } catch (err) {
      if (this.options.onError) {
        this.options.onError(err, pending);
        return;
      }
      throw err;
    }
  }

  /** The transactional write path: `audit.enqueue(tx, …)` — atomic with the caller's own tx. */
  async enqueue(tx: unknown, pending: PendingAuditEvent): Promise<void> {
    await this.storage.enqueue(tx, pending);
  }
}
