# Contributing to Vellum

Thanks for helping. Vellum is a trust-critical library — a tamper-evident audit log — so the bar for
changes to hashing, canonicalization and verification is deliberately high. Read
[`ARCHITECTURE.md`](./ARCHITECTURE.md) first; it is the spec.

## Setup

```bash
pnpm install
pnpm build
pnpm test                # unit tests, no database needed
```

Integration tests need Postgres 16:

```bash
pnpm db:up               # docker compose up -d (set VELLUM_PG_PORT if 5432 is taken)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/vellum_test pnpm test:integration
```

`test:integration` resets the `vellum_test` schema each run, so point it only at a throwaway database.

## Before you open a PR

```bash
pnpm lint && pnpm typecheck && pnpm depcruise && pnpm test && pnpm test:integration
```

## Ground rules

- **`packages/core` has zero framework dependencies** and depends on no sibling package
  (enforced by `pnpm depcruise`).
- **Never hand-roll canonical JSON or change the hash format.** A change to what gets hashed needs a
  new `hash_version`; old rows must keep verifying under the version that wrote them.
- **Storage adapters must be interchangeable.** `storage-pg` and `storage-prisma` implement the same
  `StoragePort` and are tested against the same behaviours (RLS, append-only, per-tenant
  serialization, outbox atomicity). A new adapter needs the equivalent suite.
- **Say what is and isn't protected.** If a change alters the threat model, update the
  "does and does NOT protect against" section of the README and ARCHITECTURE.md §7.
- Add a test for every behaviour change; a tamper-detection change needs a test that fails without it.

## Commits and PRs

Small, focused PRs with a description of the *why*. Update `CHANGELOG.md` under "Unreleased".

## Security issues

Anything that lets someone alter the log without detection is a security issue — please report it
privately to the maintainer rather than in a public issue.
