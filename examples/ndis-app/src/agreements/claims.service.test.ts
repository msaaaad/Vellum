import { describe, expect, it, vi } from 'vitest';
import { withAuditContext } from '@attestly/nestjs';
import { createTestRuntime } from '../test-support.js';
import { ClaimsService } from './claims.service.js';

const ctx = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  actor: { id: '00000000-0000-4000-8000-000000000002', type: 'user' as const, label: 'sam@x.io' },
  requestMeta: { ip: null, userAgent: null, requestId: null, route: null },
};

const CLAIM_ROW = {
  id: '00000000-0000-4000-8000-000000000006',
  tenant_id: '00000000-0000-4000-8000-000000000001',
  service_agreement_id: '00000000-0000-4000-8000-000000000009',
  participant_id: '00000000-0000-4000-8000-000000000007',
  ndis_period: '2026-01',
  amount_cents: '15000',
  bank_account: '123-456 00998877',
  status: 'submitted',
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-02T00:00:00.000Z'),
};

function fakePool() {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn(),
  };
  return { pool, client };
}

describe('ClaimsService - DOMAIN_CHECKLIST.md section 6.4 "money -> atomic API"', () => {
  it('claim.submitted enqueues inside the same transaction as the status update, bank account excluded', async () => {
    const { audit } = createTestRuntime();
    const enqueueSpy = vi.spyOn(audit, 'enqueue');
    const { pool, client } = fakePool();
    client.query.mockImplementation((sql: string) => {
      if (sql.startsWith('UPDATE')) return Promise.resolve({ rows: [CLAIM_ROW] });
      return Promise.resolve({ rows: [] });
    });
    const service = new ClaimsService(pool as never, audit);

    const claim = await withAuditContext(ctx, () =>
      service.submit('00000000-0000-4000-8000-000000000006'),
    );

    expect(claim.status).toBe('submitted');
    expect(claim.bankAccount).toBe(CLAIM_ROW.bank_account);

    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();

    expect(enqueueSpy).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        action: 'claim.submitted',
        entity: 'Claim',
        entityId: '00000000-0000-4000-8000-000000000006',
        metadata: { ndisPeriod: '2026-01', amountCents: 15_000 },
      }),
    );
    const enqueuedChanges = enqueueSpy.mock.calls[0]![1].changes as {
      after: Record<string, unknown>;
    };
    expect(enqueuedChanges.after).not.toHaveProperty('bankAccount');
  });

  it('rolls back the business update if the enqueue fails - atomicity, not best-effort', async () => {
    const { audit } = createTestRuntime();
    vi.spyOn(audit, 'enqueue').mockRejectedValue(new Error('outbox insert failed'));
    const { pool, client } = fakePool();
    client.query.mockImplementation((sql: string) => {
      if (sql.startsWith('UPDATE')) return Promise.resolve({ rows: [CLAIM_ROW] });
      return Promise.resolve({ rows: [] });
    });
    const service = new ClaimsService(pool as never, audit);

    await expect(
      withAuditContext(ctx, () => service.approve('00000000-0000-4000-8000-000000000006')),
    ).rejects.toThrow('outbox insert failed');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('claim.paid uses the same transactional path as submit/approve', async () => {
    const { audit } = createTestRuntime();
    const enqueueSpy = vi.spyOn(audit, 'enqueue');
    const { pool, client } = fakePool();
    client.query.mockImplementation((sql: string) => {
      if (sql.startsWith('UPDATE'))
        return Promise.resolve({ rows: [{ ...CLAIM_ROW, status: 'paid' }] });
      return Promise.resolve({ rows: [] });
    });
    const service = new ClaimsService(pool as never, audit);

    await withAuditContext(ctx, () => service.pay('00000000-0000-4000-8000-000000000006'));

    expect(enqueueSpy).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ action: 'claim.paid' }),
    );
  });
});
