import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, QueryResultRow } from 'pg';
import { Audited, getAuditContext } from '@vellum/nestjs';
import { EXAMPLE_PG_POOL } from '../db.js';
import type { ServiceAgreement } from '../types.js';

interface ServiceAgreementRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  participant_id: string;
  ndis_plan_period: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

function rowToAgreement(row: ServiceAgreementRow): ServiceAgreement {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    participantId: row.participant_id,
    ndisPlanPeriod: row.ndis_plan_period,
    status: row.status as ServiceAgreement['status'],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function requireTenantId(): string {
  const ctx = getAuditContext();
  if (!ctx) throw new Error('ServiceAgreementsService called outside an audit context');
  return ctx.tenantId;
}

/**
 * DOMAIN_CHECKLIST.md §6.4 — "draft create/edit via decorator (snapshot/diff)". Real Postgres
 * rows (not in-memory), same database Vellum's own audit trail lives in — same as ClaimsService,
 * since the two share a schema in a real app.
 */
@Injectable()
export class ServiceAgreementsService {
  constructor(@Inject(EXAMPLE_PG_POOL) private readonly pool: Pool) {}

  @Audited({
    action: 'agreement.created',
    entity: 'ServiceAgreement',
    entityId: (c) => (c.result as ServiceAgreement).id,
    capture: 'snapshot',
  })
  async create(participantId: string, ndisPlanPeriod: string): Promise<ServiceAgreement> {
    const result = await this.pool.query<ServiceAgreementRow>(
      `INSERT INTO example_service_agreements (id, tenant_id, participant_id, ndis_plan_period, status)
       VALUES ($1, $2, $3, $4, 'draft')
       RETURNING *`,
      [randomUUID(), requireTenantId(), participantId, ndisPlanPeriod],
    );
    return rowToAgreement(result.rows[0]!);
  }

  @Audited({
    action: 'agreement.updated',
    entity: 'ServiceAgreement',
    entityId: (c) => c.args[0] as string,
    capture: 'diff',
    loadBefore: (c) => (c.self as ServiceAgreementsService).findByIdOrThrow(c.args[0] as string),
  })
  async update(
    id: string,
    patch: Partial<Pick<ServiceAgreement, 'status' | 'ndisPlanPeriod'>>,
  ): Promise<ServiceAgreement> {
    const existing = await this.findByIdOrThrow(id);
    const merged = { ...existing, ...patch };
    const result = await this.pool.query<ServiceAgreementRow>(
      `UPDATE example_service_agreements SET status = $1, ndis_plan_period = $2, updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [merged.status, merged.ndisPlanPeriod, id],
    );
    return rowToAgreement(result.rows[0]!);
  }

  async findByIdOrThrow(id: string): Promise<ServiceAgreement> {
    const result = await this.pool.query<ServiceAgreementRow>(
      'SELECT * FROM example_service_agreements WHERE id = $1',
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`service agreement not found: ${id}`);
    return rowToAgreement(row);
  }
}
