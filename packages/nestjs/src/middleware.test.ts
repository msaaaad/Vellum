import { describe, expect, it, vi } from 'vitest';
import { AuditContextMiddleware } from './middleware.js';
import { getAuditContext } from './context.js';
import type { AuditModuleOptions } from './types.js';

function baseOptions(overrides: Partial<AuditModuleOptions> = {}): AuditModuleOptions {
  return {
    storage: { adapter: 'pg', pool: {} as never },
    tenantResolver: () => 't1',
    actorResolver: () => ({ id: 'u1', type: 'user', label: 'sam@x.io' }),
    ...overrides,
  };
}

describe('AuditContextMiddleware', () => {
  it('resolves tenant/actor and makes them available to next()', async () => {
    const middleware = new AuditContextMiddleware(baseOptions());
    let seen: unknown;

    await new Promise<void>((resolve, reject) => {
      middleware.use({ headers: {} }, {}, (err) => {
        if (err) return reject(err);
        seen = getAuditContext();
        resolve();
      });
    });

    expect(seen).toMatchObject({
      tenantId: 't1',
      actor: { id: 'u1', type: 'user', label: 'sam@x.io' },
    });
  });

  it('collects ip/user-agent/request-id/route from the request', async () => {
    const middleware = new AuditContextMiddleware(baseOptions());
    let seen: unknown;

    await new Promise<void>((resolve, reject) => {
      middleware.use(
        {
          ip: '10.0.0.1',
          headers: { 'user-agent': 'vitest', 'x-request-id': 'req-1' },
          originalUrl: '/participants/1',
        },
        {},
        (err) => {
          if (err) return reject(err);
          seen = getAuditContext();
          resolve();
        },
      );
    });

    expect(seen).toMatchObject({
      requestMeta: {
        ip: '10.0.0.1',
        userAgent: 'vitest',
        requestId: 'req-1',
        route: '/participants/1',
      },
    });
  });

  it('generates a request id when the header is absent', async () => {
    const middleware = new AuditContextMiddleware(baseOptions());
    let seen: ReturnType<typeof getAuditContext>;

    await new Promise<void>((resolve, reject) => {
      middleware.use({ headers: {} }, {}, (err) => {
        if (err) return reject(err);
        seen = getAuditContext();
        resolve();
      });
    });

    expect(seen?.requestMeta.requestId).toEqual(expect.any(String));
    expect(seen?.requestMeta.requestId).not.toBe('');
  });

  it('forwards resolver errors to next(err) instead of throwing', async () => {
    const middleware = new AuditContextMiddleware(
      baseOptions({
        tenantResolver: () => {
          throw new Error('no tenant on this request');
        },
      }),
    );
    const next = vi.fn();

    await new Promise<void>((resolve) => {
      middleware.use({ headers: {} }, {}, (err) => {
        next(err);
        resolve();
      });
    });

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'no tenant on this request' }),
    );
  });

  it('leaves no context leaking after the request finishes', async () => {
    const middleware = new AuditContextMiddleware(baseOptions());
    await new Promise<void>((resolve) => {
      middleware.use({ headers: {} }, {}, () => resolve());
    });
    expect(getAuditContext()).toBeUndefined();
  });
});
