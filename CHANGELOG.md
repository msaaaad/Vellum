# Changelog

All notable changes are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [SemVer](https://semver.org/) once published.

## [Unreleased]

### Added

- `storage.adapter: 'prisma'` now works in `AuditModule.forRoot` (it used to throw "not implemented").
- `pnpm example:ndis`: Postgres, migrate, seed and verify the NDIS example in one command.
- `pnpm check:quickstart`: installs the packed packages into a fresh app, follows the README quick
  start, and verifies the resulting chain. Runs in CI (`.github/workflows/ci.yml`).
- Publish metadata (license, files, repository) for the five packages; release script.
- README badges, a corrected install/migration section, and `docs/launch-post.md`.
- `@attestly/storage-prisma`: a Prisma `StoragePort` adapter with behavioural parity to `storage-pg`
  (same tables, RLS scoping, advisory-lock serialization, outbox semantics), verified by an
  integration suite including cross-adapter read-back.
- `LICENSE` (MIT), `CONTRIBUTING.md`, this changelog.
- `VELLUM_PG_PORT` / `VELLUM_REDIS_PORT` overrides in `docker-compose.yml`.

### Changed

- Renamed the project from Vellum to Attestly before the first publish: packages are `@attestly/*`,
  the CLI binary is `attestly`, and evidence packs carry `tool: 'attestly'`. Postgres identifiers
  (`vellum_app`, `vellum_readonly`, `vellum.tenant_id`, the trigger and policy names) are unchanged.
- `StoragePort.drainOutbox`, `listOutboxTenants` and `recordCheckpoint` now take their batch size, limit and
  anchored reference explicitly instead of hiding defaults inside each adapter.
- CLI report output uses ASCII markers (`[ok]`, `[x]`, `->`) instead of Unicode glyphs.
- Source comments removed in favour of names and ARCHITECTURE.md; test fixtures use UUID-shaped ids.

### Fixed

- Flaky `storage-pg` outbox test: it enqueued one tenant's events concurrently and then asserted
  their order.
- `@nestjs/common`, `@nestjs/core` and `reflect-metadata` are peer dependencies of
  `@attestly/nestjs` so apps don't end up with two copies.
- Test helpers no longer ship in `@attestly/storage-pg`'s package.
- `pnpm test:integration` now also runs the dashboard and `examples/ndis-app` integration tests
  (it previously matched only `packages/**`) and runs files serially, since they share one database.
- `examples/ndis-app` story drains the outbox after the claim steps so claim events appear in story
  order in the chain.

## Pre-release history

Phases 0-8 (core hashing/verification, Postgres storage, NestJS integration, CLI + evidence packs,
NDIS example domain, read-only dashboard, tamper-test demo) are described in `PROGRESS_LOG.md`.
