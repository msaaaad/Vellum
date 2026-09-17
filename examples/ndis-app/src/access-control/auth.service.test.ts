import { describe, expect, it } from 'vitest';
import { withAuditContext } from '@vellum/nestjs';
import { createTestRuntime } from '../test-support.js';
import { AuthService } from './auth.service.js';

const ctx = {
  tenantId: 't1',
  actor: { id: 'u1', type: 'user' as const, label: 'sam@x.io' },
  requestMeta: { ip: null, userAgent: null, requestId: null, route: null },
};

describe('AuthService', () => {
  it('a successful login records auth.login_succeeded via the imperative record() API', async () => {
    const { storage, audit } = createTestRuntime();
    const service = new AuthService(audit);

    const result = await withAuditContext(ctx, () =>
      service.login('worker-1', 'correct-horse-battery-staple'),
    );

    expect(result.token).toEqual(expect.any(String));
    expect(storage.rows).toHaveLength(1);
    expect(storage.rows[0]!.action).toBe('auth.login_succeeded');
    expect(storage.rows[0]!.entity).toEqual({ type: 'Worker', id: 'worker-1' });
  });

  it("a failed login is audited too — ARCHITECTURE.md §4.2's 'record explicitly in a catch'", async () => {
    const { storage, audit } = createTestRuntime();
    const service = new AuthService(audit);

    await expect(
      withAuditContext(ctx, () => service.login('worker-1', 'wrong-password')),
    ).rejects.toThrow('invalid credentials');

    expect(storage.rows).toHaveLength(1);
    expect(storage.rows[0]!.action).toBe('auth.login_failed');
    expect(storage.rows[0]!.metadata).toMatchObject({ reason: 'invalid credentials' });
  });
});
