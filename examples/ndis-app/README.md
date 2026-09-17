# Vellum — NDIS provider example

A runnable demo wiring `@vellum/nestjs` into a small NDIS provider domain — DOMAIN_CHECKLIST.md
Phase 6. Business records (participants, consents, incidents, roles, worker screenings) live
in-memory for simplicity; Service Agreements and Claims are real Postgres rows, since Phase 6
specifically needs a genuine transaction to demonstrate the atomic `enqueue(tx, …)` API. The
audit trail itself is always real — written to the same Postgres database every other phase's
tests use.

## Run it

```bash
# from the repo root
pnpm db:up                                                    # postgres (+ redis) via docker-compose
node packages/cli/dist/index.js migrate \
  --database-url postgres://postgres:postgres@localhost:5432/vellum_test

cd examples/ndis-app
pnpm build
pnpm seed
```

`pnpm seed` prints the tenant id it used, plus the exact `vellum verify`/`vellum export` commands
to inspect the result:

```bash
node ../../packages/cli/dist/index.js verify --tenant <id> --database-url "..."
node ../../packages/cli/dist/index.js export --tenant <id> --format pdf --database-url "..." --out timeline.pdf
```

`DATABASE_URL` defaults to `postgres://postgres:postgres@localhost:5432/vellum_test` (the same
database the rest of the monorepo's integration tests use) — set it yourself to point elsewhere.
Connecting as the `postgres` superuser is a deliberate demo simplification (no separate
role/password setup needed); a real app would use the scoped `vellum_app` role instead, same as
`packages/storage-pg`'s own integration tests do.

## What it wires up

Every entity follows DOMAIN_CHECKLIST.md §6's shape (create/update/delete/read + redaction +
metadata):

| Entity | Actions | Notable |
|---|---|---|
| Participant | created, updated, deleted, viewed, exported | delete snapshots the pre-delete record via `loadBefore` |
| Consent | granted, revoked, viewed | `signatureImage` redacted on both grant and revoke |
| Incident | reported, severity_changed, viewed, closed | `clinicalNotes` redacted |
| ServiceAgreement | created, updated | real Postgres rows |
| Claim | submitted, approved, paid | **transactional** `enqueue(tx, …)`, not `@Audited()` — bank details excluded |
| Role | assigned, revoked | |
| Worker screening | updated | expiry changes tracked via diff |
| Auth | login_succeeded, login_failed | imperative `record()`, including from a `catch` block |
| Participant import | import_completed + one per row | runs as a `system` actor via `withAuditContext` |

`src/story.ts` is the one definition of "the demo story" — both `seed.ts` (the runnable script)
and `ndis-app.integration.test.ts` (which runs the same story against a real database and checks
the result) call it, so there's nothing to keep in sync by hand.

## Tests

```bash
pnpm test                    # fast unit tests — no database needed
pnpm test:integration        # needs pnpm db:up + the migration above
```
