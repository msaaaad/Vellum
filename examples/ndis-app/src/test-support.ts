import { AuditService, AuditWriter, type AuditModuleOptions } from '@getattestly/nestjs';
import {
  GENESIS_HASH,
  hashEvent,
  toCanonicalPayload,
  type AuditEvent,
  type ChainRow,
  type Checkpoint,
  type PendingAuditEvent,
  type StoragePort,
} from '@getattestly/core';

export class InMemoryStorage implements StoragePort<unknown> {
  rows: ChainRow[] = [];

  async head() {
    const lastRow = this.rows.at(-1);
    return lastRow ? { seq: lastRow.seq, rowHash: lastRow.rowHash } : null;
  }

  async appendInline(event: PendingAuditEvent): Promise<ChainRow> {
    return this.appendToChain(event);
  }

  async readRange() {
    return this.rows;
  }

  async enqueue(_tx: unknown, event: PendingAuditEvent): Promise<void> {
    this.appendToChain(event);
  }

  async drainOutbox() {
    return [];
  }

  async listOutboxTenants() {
    return [];
  }

  async recordCheckpoint(tenantId: string): Promise<Checkpoint> {
    return {
      id: '00000000-0000-4000-8000-00000000000a',
      tenantId,
      headSeq: this.rows.at(-1)?.seq ?? 0,
      headHash: this.rows.at(-1)?.rowHash ?? GENESIS_HASH,
      createdAt: new Date().toISOString(),
      anchoredRef: null,
    };
  }

  private appendToChain(event: PendingAuditEvent): ChainRow {
    const lastRow = this.rows.at(-1);
    const seq = lastRow ? lastRow.seq + 1 : 1;
    const prevHash = lastRow ? lastRow.rowHash : GENESIS_HASH;
    const sequencedEvent: AuditEvent = { ...event, seq };
    const rowHash = hashEvent(prevHash, toCanonicalPayload(sequencedEvent));
    const row: ChainRow = { ...sequencedEvent, prevHash, rowHash };
    this.rows.push(row);
    return row;
  }
}

export function testAuditOptions(overrides?: Partial<AuditModuleOptions>): AuditModuleOptions {
  return {
    storage: { adapter: 'pg', pool: {} as never },
    tenantResolver: () => '00000000-0000-4000-8000-000000000001',
    actorResolver: () => ({
      id: '00000000-0000-4000-8000-000000000002',
      type: 'user',
      label: 'sam@x.io',
    }),
    ...overrides,
  };
}

export function createTestRuntime(overrides?: Partial<AuditModuleOptions>): {
  storage: InMemoryStorage;
  writer: AuditWriter;
  audit: AuditService;
} {
  const storage = new InMemoryStorage();
  const options = testAuditOptions(overrides);
  const writer = new AuditWriter(storage, options);
  const audit = new AuditService(writer, options);
  return { storage, writer, audit };
}
