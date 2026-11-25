# @getattestly/core

Framework-agnostic canonicalization, hashing and chain verification for Attestly audit logs. It has no database or NestJS dependency.

## Install

```bash
pnpm add @getattestly/core
```

## What it provides

- RFC 8785 canonical JSON for event payloads
- SHA-256 row hashing linked to the previous row (`hashEvent`, `GENESIS_HASH`)
- `verifyChain(rows)`: checks sequence continuity, `prev_hash` links and that every `row_hash` reproduces
- The `StoragePort` interface that storage adapters implement

```ts
import { verifyChain } from '@getattestly/core';

const result = verifyChain(rows);
```

Part of [Attestly](https://github.com/msaaaad/attestly): tamper-evident, tenant-scoped audit trails for NestJS and PostgreSQL. Full documentation, quick start and example app are in the main repository.
