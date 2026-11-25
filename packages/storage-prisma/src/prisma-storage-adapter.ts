import {
  GENESIS_HASH,
  hashEvent,
  toCanonicalPayload,
  type ActorType,
  type AuditEvent,
  type ChainHead,
  type ChainRow,
  type Checkpoint,
  type PendingAuditEvent,
  type ReadRangeOptions,
  type StoragePort,
} from '@vellum/core';

/**
 * The slice of a Prisma client (or an interactive-transaction client) this adapter uses. A real
 * `PrismaClient` satisfies it structurally, so the adapter needs no generated models and no
 * particular Prisma version — Vellum's tables are created by `vellum migrate` (RLS, append-only
 * trigger and grants can't be expressed in a Prisma schema), and everything here is raw SQL
 * identical in meaning to `PgStorageAdapter`'s.
 */
export interface PrismaQueryable {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

export interface PrismaLike extends PrismaQueryable {
  $transaction<R>(fn: (tx: PrismaQueryable) => Promise<R>): Promise<R>;
}

interface AuditEventRow {
  tenant_id: string;
  seq: bigint | number | string;
  occurred_at: Date;
  actor_id: string | null;
  actor_type: string;
  actor_label: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  changes: unknown;
  metadata: unknown;
  hash_version: number;
  prev_hash: string;
  row_hash: string;
}

interface HeadRow {
  seq: bigint | number | string;
  row_hash: string;
}

interface OutboxRow {
  id: string;
  payload: PendingAuditEvent;
}

interface CheckpointRow {
  id: string;
  tenant_id: string;
  head_seq: bigint | number | string;
  head_hash: string;
  created_at: Date;
  anchored_ref: string | null;
}

function rowToCheckpoint(row: CheckpointRow): Checkpoint {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    headSeq: Number(row.head_seq),
    headHash: row.head_hash,
    createdAt: row.created_at.toISOString(),
    anchoredRef: row.anchored_ref,
  };
}

function rowToChainRow(row: AuditEventRow): ChainRow {
  return {
    tenantId: row.tenant_id,
    seq: Number(row.seq),
    occurredAt: row.occurred_at.toISOString(),
    actor: {
      id: row.actor_id,
      type: row.actor_type as ActorType,
      label: row.actor_label,
    },
    action: row.action,
    entity: { type: row.entity_type, id: row.entity_id },
    changes: row.changes,
    metadata: row.metadata,
    hashVersion: Number(row.hash_version),
    prevHash: row.prev_hash,
    rowHash: row.row_hash,
  };
}

/**
 * Prisma implementation of StoragePort — behaviourally identical to `PgStorageAdapter`
 * (ARCHITECTURE.md §4). Every tenant-scoped operation runs in one interactive transaction that
 * first sets `vellum.tenant_id` (the RLS scope) with `set_config(..., true)`, so it is
 * transaction-local and safe under Prisma's connection pooling.
 */
export class PrismaStorageAdapter implements StoragePort<PrismaQueryable> {
  constructor(private readonly prisma: PrismaLike) {}

