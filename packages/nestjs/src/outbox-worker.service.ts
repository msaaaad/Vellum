import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConnectionOptions, Queue as QueueType, Worker as WorkerType } from 'bullmq';
import type { ChainRow, StoragePort } from '@vellum/core';
import { AUDIT_MODULE_OPTIONS, AUDIT_STORAGE } from './tokens.js';
import type { AuditModuleOptions, AuditOutboxConfig } from './types.js';

const DRAIN_TICK_JOB = 'vellum:drain-tick';

/**
 * The BullMQ side of outbox mode — ARCHITECTURE.md §4.4. A single Worker (`concurrency: 1`)
 * processes a repeatable "tick" job every `outbox.pollMs`: for each tenant with rows in
 * `audit_outbox`, drains them into `audit_events` in `enqueued_at` order until none remain.
 * `StoragePort.drainOutbox` already does the chain+insert+delete atomically per batch (Phase 2),
 * so a crash mid-batch and restart re-processes safely — nothing here needs its own idempotency
 * bookkeeping.
 *
 * `bullmq` is a peer dependency, not a hard one (README "outbox mode also needs BullMQ + Redis")
 * — loaded dynamically here so an inline-mode-only consumer never needs it installed at all.
 */
@Injectable()
export class AuditOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditOutboxWorker.name);
  private queue?: QueueType;
  private worker?: WorkerType;

  constructor(
    @Inject(AUDIT_STORAGE) private readonly storage: StoragePort<unknown>,
    @Inject(AUDIT_MODULE_OPTIONS) private readonly options: AuditModuleOptions,
  ) {}

  async onModuleInit(): Promise<void> {
    if ((this.options.mode ?? 'inline') !== 'outbox') return;

    const outbox = this.options.outbox;
    if (!outbox) {
      throw new Error(
        "AuditModule: mode 'outbox' requires an `outbox` config (at least `connection`) — see the README's Configuration reference.",
      );
    }

    const { Queue, Worker } = await import('bullmq');
    const queueName = outbox.queueName ?? 'vellum-audit';
    const connection = outbox.connection as ConnectionOptions;

    this.queue = new Queue(queueName, { connection });
    this.worker = new Worker(queueName, () => this.drainTick(outbox), {
      connection,
      concurrency: 1, // sole consumer — ordering per tenant comes from single-threaded draining
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error(`outbox drain tick failed: ${err.message}`);
      this.options.onError?.(err, { job: job?.id ?? null });
    });

    // A fixed jobId makes re-registering the repeatable schedule on every restart idempotent —
    // BullMQ just keeps the existing schedule rather than creating a duplicate one.
    await this.queue.add(
      DRAIN_TICK_JOB,
      {},
      {
        repeat: { every: outbox.pollMs ?? 1000 },
        jobId: DRAIN_TICK_JOB,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** One poll tick: drains every tenant with pending rows. Exposed for tests/manual triggering. */
  async drainTick(outbox: AuditOutboxConfig): Promise<void> {
    const batchSize = outbox.batchSize ?? 100;
    const tenants = await this.storage.listOutboxTenants();
    for (const tenantId of tenants) {
      await this.drainTenant(tenantId, batchSize);
    }
  }

  private async drainTenant(tenantId: string, batchSize: number): Promise<void> {
    let drained: ChainRow[];
    do {
      drained = await this.storage.drainOutbox(tenantId, batchSize);
    } while (drained.length === batchSize);
  }
}
