export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/vellum_test';

/** Set on the test roles by global-setup each run — not a real secret, never committed to the migration. */
export const TEST_ROLE_PASSWORD = 'vellum_test_only';

export function connectionStringFor(role: 'vellum_app' | 'vellum_readonly'): string {
  const url = new URL(TEST_DATABASE_URL);
  url.username = role;
  url.password = TEST_ROLE_PASSWORD;
  return url.toString();
}
