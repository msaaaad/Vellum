import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgStorageAdapter } from '@vellum/storage-pg';
import type { PendingAuditEvent } from '@vellum/core';
import { run } from './cli.js';
import { connectionStringFor, TEST_DATABASE_URL } from './test/db.js';

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

/** Bypasses the append-only trigger the same way a database owner could — see ARCHITECTURE.md
 * §7's threat model. Only a superuser connection can do this; the app role never can. */
async function tamperRow(tenantId: string, seq: number): Promise<void> {
  const superuser = new Client({ connectionString: TEST_DATABASE_URL });
  await superuser.connect();
  try {
    await superuser.query('ALTER TABLE audit_events DISABLE TRIGGER vellum_no_mutation');
    await superuser.query(
      'UPDATE audit_events SET changes = \'{"tampered":true}\'::jsonb WHERE tenant_id = $1 AND seq = $2',
      [tenantId, seq],
    );
  } finally {
    await superuser.query('ALTER TABLE audit_events ENABLE TRIGGER vellum_no_mutation');
    await superuser.end();
  }
}

let appPool: Pool;
let adapter: PgStorageAdapter;
let dir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

function loggedText(): string {
  return logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
}

beforeAll(() => {
  appPool = new Pool({ connectionString: connectionStringFor('vellum_app') });
  adapter = new PgStorageAdapter(appPool);
});

afterAll(async () => {
  await appPool.end();
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vellum-cli-test-'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('vellum migrate', () => {
  it('is safe to run again against an already-migrated database', async () => {
    const code = await run(['migrate', '--database-url', TEST_DATABASE_URL]);
    expect(code).toBe(0);
    expect(loggedText()).toContain('schema is up to date');
  });
});

describe('vellum verify', () => {
  it('reports INTACT for a freshly seeded, untampered chain', async () => {
    const tenantId = randomUUID();
    await adapter.appendInline(buildEvent(tenantId, { action: 'a' }));
    await adapter.appendInline(buildEvent(tenantId, { action: 'b' }));
    const third = await adapter.appendInline(buildEvent(tenantId, { action: 'c' }));

    const code = await run([
      'verify',
      '--tenant',
      tenantId,
      '--json',
      '--database-url',
      connectionStringFor('vellum_app'),
    ]);

    expect(code).toBe(0);
    const result = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(result).toMatchObject({ tenantId, ok: true, count: 3, head: third.rowHash });
  });

  it('respects --from/--to as a ranged (anchored) verification', async () => {
    const tenantId = randomUUID();
    await adapter.appendInline(buildEvent(tenantId, { action: 'a' }));
    const second = await adapter.appendInline(buildEvent(tenantId, { action: 'b' }));
    await adapter.appendInline(buildEvent(tenantId, { action: 'c' }));

    const code = await run([
      'verify',
      '--tenant',
      tenantId,
      '--from',
      '2',
      '--to',
      '2',
      '--json',
      '--database-url',
      connectionStringFor('vellum_app'),
    ]);

    expect(code).toBe(0);
    const result = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(result).toMatchObject({ ok: true, count: 1, head: second.rowHash });
  });

  it('reports TAMPERED and exits 1 when a row was mutated after the fact', async () => {
    const tenantId = randomUUID();
    await adapter.appendInline(buildEvent(tenantId, { action: 'a' }));
    await adapter.appendInline(buildEvent(tenantId, { action: 'b' }));
    await adapter.appendInline(buildEvent(tenantId, { action: 'c' }));

    await tamperRow(tenantId, 2);

    const code = await run([
      'verify',
      '--tenant',
      tenantId,
      '--json',
      '--database-url',
      connectionStringFor('vellum_app'),
    ]);

    expect(code).toBe(1);
    const result = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(result).toMatchObject({ ok: false, brokenAt: 2, brokenReason: 'HASH' });
  });

  it('prints the human-readable report (not JSON) by default', async () => {
    const tenantId = randomUUID();
    await adapter.appendInline(buildEvent(tenantId));

    const code = await run([
      'verify',
      '--tenant',
      tenantId,
      '--database-url',
      connectionStringFor('vellum_app'),
    ]);

    expect(code).toBe(0);
    expect(loggedText()).toContain('RESULT: INTACT');
  });
});

