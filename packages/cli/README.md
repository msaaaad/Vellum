# @getattestly/cli

The `attestly` command line tool: apply the migration, verify a tenant's chain, export evidence packs and record checkpoints.

## Install

```bash
pnpm add -D @getattestly/cli
```

## Commands

```
attestly migrate    [--database-url <url>]
attestly verify     --tenant <id> [--from <seq>] [--to <seq>] [--json] [--database-url <url>]
attestly export     --tenant <id> --format json|pdf [--from <date>] [--to <date>] [--out <path>] [--database-url <url>]
attestly checkpoint --tenant <id> [--anchored-ref <ref>] [--database-url <url>]
```

`--database-url` defaults to `$DATABASE_URL`. `verify` exits non-zero when the chain is tampered, so it works in CI and cron jobs.

Part of [Attestly](https://github.com/msaaaad/attestly): tamper-evident, tenant-scoped audit trails for NestJS and PostgreSQL. Full documentation, quick start and example app are in the main repository.
