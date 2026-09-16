import { Pool } from 'pg';
import { CliError } from './errors.js';

/** `--database-url` if given, else `$DATABASE_URL` — every command accepts both. */
export function resolveDatabaseUrl(explicit: string | undefined): string {
  const url = explicit ?? process.env.DATABASE_URL;
  if (!url) {
    throw new CliError(
      'no database connection given — pass --database-url <url> or set $DATABASE_URL.',
    );
  }
  return url;
}

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}
