// Shared test-only support — not a *.test.ts file itself, so vitest never runs it directly.
import { AuditService, AuditWriter, type AuditModuleOptions } from '@vellum/nestjs';
import {
  GENESIS_HASH,
  hashEvent,
  toCanonicalPayload,
  type AuditEvent,
  type ChainRow,
  type Checkpoint,
  type PendingAuditEvent,
  type StoragePort,
} from '@vellum/core';

/**
 * A minimal, real (not mocked) `StoragePort`. `@Audited()` wraps the method itself (see
 * `packages/nestjs/src/decorator.ts`), so exercising it needs no DI container at all — just a
 * real `AuditWriter` constructed against this, then a plain `new SomeService()` to call. `enqueue`
 * chains immediately (as if already drained) purely for test observability — the outbox/worker
 * mechanics themselves are `packages/nestjs`'s own tests to own, not this example's.
 */
export class InMemoryStorage implements StoragePort<unknown> {
  rows: ChainRow[] = [];

  async head() {
    const last = this.rows.at(-1);
    return last ? { seq: last.seq, rowHash: last.rowHash } : null;
  }

  async appendInline(event: PendingAuditEvent): Promise<ChainRow> {
    return this.chain(event);
  }

  async readRange() {
    return this.rows;
  }

  async enqueue(_tx: unknown, event: PendingAuditEvent): Promise<void> {
    this.chain(event);
  }

  async drainOutbox() {
    return [];
  }

  async listOutboxTenants() {
    return [];
  }

  async recordCheckpoint(tenantId: string): Promise<Checkpoint> {
    return {
      id: 'c1',
      tenantId,
      headSeq: this.rows.at(-1)?.seq ?? 0,
      headHash: this.rows.at(-1)?.rowHash ?? GENESIS_HASH,
      createdAt: new Date().toISOString(),
      anchoredRef: null,
    };
  }

  private chain(event: PendingAuditEvent): ChainRow {
    const last = this.rows.at(-1);
    const seq = last ? last.seq + 1 : 1;
    const prevHash = last ? last.rowHash : GENESIS_HASH;
    const full: AuditEvent = { ...event, seq };
    const rowHash = hashEvent(prevHash, toCanonicalPayload(full));
    const row: ChainRow = { ...full, prevHash, rowHash };
    this.rows.push(row);
    return row;
  }
}

export function testAuditOptions(overrides: Partial<AuditModuleOptions> = {}): AuditModuleOptions {
  return {
    storage: { adapter: 'pg', pool: {} as never },
    tenantResolver: () => 't1',
    actorResolver: () => ({ id: 'u1', type: 'user', label: 'sam@x.io' }),
    ...overrides,
  };
}

/** A fresh, isolated audit runtime for one test: constructing `AuditWriter` registers it as the
 * active writer `@Audited()` reaches for (see runtime.ts) — that's the only wiring needed. */
export function createTestRuntime(overrides: Partial<AuditModuleOptions> = {}): {
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
