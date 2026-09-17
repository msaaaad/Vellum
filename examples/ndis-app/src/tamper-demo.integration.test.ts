import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { verifyChain } from '@vellum/core';
import { buildManifest, coverStampFor, getToolVersion } from '@vellum/cli/evidence-pack';
import { withAuditContext } from '@vellum/nestjs';
import { PgStorageAdapter } from '@vellum/storage-pg';
import { AppModule } from './app.module.js';
import { ClaimsService } from './agreements/claims.service.js';
import { ServiceAgreementsService } from './agreements/service-agreements.service.js';
import { ensureDomainSchema } from './agreements/schema.js';
import { ConsentService } from './consent/consent.service.js';
import { EXAMPLE_PG_POOL } from './db.js';
import { ParticipantsService } from './participants/participants.service.js';

/**
 * DOMAIN_CHECKLIST.md Phase 8 — the tamper test, run as a real automated check (the narrated,
 * screen-recording version of the same steps is `scripts/tamper-demo.sh`):
 *
 *   1. Seed: participant + consent + claim → a real chain.
 *   2. `vellum verify` → INTACT.
 *   3. As superuser: `UPDATE audit_events SET changes='{}' WHERE action='consent.granted'`.
 *   4. `vellum verify` → TAMPERED at seq N.
 *   5. `vellum export --format pdf` → cover says FAILED.
 *
 * Steps 2/4/5 use the exact same `@vellum/core`/`@vellum/cli` functions the CLI binary calls —
 * not a reimplementation — so this genuinely proves what the CLI would show, without shelling
 * out to a subprocess from inside a test.
 */
describe('Phase 8 — the tamper test', () => {
  let pool: Pool;

  afterAll(async () => {
    await pool?.end();
  });

  it('seeds participant+consent+claim, verifies INTACT, tampers consent.granted, verifies TAMPERED, and the export cover says FAILED', async () => {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    pool = app.get<Pool>(EXAMPLE_PG_POOL);
    await ensureDomainSchema(pool);

    const participants = app.get(ParticipantsService);
    const consent = app.get(ConsentService);
    const agreements = app.get(ServiceAgreementsService);
    const claims = app.get(ClaimsService);

    const tenantId = randomUUID();
    const actor = { id: 'worker-1', type: 'user' as const, label: 'sam@example-provider.org.au' };
    const requestMeta = { ip: null, userAgent: null, requestId: null, route: null };

    // --- 1. Seed: participant + consent + claim -> a real chain ---
    await withAuditContext({ tenantId, actor, requestMeta }, async () => {
      const participant = await participants.create({
        fullName: 'Jordan Lee',
        dateOfBirth: '1994-03-02',
        ndisNumber: '430123456',
        primaryDisability: 'Autism',
      });
      await consent.grant(participant.id, {
        method: 'written',
        relationship: 'self',
        signatureImage: 'data:image/png;base64,AAAA',
      });
      const agreement = await agreements.create(participant.id, '2026-01-01–2026-12-31');
      const claim = await claims.create(agreement.id, participant.id, {
        ndisPeriod: '2026-01',
        amountCents: 15_000,
        bankAccount: '123-456 00998877',
      });
      await claims.submit(claim.id);
    });

    await app.close();

    const adapter = new PgStorageAdapter(pool);

    // --- 2. `vellum verify` -> INTACT ---
    const before = verifyChain(await adapter.readRange(tenantId));
    expect(before.ok).toBe(true);

    const consentRow = (await adapter.readRange(tenantId)).find(
      (r) => r.action === 'consent.granted',
    );
    expect(consentRow).toBeDefined();

    // --- 3. As superuser: UPDATE audit_events SET changes='{}' WHERE action='consent.granted' ---
    // (the trigger blocks even a superuser until it's explicitly disabled first — that's the
    // honest threat model ARCHITECTURE.md §7 describes, not a shortcut around it)
    await pool.query('ALTER TABLE audit_events DISABLE TRIGGER vellum_no_mutation');
    try {
      await pool.query(
        "UPDATE audit_events SET changes = '{}'::jsonb WHERE tenant_id = $1 AND action = 'consent.granted'",
        [tenantId],
      );
    } finally {
      await pool.query('ALTER TABLE audit_events ENABLE TRIGGER vellum_no_mutation');
    }

    // --- 4. `vellum verify` -> TAMPERED at seq N ---
    const tamperedRows = await adapter.readRange(tenantId);
    const after = verifyChain(tamperedRows);
    expect(after.ok).toBe(false);
    expect(after.brokenAt).toBe(consentRow!.seq);
    expect(after.brokenReason).toBe('HASH');

    // --- 5. `vellum export --format pdf` -> cover says FAILED ---
    const manifest = buildManifest({
      tenantId,
      from: null,
      to: null,
      events: tamperedRows,
      verify: after,
      toolVersion: getToolVersion(),
    });
    expect(manifest.verify.ok).toBe(false);
    expect(coverStampFor(manifest).label).toBe('FAILED');
  });
});
