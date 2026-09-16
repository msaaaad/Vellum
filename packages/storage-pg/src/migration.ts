import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The full Phase-2 init migration (ARCHITECTURE.md §2/§7) as SQL text — read from the one
 * versioned `.sql` file so `vellum migrate` and a manual `psql -f` application share a single
 * source of truth instead of two copies that can drift.
 */
export function readMigrationSql(): string {
  return readFileSync(join(packageRoot, 'migrations', '0001_init.sql'), 'utf8');
}
