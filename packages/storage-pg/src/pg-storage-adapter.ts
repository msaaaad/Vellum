import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  GENESIS_HASH,
  hashEvent,
  toCanonicalPayload,
  type ActorType,
  type AuditEvent,
  type ChainHead,
  type ChainRow,
  type PendingAuditEvent,
  type ReadRangeOptions,
  type StoragePort,
} from '@vellum/core';

interface AuditEventRow extends QueryResultRow {
  tenant_id: string;
  seq: string;
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

interface HeadRow extends QueryResultRow {
  seq: string;
  row_hash: string;
}

interface OutboxRow extends QueryResultRow {
  id: string;
  payload: PendingAuditEvent;
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
    hashVersion: row.hash_version,
    prevHash: row.prev_hash,
    rowHash: row.row_hash,
  };
}

/** node-postgres implementation of StoragePort — ARCHITECTURE.md §4. */
export class PgStorageAdapter implements StoragePort<PoolClient> {
  constructor(private readonly pool: Pool) {}

  async head(tenantId: string): Promise<ChainHead | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('vellum.tenant_id', $1, true)", [tenantId]);
      const result = await this.currentHead(client, tenantId);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async appendInline(event: PendingAuditEvent): Promise<ChainRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('vellum.tenant_id', $1, true)", [event.tenantId]);
      // Serializes same-tenant appends; different tenants proceed fully in parallel — ARCHITECTURE.md §4.3.
      await client.query(
        "SELECT pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)",
        [event.tenantId],
      );

      const last = await this.currentHead(client, event.tenantId);
      const seq = last ? last.seq + 1 : 1;
      const prevHash = last ? last.rowHash : GENESIS_HASH;
      const fullEvent: AuditEvent = { ...event, seq };
      const rowHash = hashEvent(prevHash, toCanonicalPayload(fullEvent));

      await this.insertAuditEventRow(client, fullEvent, prevHash, rowHash);
      await client.query('COMMIT');
      return { ...fullEvent, prevHash, rowHash };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async readRange(tenantId: string, options: ReadRangeOptions = {}): Promise<ChainRow[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('vellum.tenant_id', $1, true)", [tenantId]);

      const conditions = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (options.fromSeq !== undefined) {
        params.push(options.fromSeq);
        conditions.push(`seq >= $${params.length}`);
      }
      if (options.toSeq !== undefined) {
        params.push(options.toSeq);
        conditions.push(`seq <= $${params.length}`);
      }

      const result = await client.query<AuditEventRow>(
        `SELECT * FROM audit_events WHERE ${conditions.join(' AND ')} ORDER BY seq ASC`,
        params,
      );
      await client.query('COMMIT');
      return result.rows.map(rowToChainRow);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async enqueue(tx: PoolClient, event: PendingAuditEvent): Promise<void> {
    await tx.query('INSERT INTO audit_outbox (tenant_id, payload) VALUES ($1, $2)', [
      event.tenantId,
      JSON.stringify(event),
    ]);
  }

  async drainOutbox(tenantId: string, batchSize = 100): Promise<ChainRow[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('vellum.tenant_id', $1, true)", [tenantId]);

      const pending = await client.query<OutboxRow>(
        'SELECT id, payload FROM audit_outbox WHERE tenant_id = $1 ORDER BY enqueued_at ASC LIMIT $2',
        [tenantId, batchSize],
      );
      if (pending.rows.length === 0) {
        await client.query('COMMIT');
        return [];
      }

      const last = await this.currentHead(client, tenantId);
      let seq = last?.seq ?? 0;
      let prevHash = last?.rowHash ?? GENESIS_HASH;
      const drained: ChainRow[] = [];

      for (const outboxRow of pending.rows) {
        seq += 1;
        const fullEvent: AuditEvent = { ...outboxRow.payload, seq };
        const rowHash = hashEvent(prevHash, toCanonicalPayload(fullEvent));

        await this.insertAuditEventRow(client, fullEvent, prevHash, rowHash);
        await client.query('DELETE FROM audit_outbox WHERE id = $1', [outboxRow.id]);

        drained.push({ ...fullEvent, prevHash, rowHash });
        prevHash = rowHash;
      }

      await client.query('COMMIT');
      return drained;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async currentHead(client: PoolClient, tenantId: string): Promise<ChainHead | null> {
    const result = await client.query<HeadRow>(
      'SELECT seq, row_hash FROM audit_events WHERE tenant_id = $1 ORDER BY seq DESC LIMIT 1',
      [tenantId],
    );
    const row = result.rows[0];
    return row ? { seq: Number(row.seq), rowHash: row.row_hash } : null;
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
