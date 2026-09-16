// Deliberately duplicated from packages/storage-pg/src/test/db.ts rather than imported across
// the package boundary — keeps each package's integration test setup self-contained, matching
// the small accepted duplication in storage-pg's own setup-test-db.mjs (see its top comment).
export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/vellum_test';

export const TEST_ROLE_PASSWORD = 'vellum_test_only';

export function connectionStringFor(role: 'vellum_app' | 'vellum_readonly'): string {
  const url = new URL(TEST_DATABASE_URL);
  url.username = role;
  url.password = TEST_ROLE_PASSWORD;
  return url.toString();
}
