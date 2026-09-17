import { Pool } from 'pg';

/** Same default the CLI's own test/integration setup uses — `pnpm db:up` + `vellum migrate`
 * against this URL is all that's needed before running the seed script. */
export const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/vellum_test';

/** DI token for the shared `pg.Pool` — one pool backs both the audit trail (via
 * `AuditModule.forRoot({storage: {adapter: 'pg', pool}})`) and this example's own small
 * Claims/ServiceAgreement tables, same as a real app would typically share one pool. */
export const EXAMPLE_PG_POOL = Symbol('example:pg-pool');

export function createPool(): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL });
}
