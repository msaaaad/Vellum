import { describe, expect, it } from 'vitest';
import { withAuditContext } from '@vellum/nestjs';
import { createTestRuntime } from '../test-support.js';
import { AuthService } from './auth.service.js';

const ctx = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  actor: { id: '00000000-0000-4000-8000-000000000002', type: 'user' as const, label: 'sam@x.io' },
  requestMeta: { ip: null, userAgent: null, requestId: null, route: null },
};

describe('AuthService', () => {
  it('a successful login records auth.login_succeeded via the imperative record() API', async () => {
    const { storage, audit } = createTestRuntime();
    const service = new AuthService(audit);

    const result = await withAuditContext(ctx, () =>
      service.login('00000000-0000-4000-8000-000000000005', 'correct-horse-battery-staple'),
    );

    expect(result.token).toEqual(expect.any(String));
    expect(storage.rows).toHaveLength(1);
    expect(storage.rows[0]!.action).toBe('auth.login_succeeded');
    expect(storage.rows[0]!.entity).toEqual({
      type: 'Worker',
      id: '00000000-0000-4000-8000-000000000005',
    });
  });

  it("a failed login is audited too - ARCHITECTURE.md section 4.2's 'record explicitly in a catch'", async () => {
    const { storage, audit } = createTestRuntime();
    const service = new AuthService(audit);

    await expect(
      withAuditContext(ctx, () =>
        service.login('00000000-0000-4000-8000-000000000005', 'wrong-password'),
      ),
    ).rejects.toThrow('invalid credentials');

    expect(storage.rows).toHaveLength(1);
    expect(storage.rows[0]!.action).toBe('auth.login_failed');
    expect(storage.rows[0]!.metadata).toMatchObject({ reason: 'invalid credentials' });
  });
});
