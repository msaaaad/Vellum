import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(path.join(dirname, '..', 'migrations', '0001_init.sql'), 'utf8');

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/vellum_test';
const TEST_ROLE_PASSWORD = 'vellum_test_only';

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('GRANT ALL ON SCHEMA public TO public');
  await client.query(migrationSql);
  await client.query(`ALTER ROLE vellum_app WITH PASSWORD '${TEST_ROLE_PASSWORD}'`);
  await client.query(`ALTER ROLE vellum_readonly WITH PASSWORD '${TEST_ROLE_PASSWORD}'`);
  console.log('vellum_test: schema reset and migration applied.');
} finally {
  await client.end();
}
