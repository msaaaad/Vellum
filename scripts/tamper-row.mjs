#!/usr/bin/env node
// DOMAIN_CHECKLIST.md Phase 8 — the tamper step, standalone and scriptable (used by
// tamper-demo.sh, and runnable on its own). Bypasses the append-only trigger the same way a
// database owner could — ARCHITECTURE.md §7's honest threat model: "a determined actor with
// full database ownership... a self-contained in-DB chain is tamper-evident against partial
// edits, not tamper-proof against a total rewrite." Only a superuser connection can even get
// this far; the app role's grants never include UPDATE/DELETE at all (packages/storage-pg's
// migration), and the trigger blocks a superuser too until it's explicitly disabled.
import { Client } from 'pg';

const [, , tenantId, databaseUrl] = process.argv;

if (!tenantId) {
  console.error('usage: node scripts/tamper-row.mjs <tenantId> [databaseUrl]');
  process.exitCode = 1;
  process.exit();
}

const url =
  databaseUrl ??
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/vellum_test';

const client = new Client({ connectionString: url });
await client.connect();
try {
  console.log('  Disabling the append-only trigger (superuser only) ...');
  await client.query('ALTER TABLE audit_events DISABLE TRIGGER vellum_no_mutation');

  console.log(
    `  UPDATE audit_events SET changes = '{}' WHERE tenant_id = '${tenantId}' AND action = 'consent.granted';`,
  );
  const result = await client.query(
    "UPDATE audit_events SET changes = '{}'::jsonb WHERE tenant_id = $1 AND action = 'consent.granted' RETURNING seq",
    [tenantId],
  );

  if (result.rowCount === 0) {
    console.error('  No consent.granted row found for that tenant — seed a chain first.');
    process.exitCode = 1;
  } else {
    console.log(`  Tampered row: seq ${result.rows[0].seq}.`);
  }
} finally {
  console.log('  Re-enabling the trigger ...');
  await client.query('ALTER TABLE audit_events ENABLE TRIGGER vellum_no_mutation');
  await client.end();
}
