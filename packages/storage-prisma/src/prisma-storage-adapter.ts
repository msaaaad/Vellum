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
} from '@attestly/core';

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
  actor_type: ActorType;
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

function mapRowToCheckpoint(row: CheckpointRow): Checkpoint {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    headSeq: Number(row.head_seq),
    headHash: row.head_hash,
    createdAt: row.created_at.toISOString(),
    anchoredRef: row.anchored_ref,
  };
}

function mapRowToChainRow(row: AuditEventRow): ChainRow {
  return {
    tenantId: row.tenant_id,
    seq: Number(row.seq),
    occurredAt: row.occurred_at.toISOString(),
    actor: {
      id: row.actor_id,
      type: row.actor_type,
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

export class PrismaStorageAdapter implements StoragePort<PrismaQueryable> {
  constructor(private readonly prisma: PrismaLike) {}

  async head(tenantId: string): Promise<ChainHead | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.scopeToTenant(tx, tenantId);
      return this.loadCurrentHead(tx, tenantId);
    });
  }

  async appendInline(event: PendingAuditEvent): Promise<ChainRow> {
    return this.prisma.$transaction(async (tx) => {
      await this.scopeToTenant(tx, event.tenantId);
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)",
        event.tenantId,
      );

      const currentHead = await this.loadCurrentHead(tx, event.tenantId);
      const seq = currentHead ? currentHead.seq + 1 : 1;
      const prevHash = currentHead ? currentHead.rowHash : GENESIS_HASH;
      const sequencedEvent: AuditEvent = { ...event, seq };
      const rowHash = hashEvent(prevHash, toCanonicalPayload(sequencedEvent));

      await this.insertAuditEventRow(tx, sequencedEvent, prevHash, rowHash);
      return { ...sequencedEvent, prevHash, rowHash };
    });
  }

  async readRange(tenantId: string, options?: ReadRangeOptions): Promise<ChainRow[]> {
    return this.prisma.$transaction(async (tx) => {
      await this.scopeToTenant(tx, tenantId);

      const conditions = ['tenant_id = $1::uuid'];
      const params: unknown[] = [tenantId];
      if (options?.fromSeq !== undefined) {
        params.push(options.fromSeq);
        conditions.push(`seq >= $${params.length}::bigint`);
      }
      if (options?.toSeq !== undefined) {
        params.push(options.toSeq);
        conditions.push(`seq <= $${params.length}::bigint`);
      }

      const rows = await tx.$queryRawUnsafe<AuditEventRow[]>(
        `SELECT * FROM audit_events WHERE ${conditions.join(' AND ')} ORDER BY seq ASC`,
        ...params,
      );
      return rows.map(mapRowToChainRow);
    });
  }

  async enqueue(tx: PrismaQueryable | undefined, event: PendingAuditEvent): Promise<void> {
    const client: PrismaQueryable = tx ?? this.prisma;
    await client.$executeRawUnsafe(
      'INSERT INTO audit_outbox (tenant_id, payload) VALUES ($1::uuid, $2::jsonb)',
      event.tenantId,
      JSON.stringify(event),
    );
  }

  async drainOutbox(tenantId: string, batchSize: number): Promise<ChainRow[]> {
    return this.prisma.$transaction(async (tx) => {
      await this.scopeToTenant(tx, tenantId);

      const pendingRows = await tx.$queryRawUnsafe<OutboxRow[]>(
        'SELECT id, payload FROM audit_outbox WHERE tenant_id = $1::uuid ORDER BY enqueued_at ASC LIMIT $2::int',
        tenantId,
        batchSize,
      );
      if (pendingRows.length === 0) return [];

      const currentHead = await this.loadCurrentHead(tx, tenantId);
      let seq = currentHead?.seq ?? 0;
      let prevHash = currentHead?.rowHash ?? GENESIS_HASH;
      const drainedRows: ChainRow[] = [];

      for (const outboxRow of pendingRows) {
        seq += 1;
        const sequencedEvent: AuditEvent = { ...outboxRow.payload, seq };
        const rowHash = hashEvent(prevHash, toCanonicalPayload(sequencedEvent));

        await this.insertAuditEventRow(tx, sequencedEvent, prevHash, rowHash);
        await tx.$executeRawUnsafe('DELETE FROM audit_outbox WHERE id = $1::uuid', outboxRow.id);

        drainedRows.push({ ...sequencedEvent, prevHash, rowHash });
        prevHash = rowHash;
      }
      return drainedRows;
    });
  }

  async listOutboxTenants(limit: number): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ tenant_id: string }[]>(
      'SELECT tenant_id FROM audit_outbox GROUP BY tenant_id ORDER BY MIN(enqueued_at) ASC LIMIT $1::int',
      limit,
    );
    return rows.map((row) => row.tenant_id);
  }

  async recordCheckpoint(tenantId: string, anchoredRef: string | null): Promise<Checkpoint> {
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
    return mapRowToCheckpoint(rows[0]!);
  }

  private async scopeToTenant(tx: PrismaQueryable, tenantId: string): Promise<void> {
    await tx.$queryRawUnsafe("SELECT set_config('vellum.tenant_id', $1, true)", tenantId);
  }

  private async loadCurrentHead(tx: PrismaQueryable, tenantId: string): Promise<ChainHead | null> {
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
