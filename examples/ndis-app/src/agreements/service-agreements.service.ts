import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, QueryResultRow } from 'pg';
import { Audited } from '@getattestly/nestjs';
import { EXAMPLE_PG_POOL } from '../db.js';
import { getTenantIdOrFail } from '../tenant-context.js';
import type { ServiceAgreement } from '../types.js';

interface ServiceAgreementRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  participant_id: string;
  ndis_plan_period: string;
  status: ServiceAgreement['status'];
  created_at: Date;
  updated_at: Date;
}

function mapRowToServiceAgreement(row: ServiceAgreementRow): ServiceAgreement {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    participantId: row.participant_id,
    ndisPlanPeriod: row.ndis_plan_period,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class ServiceAgreementsService {
  constructor(@Inject(EXAMPLE_PG_POOL) private readonly pool: Pool) {}

  @Audited({
    action: 'agreement.created',
    entity: 'ServiceAgreement',
    entityId: (pointcut) => (pointcut.result as ServiceAgreement).id,
    capture: 'snapshot',
  })
  async create(participantId: string, ndisPlanPeriod: string): Promise<ServiceAgreement> {
    const queryResult = await this.pool.query<ServiceAgreementRow>(
      `INSERT INTO example_service_agreements (id, tenant_id, participant_id, ndis_plan_period, status)
       VALUES ($1, $2, $3, $4, 'draft')
       RETURNING *`,
      [randomUUID(), getTenantIdOrFail('ServiceAgreementsService'), participantId, ndisPlanPeriod],
    );
    return mapRowToServiceAgreement(queryResult.rows[0]!);
  }

  @Audited({
    action: 'agreement.updated',
    entity: 'ServiceAgreement',
    entityId: (pointcut) => pointcut.args[0] as string,
    capture: 'diff',
    loadBefore: (pointcut) =>
      (pointcut.self as ServiceAgreementsService).getByIdOrFail(pointcut.args[0] as string),
  })
  async update(
    id: string,
    patch: Partial<Pick<ServiceAgreement, 'status' | 'ndisPlanPeriod'>>,
  ): Promise<ServiceAgreement> {
    const existing = await this.getByIdOrFail(id);
    const merged = { ...existing, ...patch };
    const queryResult = await this.pool.query<ServiceAgreementRow>(
      `UPDATE example_service_agreements SET status = $1, ndis_plan_period = $2, updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [merged.status, merged.ndisPlanPeriod, id],
    );
    return mapRowToServiceAgreement(queryResult.rows[0]!);
  }

  async getByIdOrFail(id: string): Promise<ServiceAgreement> {
    const queryResult = await this.pool.query<ServiceAgreementRow>(
      'SELECT * FROM example_service_agreements WHERE id = $1',
      [id],
    );
    const row = queryResult.rows[0];
    if (!row) throw new Error(`service agreement not found: ${id}`);
    return mapRowToServiceAgreement(row);
  }
}
