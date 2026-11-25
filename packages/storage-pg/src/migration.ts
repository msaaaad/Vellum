import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export function readMigrationSql(): string {
  return readFileSync(join(packageRoot, 'migrations', '0001_init.sql'), 'utf8');
}
