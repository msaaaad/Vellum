import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { verifyChain } from '@attestly/core';
import { PgStorageAdapter } from '@attestly/storage-pg';
import { AppModule } from './app.module.js';
import { ensureDomainSchema } from './agreements/schema.js';
import { EXAMPLE_PG_POOL } from './db.js';
import { runFullStory } from './story.js';

describe('NDIS example app (integration)', () => {
  it("a seeded participant's full story exports as one ordered, verified timeline", async () => {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const pool = app.get<Pool>(EXAMPLE_PG_POOL);
    await ensureDomainSchema(pool);

    const tenantId = randomUUID();
    await runFullStory(app, tenantId);
    await app.close();

    const adapter = new PgStorageAdapter(pool);
    const rows = await adapter.readRange(tenantId);
    const result = verifyChain(rows);

    expect(result.ok).toBe(true);
    expect(result.head).toBe(rows.at(-1)?.rowHash);

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

    expect(rows.map((r) => r.seq)).toEqual(rows.map((_, i) => i + 1));
    expect(rows.every((r) => r.tenantId === tenantId)).toBe(true);

    await pool.end();
  });
});
