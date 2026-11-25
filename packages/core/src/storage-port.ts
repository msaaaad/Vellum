import type { ChainRow, PendingAuditEvent } from './types.js';

export interface ChainHead {
  seq: number;
  rowHash: string;
}

export interface ReadRangeOptions {
  fromSeq?: number;
  toSeq?: number;
}

export interface Checkpoint {
  id: string;
  tenantId: string;
  headSeq: number;
  headHash: string;
  createdAt: string;
  anchoredRef: string | null;
}

export interface StoragePort<TTx = unknown> {
  head(tenantId: string): Promise<ChainHead | null>;

  appendInline(event: PendingAuditEvent): Promise<ChainRow>;

  readRange(tenantId: string, options?: ReadRangeOptions): Promise<ChainRow[]>;

  enqueue(tx: TTx | undefined, event: PendingAuditEvent): Promise<void>;

  drainOutbox(tenantId: string, batchSize: number): Promise<ChainRow[]>;

  listOutboxTenants(limit: number): Promise<string[]>;

  recordCheckpoint(tenantId: string, anchoredRef: string | null): Promise<Checkpoint>;
}
