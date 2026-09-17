import { describe, expect, it } from 'vitest';
import { withAuditContext } from '@vellum/nestjs';
import { createTestRuntime } from '../test-support.js';
import { RolesService } from './roles.service.js';

const ctx = {
  tenantId: 't1',
  actor: { id: 'u1', type: 'user' as const, label: 'sam@x.io' },
  requestMeta: { ip: null, userAgent: null, requestId: null, route: null },
};

function setup() {
  const { storage } = createTestRuntime();
  return { storage, service: new RolesService() };
}

describe('RolesService', () => {
  it('role.assigned is a snapshot with assignedBy metadata', async () => {
    const { storage, service } = setup();

    const role = await withAuditContext(ctx, () =>
      service.assign('worker-1', 'support-coordinator', 'admin-1'),
    );

    const row = storage.rows[0]!;
    expect(row.action).toBe('role.assigned');
    expect(row.changes).toEqual({ after: role });
    expect(row.metadata).toMatchObject({ assignedBy: 'admin-1' });
  });

  it('role.revoked is a diff against the pre-revoke record', async () => {
    const { storage, service } = setup();

    const role = await withAuditContext(ctx, () =>
      service.assign('worker-1', 'support-coordinator', 'admin-1'),
    );
    await withAuditContext(ctx, () => service.revoke(role.id, 'admin-2'));

    const row = storage.rows[1]!;
    expect(row.action).toBe('role.revoked');
    expect(row.changes).toMatchObject({ diff: { revokedAt: [null, expect.any(String)] } });
    expect(row.metadata).toMatchObject({ assignedBy: 'admin-2' });
  });
});
