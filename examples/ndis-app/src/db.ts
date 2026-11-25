import { Pool } from 'pg';

export const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/vellum_test';

export const EXAMPLE_PG_POOL = Symbol('example:pg-pool');

export function createPool(): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL });
}
