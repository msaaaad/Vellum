#!/usr/bin/env node
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { Pool } from 'pg';
import { AppModule } from './app.module.js';
import { ensureDomainSchema } from './agreements/schema.js';
import { DEFAULT_DATABASE_URL, EXAMPLE_PG_POOL } from './db.js';
import { runFullStory } from './story.js';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const pool = app.get<Pool>(EXAMPLE_PG_POOL);
  await ensureDomainSchema(pool);

  const tenantId = randomUUID();
  await runFullStory(app, tenantId);

  await app.close();
  await pool.end();

  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  console.log(`Seeded tenant ${tenantId}\n`);
  console.log('Verify the chain:');
  console.log(
    `  node ../../packages/cli/dist/index.js verify --tenant ${tenantId} --database-url "${databaseUrl}"\n`,
  );
  console.log('Export the full timeline as an evidence pack:');
  console.log(
    `  node ../../packages/cli/dist/index.js export --tenant ${tenantId} --format pdf --database-url "${databaseUrl}" --out timeline.pdf`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
