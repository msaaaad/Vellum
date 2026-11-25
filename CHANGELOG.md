# Changelog

All notable changes are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [SemVer](https://semver.org/) once published.

## [Unreleased]

### Added

- `@vellum/storage-prisma`: a Prisma `StoragePort` adapter with behavioural parity to `storage-pg`
  (same tables, RLS scoping, advisory-lock serialization, outbox semantics), verified by an
  integration suite including cross-adapter read-back.
- `LICENSE` (MIT), `CONTRIBUTING.md`, this changelog.
- `VELLUM_PG_PORT` / `VELLUM_REDIS_PORT` overrides in `docker-compose.yml`.

### Fixed

- `pnpm test:integration` now also runs the dashboard and `examples/ndis-app` integration tests
  (it previously matched only `packages/**`) and runs files serially, since they share one database.
- `examples/ndis-app` story drains the outbox after the claim steps so claim events appear in story
  order in the chain.

## Pre-release history

Phases 0–8 (core hashing/verification, Postgres storage, NestJS integration, CLI + evidence packs,
NDIS example domain, read-only dashboard, tamper-test demo) are described in `PROGRESS_LOG.md`.