describe('vellum export', () => {
  it('--format json writes a manifest + events file whose verify is VERIFIED', async () => {
    const tenantId = randomUUID();
    await adapter.appendInline(buildEvent(tenantId, { action: 'consent.granted' }));
    await adapter.appendInline(buildEvent(tenantId, { action: 'consent.revoked' }));

    const outPath = join(dir, 'pack.json');
    const code = await run([
      'export',
      '--tenant',
      tenantId,
      '--format',
      'json',
      '--out',
      outPath,
      '--database-url',
      connectionStringFor('vellum_app'),
    ]);

    expect(code).toBe(0);
    const pack = JSON.parse(await readFile(outPath, 'utf8'));
    expect(pack.manifest).toMatchObject({ tenantId, count: 2, verify: { ok: true } });
    expect(pack.events).toHaveLength(2);
  });

  it('--format pdf on a clean chain yields a pack whose cover says VERIFIED (Phase 5 done-when)', async () => {
    const tenantId = randomUUID();
    await adapter.appendInline(buildEvent(tenantId, { action: 'participant.created' }));

    const outPath = join(dir, 'pack.pdf');
    const code = await run([
      'export',
      '--tenant',
      tenantId,
      '--format',
      'pdf',
      '--out',
      outPath,
      '--database-url',
      connectionStringFor('vellum_app'),
    ]);

    expect(code).toBe(0);
    expect(loggedText()).toContain('VERIFIED');
    const bytes = await readFile(outPath);
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('a broken chain still produces a pack, stamped FAILED, exit code 1', async () => {
    const tenantId = randomUUID();
    await adapter.appendInline(buildEvent(tenantId, { action: 'a' }));
    await adapter.appendInline(buildEvent(tenantId, { action: 'b' }));
    await tamperRow(tenantId, 1);

    const outPath = join(dir, 'pack-failed.json');
    const code = await run([
      'export',
      '--tenant',
      tenantId,
      '--format',
      'json',
      '--out',
      outPath,
      '--database-url',
      connectionStringFor('vellum_app'),
    ]);

    expect(code).toBe(1);
    expect(loggedText()).toContain('FAILED');
    const pack = JSON.parse(await readFile(outPath, 'utf8'));
    expect(pack.manifest.verify).toMatchObject({ ok: false, brokenAt: 1, brokenReason: 'HASH' });
  });

  it('--from/--to filter the exported events but verify still covers the full chain', async () => {
    const tenantId = randomUUID();
    await adapter.appendInline(
      buildEvent(tenantId, { action: 'old', occurredAt: '2020-01-01T00:00:00.000Z' }),
    );
    await adapter.appendInline(buildEvent(tenantId, { action: 'recent' }));

    const outPath = join(dir, 'pack-ranged.json');
    const code = await run([
      'export',
      '--tenant',
      tenantId,
      '--format',
      'json',
      '--from',
      '2025-01-01',
      '--out',
      outPath,
      '--database-url',
      connectionStringFor('vellum_app'),
    ]);

    expect(code).toBe(0);
    const pack = JSON.parse(await readFile(outPath, 'utf8'));
    expect(pack.events).toHaveLength(1);
    expect(pack.events[0].action).toBe('recent');
    expect(pack.manifest.count).toBe(1);
  });
});

describe('vellum checkpoint', () => {
  it('records and prints the current chain head', async () => {
    const tenantId = randomUUID();
    await adapter.appendInline(buildEvent(tenantId, { action: 'a' }));
    const last = await adapter.appendInline(buildEvent(tenantId, { action: 'b' }));

    const code = await run([
      'checkpoint',
      '--tenant',
      tenantId,
      '--anchored-ref',
      's3://evidence/2026-09-16',
      '--database-url',
      connectionStringFor('vellum_app'),
    ]);

    expect(code).toBe(0);
    const text = loggedText();
    expect(text).toContain('head_seq  = 2');
    expect(text).toContain(`head_hash = ${last.rowHash}`);
    expect(text).toContain('s3://evidence/2026-09-16');
  });
});
