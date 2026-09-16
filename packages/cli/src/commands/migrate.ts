import { parseArgs } from 'node:util';
import { Client } from 'pg';
import { readMigrationSql } from '@vellum/storage-pg';
import { resolveDatabaseUrl } from '../db.js';
import { CliError } from '../errors.js';

/** `vellum migrate` — README "Quick start" step 1. Applies the idempotent init migration. */
export async function runMigrate(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { 'database-url': { type: 'string' } },
  });

  const databaseUrl = resolveDatabaseUrl(values['database-url']);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(readMigrationSql());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError(
      `migration failed: ${message}\n` +
        '  (the connecting role usually needs to be a superuser or the database owner — ' +
        'CREATE ROLE, ENABLE ROW LEVEL SECURITY, and REVOKE/GRANT all need elevated privileges)',
    );
  } finally {
    await client.end();
  }

  console.log(
    'vellum migrate: schema is up to date ' +
      '(audit_events, audit_outbox, audit_checkpoints, RLS policies, append-only trigger).',
  );
  return 0;
}
