# Vellum Dashboard

Read-only Next.js app for browsing and verifying audit chains — DOMAIN_CHECKLIST.md Phase 7.
Every read goes through the `vellum_readonly` Postgres role, which the migration
(`packages/storage-pg/migrations/0001_init.sql`) grants `SELECT` only on `audit_events` — no
`INSERT`/`UPDATE`/`DELETE` grants exist for it at all, checked directly in
`src/lib/db.integration.test.ts`.

## Run it

```bash
# from the repo root
pnpm db:up
node packages/cli/dist/index.js migrate \
  --database-url postgres://postgres:postgres@localhost:5432/vellum_test

cd apps/dashboard
pnpm dev
```

Open <http://localhost:3000>, enter a tenant id (e.g. one printed by
`examples/ndis-app`'s `pnpm seed`), and you get:

- A **chain badge** — verified ✓ / tampered ✗ — from a real full-chain `verifyChain()`, the same
  one `vellum verify` runs.
- A **filterable event list** (entity, actor, action, date range), newest first.
- A **one-click PDF export** button — the exact same evidence pack `vellum export --format pdf`
  builds (`@vellum/cli/evidence-pack`, not a second implementation).

`DASHBOARD_DATABASE_URL` defaults to `postgres://vellum_readonly:vellum_test_only@localhost:5432/vellum_test`
— the same ephemeral password `packages/storage-pg/scripts/setup-test-db.mjs` sets for local
dev/test. Set it yourself to point elsewhere.

## Tests

```bash
pnpm test                    # fast unit tests — no database needed
pnpm test:integration        # needs pnpm db:up + the migration above
```

The integration suite is also where "the dashboard role literally cannot INSERT/UPDATE" gets
checked for real, and where the badge-flips-on-tamper behavior (Phase 7's done-when) is proven
end-to-end.
