import type { ChainRow, PendingAuditEvent } from './types.js';

export interface ChainHead {
  seq: number;
  rowHash: string;
}

export interface ReadRangeOptions {
  fromSeq?: number;
  toSeq?: number;
}

/**
 * The storage seam every adapter (storage-pg, storage-prisma, ...) implements —
 * ARCHITECTURE.md §4. `TTx` is the adapter's native transaction/client type (e.g. a pg
 * `PoolClient`), so callers can enqueue an event inside their own business transaction.
 */
export interface StoragePort<TTx = unknown> {
  /** The current chain head for a tenant, or null if the tenant has no rows yet. */
  head(tenantId: string): Promise<ChainHead | null>;

  /**
   * Appends one event to the chain synchronously, serialized per-tenant — ARCHITECTURE.md §4.3.
   * `seq`/`prevHash`/`rowHash` are assigned by the adapter, not the caller.
   */
  appendInline(event: PendingAuditEvent): Promise<ChainRow>;

  /** Reads rows for a tenant, ordered by seq ascending, optionally restricted to a seq range. */
  readRange(tenantId: string, options?: ReadRangeOptions): Promise<ChainRow[]>;

  /** Queues an event in the outbox inside the caller's transaction — ARCHITECTURE.md §4.4. */
  enqueue(tx: TTx, event: PendingAuditEvent): Promise<void>;

  /**
   * Drains up to `batchSize` queued events for a tenant, in enqueue order: assigns each a
   * seq/prevHash/rowHash, inserts into the chain, and removes it from the outbox — all in
   * one transaction, per ARCHITECTURE.md §4.4.
   */
  drainOutbox(tenantId: string, batchSize?: number): Promise<ChainRow[]>;
}
