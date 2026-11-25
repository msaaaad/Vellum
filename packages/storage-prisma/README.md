# @getattestly/storage-prisma

Prisma storage adapter for Attestly. It uses your existing Prisma client for raw SQL, so no Prisma schema changes or models are needed. Behaviour matches `@getattestly/storage-pg`.

## Install

```bash
pnpm add @getattestly/storage-prisma @getattestly/core @prisma/client
```

## Use

```ts
import { PrismaClient } from '@prisma/client';
import { PrismaStorageAdapter } from '@getattestly/storage-prisma';

const storage = new PrismaStorageAdapter(new PrismaClient());
```

Apply the schema once with `npx attestly migrate --database-url "$DATABASE_URL"`.

Part of [Attestly](https://github.com/msaaaad/attestly): tamper-evident, tenant-scoped audit trails for NestJS and PostgreSQL. Full documentation, quick start and example app are in the main repository.
