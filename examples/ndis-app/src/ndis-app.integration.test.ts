import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { verifyChain } from '@vellum/core';
import { PgStorageAdapter } from '@vellum/storage-pg';
import { AppModule } from './app.module.js';
import { ensureDomainSchema } from './agreements/schema.js';
import { EXAMPLE_PG_POOL } from './db.js';
import { runFullStory } from './story.js';

/**
 * DOMAIN_CHECKLIST.md Phase 6 done-when, run for real: seeds one tenant's full story against a
 * real Postgres database (`pnpm db:up` + `vellum migrate` first — see the example's README) and
 * confirms the result is exactly what `vellum verify`/`vellum export` would also see: one
 * ordered, verified timeline. This is the same story `seed.ts` runs; `story.ts` is the one
 * shared definition of it.
 */
describe('NDIS example app (integration)', () => {
  it("a seeded participant's full story exports as one ordered, verified timeline", async () => {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const pool = app.get<Pool>(EXAMPLE_PG_POOL);
    await ensureDomainSchema(pool);

    const tenantId = randomUUID();
    await runFullStory(app, tenantId);
    await app.close();

    // Read back exactly the way `vellum verify`/`vellum export` do — a fresh adapter over the
    // same pool, not anything this example's own services expose.
    const adapter = new PgStorageAdapter(pool);
    const rows = await adapter.readRange(tenantId);
    const result = verifyChain(rows);

    expect(result.ok).toBe(true);
    expect(result.head).toBe(rows.at(-1)?.rowHash);

    // The core story, in order: create -> consent -> agreement -> claim -> incident. (Plenty of
    // other events land in between and after — this only asserts the required story is present
    // and correctly ordered relative to itself.)
    const actions = rows.map((r) => r.action);
    const coreStory = [
      'participant.created',
      'consent.granted',
      'agreement.created',
      'claim.submitted',
      'incident.reported',
    ];
    const indices = coreStory.map((action) => actions.indexOf(action));
    expect(indices.every((i) => i !== -1)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));

    // Every seq is contiguous and every row belongs to this tenant — a real cross-check beyond
    // verifyChain's own hash math.
    expect(rows.map((r) => r.seq)).toEqual(rows.map((_, i) => i + 1));
    expect(rows.every((r) => r.tenantId === tenantId)).toBe(true);

    await pool.end();
  });
});
