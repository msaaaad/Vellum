import { describe, expect, it } from 'vitest';
import { getAuditContext, withAuditContext } from './context.js';

const ctxA = {
  tenantId: 't1',
  actor: { id: 'u1', type: 'user' as const, label: null },
  requestMeta: { ip: null, userAgent: null, requestId: null, route: null },
};
const ctxB = {
  tenantId: 't2',
  actor: { id: null, type: 'system' as const, label: null },
  requestMeta: { ip: null, userAgent: null, requestId: null, route: null },
};

describe('withAuditContext / getAuditContext', () => {
  it('is undefined outside any withAuditContext block', () => {
    expect(getAuditContext()).toBeUndefined();
  });

  it('exposes the context for the duration of the callback', () => {
    withAuditContext(ctxA, () => {
      expect(getAuditContext()).toEqual(ctxA);
    });
    expect(getAuditContext()).toBeUndefined();
  });

  it('propagates across an async callback', async () => {
    await withAuditContext(ctxA, async () => {
      await Promise.resolve();
      expect(getAuditContext()).toEqual(ctxA);
    });
  });

  it('keeps concurrent contexts isolated from each other', async () => {
    const results: string[] = [];
    await Promise.all([
      withAuditContext(ctxA, async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(getAuditContext()?.tenantId ?? 'missing');
      }),
      withAuditContext(ctxB, async () => {
        results.push(getAuditContext()?.tenantId ?? 'missing');
      }),
    ]);
    expect(results.sort()).toEqual(['t1', 't2']);
  });

  it('supports nesting, restoring the outer context on exit', () => {
    withAuditContext(ctxA, () => {
      withAuditContext(ctxB, () => {
        expect(getAuditContext()).toEqual(ctxB);
      });
      expect(getAuditContext()).toEqual(ctxA);
    });
  });
});
