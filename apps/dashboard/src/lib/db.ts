import { Pool } from 'pg';

export const DEFAULT_DASHBOARD_DATABASE_URL =
  'postgres://vellum_readonly:vellum_test_only@localhost:5432/vellum_test';

let pool: Pool | undefined;

export function getPool(): Pool {
  pool ??= new Pool({
    connectionString: process.env.DASHBOARD_DATABASE_URL ?? DEFAULT_DASHBOARD_DATABASE_URL,
  });
  return pool;
}
