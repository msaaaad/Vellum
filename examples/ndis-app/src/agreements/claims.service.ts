import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { AuditService } from '@attestly/nestjs';
import { EXAMPLE_PG_POOL } from '../db.js';
import { getTenantIdOrFail } from '../tenant-context.js';
import type { Claim, ClaimStatus } from '../types.js';

interface ClaimRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  service_agreement_id: string;
  participant_id: string;
  ndis_period: string;
  amount_cents: string;
  bank_account: string;
  status: ClaimStatus;
  created_at: Date;
  updated_at: Date;
}

function mapRowToClaim(row: ClaimRow): Claim {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    serviceAgreementId: row.service_agreement_id,
    participantId: row.participant_id,
    ndisPeriod: row.ndis_period,
    amountCents: Number(row.amount_cents),
    bankAccount: row.bank_account,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface CreateClaimInput {
  ndisPeriod: string;
  amountCents: number;
  bankAccount: string;
}

@Injectable()
export class ClaimsService {
  constructor(
    @Inject(EXAMPLE_PG_POOL) private readonly pool: Pool,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(
    serviceAgreementId: string,
    participantId: string,
    input: CreateClaimInput,
  ): Promise<Claim> {
    const queryResult = await this.pool.query<ClaimRow>(
      `INSERT INTO example_claims
         (id, tenant_id, service_agreement_id, participant_id, ndis_period, amount_cents, bank_account, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
       RETURNING *`,
      [
        randomUUID(),
        getTenantIdOrFail('ClaimsService'),
        serviceAgreementId,
        participantId,
        input.ndisPeriod,
        input.amountCents,
        input.bankAccount,
      ],
    );
    return mapRowToClaim(queryResult.rows[0]!);
  }

  async getByIdOrFail(id: string): Promise<Claim> {
    const queryResult = await this.pool.query<ClaimRow>(
      'SELECT * FROM example_claims WHERE id = $1',
      [id],
    );
    const row = queryResult.rows[0];
    if (!row) throw new Error(`claim not found: ${id}`);
    return mapRowToClaim(row);
  }

  async submit(claimId: string): Promise<Claim> {
    return this.transition(claimId, 'submitted', 'claim.submitted');
  }

  async approve(claimId: string): Promise<Claim> {
    return this.transition(claimId, 'approved', 'claim.approved');
  }

  async pay(claimId: string): Promise<Claim> {
    return this.transition(claimId, 'paid', 'claim.paid');
  }

  private async transition(claimId: string, toStatus: ClaimStatus, action: string): Promise<Claim> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const queryResult = await client.query<ClaimRow>(
        `UPDATE example_claims SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
        [toStatus, claimId],
      );
      const row = queryResult.rows[0];
      if (!row) throw new Error(`claim not found: ${claimId}`);
      const claim = mapRowToClaim(row);

      const { bankAccount: _bankAccount, ...claimWithoutBankDetails } = claim;
      await this.audit.enqueue(client, {
        action,
        entity: 'Claim',
        entityId: claim.id,
        changes: { after: claimWithoutBankDetails },
        metadata: { ndisPeriod: claim.ndisPeriod, amountCents: claim.amountCents },
      });

      await client.query('COMMIT');
      return claim;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
