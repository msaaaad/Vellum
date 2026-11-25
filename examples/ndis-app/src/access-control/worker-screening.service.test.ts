import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { withAuditContext } from '@getattestly/nestjs';
import { createTestRuntime } from '../test-support.js';
import { WorkerScreeningService } from './worker-screening.service.js';

const ctx = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  actor: { id: '00000000-0000-4000-8000-000000000002', type: 'user' as const, label: 'sam@x.io' },
  requestMeta: { ip: null, userAgent: null, requestId: null, route: null },
};

function setup() {
  const { storage } = createTestRuntime();
  return { storage, service: new WorkerScreeningService() };
}

describe('WorkerScreeningService', () => {
  it('worker_screening.updated diffs an expiry change - DOMAIN_CHECKLIST.md section 6.5', async () => {
    const { storage, service } = setup();
    const screening = service.seed({
      id: randomUUID(),
      workerId: '00000000-0000-4000-8000-000000000005',
      checkType: 'NDIS Worker Screening',
      expiresAt: '2026-12-31',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });

    await withAuditContext(ctx, () => service.update(screening.id, { expiresAt: '2027-06-30' }));

    expect(storage.rows).toHaveLength(1);
    const row = storage.rows[0]!;
    expect(row.action).toBe('worker_screening.updated');
    expect(row.changes).toMatchObject({ diff: { expiresAt: ['2026-12-31', '2027-06-30'] } });
  });
});
