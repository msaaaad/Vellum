import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConnectionOptions, Queue as QueueType, Worker as WorkerType } from 'bullmq';
import type { ChainRow, StoragePort } from '@getattestly/core';
import { AUDIT_MODULE_OPTIONS, AUDIT_STORAGE } from './tokens.js';
import type { AuditModuleOptions, AuditOutboxConfig } from './types.js';

const DRAIN_TICK_JOB = 'attestly:drain-tick';
const DEFAULT_QUEUE_NAME = 'attestly-audit';
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_DRAIN_BATCH_SIZE = 100;
const TENANTS_PER_DRAIN_TICK = 100;
const SOLE_CONSUMER_CONCURRENCY = 1;
const DRAIN_TICK_MAX_ATTEMPTS = 5;
const DRAIN_TICK_BACKOFF_DELAY_MS = 1000;
const FAILED_JOBS_RETAINED = 100;

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
        "AuditModule: mode 'outbox' requires an `outbox` config (at least `connection`), see the README's Configuration reference.",
      );
    }

    const { Queue, Worker } = await import('bullmq');
    const queueName = outbox.queueName ?? DEFAULT_QUEUE_NAME;
    const connection = outbox.connection as ConnectionOptions;

    this.queue = new Queue(queueName, { connection });
    this.worker = new Worker(queueName, () => this.drainTick(outbox), {
      connection,
      concurrency: SOLE_CONSUMER_CONCURRENCY,
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error(`outbox drain tick failed: ${err.message}`);
      this.options.onError?.(err, { job: job?.id ?? null });
    });

    await this.queue.add(
      DRAIN_TICK_JOB,
      {},
      {
        repeat: { every: outbox.pollMs ?? DEFAULT_POLL_INTERVAL_MS },
        jobId: DRAIN_TICK_JOB,
        attempts: DRAIN_TICK_MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: DRAIN_TICK_BACKOFF_DELAY_MS },
        removeOnComplete: true,
        removeOnFail: FAILED_JOBS_RETAINED,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async drainTick(outbox: AuditOutboxConfig): Promise<void> {
    const batchSize = outbox.batchSize ?? DEFAULT_DRAIN_BATCH_SIZE;
    const tenants = await this.storage.listOutboxTenants(TENANTS_PER_DRAIN_TICK);
    for (const tenantId of tenants) {
      await this.drainTenant(tenantId, batchSize);
    }
  }

  private async drainTenant(tenantId: string, batchSize: number): Promise<void> {
    let drainedRows: ChainRow[];
    do {
      drainedRows = await this.storage.drainOutbox(tenantId, batchSize);
    } while (drainedRows.length === batchSize);
  }
}
