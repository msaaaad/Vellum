# @getattestly/storage-pg

node-postgres storage adapter for Attestly. Appends hash-chained audit events per tenant with row-level security, an append-only trigger and advisory locks. It also ships the SQL migration.

## Install

```bash
pnpm add @getattestly/storage-pg @getattestly/core pg
```

## Use

```ts
import { Pool } from 'pg';
import { PgStorageAdapter } from '@getattestly/storage-pg';

const storage = new PgStorageAdapter(new Pool({ connectionString: process.env.DATABASE_URL }));
```

Apply the schema once with `npx attestly migrate --database-url "$DATABASE_URL"`, or run `migrations/0001_init.sql` from this package with psql.

Part of [Attestly](https://github.com/msaaaad/Vellum): tamper-evident, tenant-scoped audit trails for NestJS and PostgreSQL. Full documentation, quick start and example app are in the main repository.
