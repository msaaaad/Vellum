// Deliberately duplicated from packages/storage-pg/src/test/db.ts / packages/cli/src/test/db.ts
// rather than imported across package boundaries — keeps each package's integration test setup
// self-contained (see storage-pg's setup-test-db.mjs for the precedent).
export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/vellum_test';

export const TEST_ROLE_PASSWORD = 'vellum_test_only';

export function connectionStringFor(role: 'vellum_app' | 'vellum_readonly'): string {
  const url = new URL(TEST_DATABASE_URL);
  url.username = role;
  url.password = TEST_ROLE_PASSWORD;
  return url.toString();
}
