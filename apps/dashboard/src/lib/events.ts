import type { Pool } from 'pg';

export interface EventFilters {
  entityType?: string;
  actorId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface DashboardEvent {
  seq: number;
  occurredAt: string;
  actorId: string | null;
  actorType: string;
  actorLabel: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  hashVersion: number;
  prevHash: string;
  rowHash: string;
}

export const DEFAULT_PAGE_SIZE = 50;

const SELECTED_COLUMNS =
  'seq, occurred_at, actor_id, actor_type, actor_label, action, entity_type, entity_id, hash_version, prev_hash, row_hash';

export function buildEventsQuery(
  tenantId: string,
  filters: EventFilters,
): { sql: string; params: unknown[] } {
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];

  const addEqualsCondition = (column: string, value: string | undefined) => {
    if (!value) return;
    params.push(value);
    conditions.push(`${column} = $${params.length}`);
  };
  addEqualsCondition('entity_type', filters.entityType);
  addEqualsCondition('actor_id', filters.actorId);
  addEqualsCondition('action', filters.action);

  if (filters.from) {
    params.push(filters.from);
    conditions.push(`occurred_at >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    conditions.push(`occurred_at <= $${params.length}`);
  }

  params.push(filters.limit ?? DEFAULT_PAGE_SIZE);
  const limitParam = `$${params.length}`;
  params.push(filters.offset ?? 0);
  const offsetParam = `$${params.length}`;

  const sql = `SELECT ${SELECTED_COLUMNS} FROM audit_events WHERE ${conditions.join(' AND ')} ORDER BY seq DESC LIMIT ${limitParam} OFFSET ${offsetParam}`;
  return { sql, params };
}

interface AuditEventRow {
  seq: string;
  occurred_at: Date;
  actor_id: string | null;
  actor_type: string;
  actor_label: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  hash_version: number;
  prev_hash: string;
  row_hash: string;
}

function mapRowToDashboardEvent(row: AuditEventRow): DashboardEvent {
  return {
    seq: Number(row.seq),
    occurredAt: row.occurred_at.toISOString(),
    actorId: row.actor_id,
    actorType: row.actor_type,
    actorLabel: row.actor_label,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    hashVersion: row.hash_version,
    prevHash: row.prev_hash,
    rowHash: row.row_hash,
  };
}

export async function queryEvents(
  pool: Pool,
  tenantId: string,
  filters: EventFilters,
): Promise<DashboardEvent[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('vellum.tenant_id', $1, true)", [tenantId]);
    const { sql, params } = buildEventsQuery(tenantId, filters);
    const queryResult = await client.query<AuditEventRow>(sql, params);
    await client.query('COMMIT');
    return queryResult.rows.map(mapRowToDashboardEvent);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
