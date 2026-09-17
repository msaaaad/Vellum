import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { PgStorageAdapter } from '@vellum/storage-pg';
import { connectionStringFor } from './test/db';

/**
 * DOMAIN_CHECKLIST.md Phase 7: "Confirm the dashboard role literally cannot INSERT/UPDATE."
 * Checked directly against the database, not just "the dashboard's code never calls INSERT" —
 * the grants themselves (packages/storage-pg's migration) are what actually enforces this.
 */
describe('vellum_readonly role — DOMAIN_CHECKLIST.md Phase 7', () => {
  const appPool = new Pool({ connectionString: connectionStringFor('vellum_app') });

  afterAll(async () => {
    await appPool.end();
  });

  it('can SELECT (via the same RLS-scoped read path the dashboard uses)', async () => {
    const tenantId = randomUUID();
    const adapter = new PgStorageAdapter(appPool);
    await adapter.appendInline({
      hashVersion: 1,
      tenantId,
      occurredAt: new Date().toISOString(),
      actor: { id: 'u1', type: 'user', label: null },
      action: 'thing.done',
      entity: { type: 'Thing', id: 't-1' },
      changes: {},
      metadata: {},
    });

    const readonlyClient = new Client({ connectionString: connectionStringFor('vellum_readonly') });
    await readonlyClient.connect();
    try {
      await readonlyClient.query('BEGIN');
      await readonlyClient.query("SELECT set_config('vellum.tenant_id', $1, true)", [tenantId]);
      const result = await readonlyClient.query('SELECT * FROM audit_events WHERE tenant_id = $1', [
        tenantId,
      ]);
      await readonlyClient.query('COMMIT');
      expect(result.rowCount).toBe(1);
    } finally {
      await readonlyClient.end();
    }
  });

  it('cannot INSERT', async () => {
    const client = new Client({ connectionString: connectionStringFor('vellum_readonly') });
    await client.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO audit_events (tenant_id, seq, occurred_at, actor_type, action, entity_type, prev_hash, row_hash)
           VALUES (gen_random_uuid(), 1, now(), 'user', 'x', 'X', repeat('0', 64), repeat('0', 64))`,
        ),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.end();
    }
  });

  it('cannot UPDATE', async () => {
    const client = new Client({ connectionString: connectionStringFor('vellum_readonly') });
    await client.connect();
    try {
      await expect(client.query("UPDATE audit_events SET action = 'x'")).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      await client.end();
    }
  });

  it('cannot DELETE', async () => {
    const client = new Client({ connectionString: connectionStringFor('vellum_readonly') });
    await client.connect();
    try {
      await expect(client.query('DELETE FROM audit_events')).rejects.toThrow(/permission denied/i);
    } finally {
      await client.end();
    }
  });
});
