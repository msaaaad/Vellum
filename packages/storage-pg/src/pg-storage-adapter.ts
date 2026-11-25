import type { Pool, PoolClient, QueryResultRow } from 'pg';
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

interface AuditEventRow extends QueryResultRow {
  tenant_id: string;
  seq: string;
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

interface HeadRow extends QueryResultRow {
  seq: string;
  row_hash: string;
}

interface OutboxRow extends QueryResultRow {
  id: string;
  payload: PendingAuditEvent;
}

interface CheckpointRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  head_seq: string;
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
    hashVersion: row.hash_version,
    prevHash: row.prev_hash,
    rowHash: row.row_hash,
  };
}

export class PgStorageAdapter implements StoragePort<PoolClient> {
  constructor(private readonly pool: Pool) {}

  async head(tenantId: string): Promise<ChainHead | null> {
    return this.runInTenantTransaction(tenantId, (client) => this.loadCurrentHead(client, tenantId));
  }

  async appendInline(event: PendingAuditEvent): Promise<ChainRow> {
    return this.runInTenantTransaction(event.tenantId, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)",
        [event.tenantId],
      );

      const currentHead = await this.loadCurrentHead(client, event.tenantId);
      const seq = currentHead ? currentHead.seq + 1 : 1;
      const prevHash = currentHead ? currentHead.rowHash : GENESIS_HASH;
      const sequencedEvent: AuditEvent = { ...event, seq };
      const rowHash = hashEvent(prevHash, toCanonicalPayload(sequencedEvent));

      await this.insertAuditEventRow(client, sequencedEvent, prevHash, rowHash);
      return { ...sequencedEvent, prevHash, rowHash };
    });
  }

  async readRange(tenantId: string, options?: ReadRangeOptions): Promise<ChainRow[]> {
    return this.runInTenantTransaction(tenantId, async (client) => {
      const conditions = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (options?.fromSeq !== undefined) {
        params.push(options.fromSeq);
        conditions.push(`seq >= $${params.length}`);
      }
      if (options?.toSeq !== undefined) {
        params.push(options.toSeq);
        conditions.push(`seq <= $${params.length}`);
      }

      const queryResult = await client.query<AuditEventRow>(
        `SELECT * FROM audit_events WHERE ${conditions.join(' AND ')} ORDER BY seq ASC`,
        params,
      );
      return queryResult.rows.map(mapRowToChainRow);
    });
  }

  async enqueue(tx: PoolClient | undefined, event: PendingAuditEvent): Promise<void> {
    const queryable = tx ?? this.pool;
    await queryable.query('INSERT INTO audit_outbox (tenant_id, payload) VALUES ($1, $2)', [
      event.tenantId,
      JSON.stringify(event),
    ]);
  }

  async drainOutbox(tenantId: string, batchSize: number): Promise<ChainRow[]> {
    return this.runInTenantTransaction(tenantId, async (client) => {
      const pendingResult = await client.query<OutboxRow>(
        'SELECT id, payload FROM audit_outbox WHERE tenant_id = $1 ORDER BY enqueued_at ASC LIMIT $2',
        [tenantId, batchSize],
      );
      if (pendingResult.rows.length === 0) {
        return [];
      }

      const currentHead = await this.loadCurrentHead(client, tenantId);
      let seq = currentHead?.seq ?? 0;
      let prevHash = currentHead?.rowHash ?? GENESIS_HASH;
      const drainedRows: ChainRow[] = [];

      for (const outboxRow of pendingResult.rows) {
        seq += 1;
        const sequencedEvent: AuditEvent = { ...outboxRow.payload, seq };
        const rowHash = hashEvent(prevHash, toCanonicalPayload(sequencedEvent));

        await this.insertAuditEventRow(client, sequencedEvent, prevHash, rowHash);
        await client.query('DELETE FROM audit_outbox WHERE id = $1', [outboxRow.id]);

        drainedRows.push({ ...sequencedEvent, prevHash, rowHash });
        prevHash = rowHash;
      }

      return drainedRows;
    });
  }

  async listOutboxTenants(limit: number): Promise<string[]> {
    const queryResult = await this.pool.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM audit_outbox GROUP BY tenant_id ORDER BY MIN(enqueued_at) ASC LIMIT $1',
      [limit],
    );
    return queryResult.rows.map((row) => row.tenant_id);
  }

  async recordCheckpoint(tenantId: string, anchoredRef: string | null): Promise<Checkpoint> {
    const currentHead = await this.head(tenantId);
    const queryResult = await this.pool.query<CheckpointRow>(
      `INSERT INTO audit_checkpoints (tenant_id, head_seq, head_hash, anchored_ref)
       VALUES ($1, $2, $3, $4)
       RETURNING id, tenant_id, head_seq, head_hash, created_at, anchored_ref`,
      [tenantId, currentHead?.seq ?? 0, currentHead?.rowHash ?? GENESIS_HASH, anchoredRef],
    );
    return mapRowToCheckpoint(queryResult.rows[0]!);
  }

  private async runInTenantTransaction<TResult>(
    tenantId: string,
    work: (client: PoolClient) => Promise<TResult>,
  ): Promise<TResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('vellum.tenant_id', $1, true)", [tenantId]);
      const workResult = await work(client);
      await client.query('COMMIT');
      return workResult;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async loadCurrentHead(client: PoolClient, tenantId: string): Promise<ChainHead | null> {
    const queryResult = await client.query<HeadRow>(
      'SELECT seq, row_hash FROM audit_events WHERE tenant_id = $1 ORDER BY seq DESC LIMIT 1',
      [tenantId],
    );
    const headRow = queryResult.rows[0];
    return headRow ? { seq: Number(headRow.seq), rowHash: headRow.row_hash } : null;
  }

  private async insertAuditEventRow(
    client: PoolClient,
    event: AuditEvent,
    prevHash: string,
    rowHash: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_events (
        tenant_id, seq, occurred_at, actor_id, actor_type, actor_label,
        action, entity_type, entity_id, changes, metadata, hash_version, prev_hash, row_hash
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
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
      ],
    );
  }
}
