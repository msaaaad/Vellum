import { Pool } from 'pg';

/**
 * README "The dashboard": "Reads exclusively through a read-only API using an RLS-scoped role —
 * the dashboard can never write to or mutate the trail." This connects as `vellum_readonly`
 * (granted `SELECT` only on `audit_events` by the migration — no `INSERT`/`UPDATE`/`DELETE`
 * grants at all, checked directly in `db.integration.test.ts`), never `vellum_app`.
 *
 * Password matches the ephemeral one `packages/storage-pg/scripts/setup-test-db.mjs` sets on
 * both roles for local dev/test — set `DASHBOARD_DATABASE_URL` yourself for anything else.
 */
export const DEFAULT_DASHBOARD_DATABASE_URL =
  'postgres://vellum_readonly:vellum_test_only@localhost:5432/vellum_test';

let pool: Pool | undefined;

/** One shared pool per server process — Next.js route handlers/server components call this
 * rather than each opening their own. */
export function getPool(): Pool {
  pool ??= new Pool({
    connectionString: process.env.DASHBOARD_DATABASE_URL ?? DEFAULT_DASHBOARD_DATABASE_URL,
  });
  return pool;
}
