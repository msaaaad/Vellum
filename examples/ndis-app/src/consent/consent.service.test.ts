import { describe, expect, it } from 'vitest';
import { verifyChain } from '@vellum/core';
import { withAuditContext } from '@vellum/nestjs';
import { createTestRuntime } from '../test-support.js';
import { ConsentService } from './consent.service.js';

const ctx = {
  tenantId: 't1',
  actor: { id: 'u1', type: 'user' as const, label: 'sam@x.io' },
  requestMeta: { ip: null, userAgent: null, requestId: null, route: null },
};

function setup() {
  const { storage } = createTestRuntime();
  return { storage, service: new ConsentService() };
}

describe('ConsentService', () => {
  it('consent.granted redacts the signature image, keeping method/relationship as metadata', async () => {
    const { storage, service } = setup();

    await withAuditContext(ctx, () =>
      service.grant('p1', {
        method: 'written',
        relationship: 'self',
        signatureImage: 'data:image/png;base64,AAAA',
      }),
    );

    const row = storage.rows[0]!;
    expect(row.action).toBe('consent.granted');
    expect(row.changes).toMatchObject({ after: { method: 'written', relationship: 'self' } });
    expect(row.changes).not.toHaveProperty('after.signatureImage');
    expect(row.metadata).toMatchObject({ method: 'written', relationship: 'self' });
  });

  it('consent.revoked snapshots the pre-revoke record (still redacted) with the reason as metadata', async () => {
    const { storage, service } = setup();

    const consent = await withAuditContext(ctx, () =>
      service.grant('p1', {
        method: 'written',
        relationship: 'self',
        signatureImage: 'data:image/png;base64,AAAA',
      }),
    );
    await withAuditContext(ctx, () =>
      service.revoke(consent.id, { reason: 'participant withdrew consent' }),
    );

    const row = storage.rows[1]!;
    expect(row.action).toBe('consent.revoked');
    // The pre-revoke snapshot still shows status: 'granted' — that's the point: it preserves what
    // was originally granted, not the post-revoke row.
    expect(row.changes).toMatchObject({ after: { status: 'granted', method: 'written' } });
    expect(row.changes).not.toHaveProperty('after.signatureImage');
    expect(row.metadata).toMatchObject({ reason: 'participant withdrew consent' });
  });

  it('consent.viewed carries no payload', async () => {
    const { storage, service } = setup();

    const consent = await withAuditContext(ctx, () =>
      service.grant('p1', { method: 'verbal', relationship: 'guardian', signatureImage: 'x' }),
    );
    await withAuditContext(ctx, () => service.view(consent.id));

    expect(storage.rows[1]!.action).toBe('consent.viewed');
    expect(storage.rows[1]!.changes).toEqual({});
  });

  it('a grant -> revoke lifecycle reads cleanly in order (DOMAIN_CHECKLIST.md §6.1)', async () => {
    const { storage, service } = setup();

    await withAuditContext(ctx, async () => {
      const consent = await service.grant('p1', {
        method: 'written',
        relationship: 'self',
        signatureImage: 'x',
      });
      await service.revoke(consent.id, { reason: 'no longer needed' });
    });

    expect(storage.rows.map((r) => [r.seq, r.action])).toEqual([
      [1, 'consent.granted'],
      [2, 'consent.revoked'],
    ]);
    expect(verifyChain(storage.rows)).toMatchObject({ ok: true, count: 2 });
  });
});