  async head(tenantId: string): Promise<ChainHead | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.scopeToTenant(tx, tenantId);
      return this.currentHead(tx, tenantId);
    });
  }

  async appendInline(event: PendingAuditEvent): Promise<ChainRow> {
    return this.prisma.$transaction(async (tx) => {
      await this.scopeToTenant(tx, event.tenantId);
      // Serializes same-tenant appends; different tenants proceed fully in parallel — ARCHITECTURE.md §4.3.
      // $executeRaw, not $queryRaw: the lock function returns `void`, which Prisma can't deserialize.
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)",
        event.tenantId,
      );

      const last = await this.currentHead(tx, event.tenantId);
      const seq = last ? last.seq + 1 : 1;
      const prevHash = last ? last.rowHash : GENESIS_HASH;
      const fullEvent: AuditEvent = { ...event, seq };
      const rowHash = hashEvent(prevHash, toCanonicalPayload(fullEvent));

      await this.insertAuditEventRow(tx, fullEvent, prevHash, rowHash);
      return { ...fullEvent, prevHash, rowHash };
    });
  }

  async readRange(tenantId: string, options: ReadRangeOptions = {}): Promise<ChainRow[]> {
    return this.prisma.$transaction(async (tx) => {
      await this.scopeToTenant(tx, tenantId);

      const conditions = ['tenant_id = $1::uuid'];
      const params: unknown[] = [tenantId];
      if (options.fromSeq !== undefined) {
        params.push(options.fromSeq);
        conditions.push(`seq >= $${params.length}::bigint`);
      }
      if (options.toSeq !== undefined) {
        params.push(options.toSeq);
        conditions.push(`seq <= $${params.length}::bigint`);
      }

      const rows = await tx.$queryRawUnsafe<AuditEventRow[]>(
        `SELECT * FROM audit_events WHERE ${conditions.join(' AND ')} ORDER BY seq ASC`,
        ...params,
      );
      return rows.map(rowToChainRow);
    });
  }

  async enqueue(tx: PrismaQueryable | undefined, event: PendingAuditEvent): Promise<void> {
    // A single INSERT is already atomic on its own, so a standalone call (no caller tx) runs
    // straight against the client — no explicit transaction needed for one statement.
    const client: PrismaQueryable = tx ?? this.prisma;
    await client.$executeRawUnsafe(
      'INSERT INTO audit_outbox (tenant_id, payload) VALUES ($1::uuid, $2::jsonb)',
      event.tenantId,
      JSON.stringify(event),
    );
  }

  async drainOutbox(tenantId: string, batchSize = 100): Promise<ChainRow[]> {
    return this.prisma.$transaction(async (tx) => {
      await this.scopeToTenant(tx, tenantId);

      const pending = await tx.$queryRawUnsafe<OutboxRow[]>(
        'SELECT id, payload FROM audit_outbox WHERE tenant_id = $1::uuid ORDER BY enqueued_at ASC LIMIT $2::int',
        tenantId,
        batchSize,
      );
      if (pending.length === 0) return [];

      const last = await this.currentHead(tx, tenantId);
      let seq = last?.seq ?? 0;
      let prevHash = last?.rowHash ?? GENESIS_HASH;
      const drained: ChainRow[] = [];

      for (const outboxRow of pending) {
        seq += 1;
        const fullEvent: AuditEvent = { ...outboxRow.payload, seq };
        const rowHash = hashEvent(prevHash, toCanonicalPayload(fullEvent));

        await this.insertAuditEventRow(tx, fullEvent, prevHash, rowHash);
        await tx.$executeRawUnsafe('DELETE FROM audit_outbox WHERE id = $1::uuid', outboxRow.id);

        drained.push({ ...fullEvent, prevHash, rowHash });
        prevHash = rowHash;
      }
      return drained;
    });
  }

  async listOutboxTenants(limit = 100): Promise<string[]> {
    // No RLS on audit_outbox (ARCHITECTURE.md §7 scopes RLS to the chain itself), so this
    // deliberately reads across all tenants: worker-side infrastructure, not a tenant-facing read.
    const rows = await this.prisma.$queryRawUnsafe<{ tenant_id: string }[]>(
      'SELECT tenant_id FROM audit_outbox GROUP BY tenant_id ORDER BY MIN(enqueued_at) ASC LIMIT $1::int',
      limit,
    );
    return rows.map((row) => row.tenant_id);
  }

  async recordCheckpoint(tenantId: string, anchoredRef: string | null = null): Promise<Checkpoint> {
    // An empty chain still checkpoints at the genesis hash — ARCHITECTURE.md §7.
    const head = await this.head(tenantId);
    const rows = await this.prisma.$queryRawUnsafe<CheckpointRow[]>(
      `INSERT INTO audit_checkpoints (tenant_id, head_seq, head_hash, anchored_ref)
       VALUES ($1::uuid, $2::bigint, $3, $4)
       RETURNING id, tenant_id, head_seq, head_hash, created_at, anchored_ref`,
      tenantId,
      head?.seq ?? 0,
      head?.rowHash ?? GENESIS_HASH,
      anchoredRef,
    );
    return rowToCheckpoint(rows[0]!);
  }

  private async scopeToTenant(tx: PrismaQueryable, tenantId: string): Promise<void> {
    await tx.$queryRawUnsafe("SELECT set_config('vellum.tenant_id', $1, true)", tenantId);
  }

  private async currentHead(tx: PrismaQueryable, tenantId: string): Promise<ChainHead | null> {
    const rows = await tx.$queryRawUnsafe<HeadRow[]>(
      'SELECT seq, row_hash FROM audit_events WHERE tenant_id = $1::uuid ORDER BY seq DESC LIMIT 1',
      tenantId,
    );
    const row = rows[0];
    return row ? { seq: Number(row.seq), rowHash: row.row_hash } : null;
  }

  private async insertAuditEventRow(
    tx: PrismaQueryable,
    event: AuditEvent,
    prevHash: string,
    rowHash: string,
  ): Promise<void> {
    await tx.$executeRawUnsafe(
      `INSERT INTO audit_events (
        tenant_id, seq, occurred_at, actor_id, actor_type, actor_label,
        action, entity_type, entity_id, changes, metadata, hash_version, prev_hash, row_hash
      ) VALUES ($1::uuid,$2::bigint,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::smallint,$13,$14)`,
      event.tenantId,
      event.seq,
      event.occurredAt,
      event.actor.id,
      event.actor.type,
      event.actor.label,
      event.action,
      event.entity.type,
      event.entity.id,
      JSON.stringify(event.changes ?? {}),
      JSON.stringify(event.metadata ?? {}),
      event.hashVersion,
      prevHash,
      rowHash,
    );
  }
}
