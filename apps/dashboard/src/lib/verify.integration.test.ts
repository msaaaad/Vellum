import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { PendingAuditEvent } from '@vellum/core';
import { PgStorageAdapter } from '@vellum/storage-pg';
import { buildTenantEvidencePack } from './export';
import { connectionStringFor, TEST_DATABASE_URL } from './test/db';
import { verifyTenantChain } from './verify';

function buildEvent(
  tenantId: string,
  overrides: Partial<PendingAuditEvent> = {},
): PendingAuditEvent {
  return {
    hashVersion: 1,
    tenantId,
    occurredAt: new Date().toISOString(),
    actor: { id: 'u1', type: 'user', label: 'sam@x.io' },
    action: 'thing.done',
    entity: { type: 'Thing', id: 't-1' },
    changes: {},
    metadata: {},
    ...overrides,
  };
}

/** Mirrors what Phase 8's tamper test does: disable the trigger as a superuser, mutate,
 * re-enable it. Only a superuser can do this; the read-only role can't even get close. */
async function tamperRow(tenantId: string): Promise<void> {
  const superuser = new Client({ connectionString: TEST_DATABASE_URL });
  await superuser.connect();
  try {
    await superuser.query('ALTER TABLE audit_events DISABLE TRIGGER vellum_no_mutation');
    await superuser.query(
      'UPDATE audit_events SET changes = \'{"tampered":true}\'::jsonb WHERE tenant_id = $1 AND seq = 1',
      [tenantId],
    );
  } finally {
    await superuser.query('ALTER TABLE audit_events ENABLE TRIGGER vellum_no_mutation');
    await superuser.end();
  }
}

describe('verifyTenantChain / buildTenantEvidencePack (integration)', () => {
  const appPool = new Pool({ connectionString: connectionStringFor('vellum_app') });
  const readonlyPool = new Pool({ connectionString: connectionStringFor('vellum_readonly') });
  const adapter = new PgStorageAdapter(appPool);

  afterAll(async () => {
    await appPool.end();
    await readonlyPool.end();
  });

  it('the badge is verified for an intact chain', async () => {
    const tenantId = randomUUID();
    await adapter.appendInline(buildEvent(tenantId, { action: 'a' }));
    await adapter.appendInline(buildEvent(tenantId, { action: 'b' }));

    const result = await verifyTenantChain(readonlyPool, tenantId);
    expect(result).toMatchObject({ ok: true, count: 2 });
  });

  it('DOMAIN_CHECKLIST.md Phase 7 done-when: the badge flips to tampered the moment a row is mutated', async () => {
    const tenantId = randomUUID();
    await adapter.appendInline(buildEvent(tenantId, { action: 'a' }));
    await adapter.appendInline(buildEvent(tenantId, { action: 'b' }));

    expect(await verifyTenantChain(readonlyPool, tenantId)).toMatchObject({ ok: true });

    await tamperRow(tenantId);

    const result = await verifyTenantChain(readonlyPool, tenantId);
    expect(result).toMatchObject({ ok: false, brokenAt: 1, brokenReason: 'HASH' });
  });

  it('the evidence pack manifest reflects a broken chain too — export never hides a tamper', async () => {
    const tenantId = randomUUID();
    await adapter.appendInline(buildEvent(tenantId, { action: 'a' }));
    await tamperRow(tenantId);

    const { manifest, events } = await buildTenantEvidencePack(readonlyPool, tenantId);
    expect(manifest.verify.ok).toBe(false);
    expect(manifest.headHash).toBeNull();
    expect(events).toHaveLength(1); // the row is still there — just fails verification
  });

  it('a clean chain exports a manifest stamped VERIFIED', async () => {
    const tenantId = randomUUID();
    const last = await adapter.appendInline(buildEvent(tenantId, { action: 'a' }));

    const { manifest } = await buildTenantEvidencePack(readonlyPool, tenantId);
    expect(manifest.verify.ok).toBe(true);
    expect(manifest.headHash).toBe(last.rowHash);
  });
});
