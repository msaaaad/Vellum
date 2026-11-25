# @getattestly/nestjs

NestJS integration for Attestly: `AuditModule`, the `@Audited()` decorator, request context and the audit writers (inline or outbox with BullMQ).

## Install

```bash
pnpm add @getattestly/nestjs @getattestly/core pg
pnpm add -D @getattestly/cli
```

Peer dependencies: `@nestjs/common`, `@nestjs/core`, `reflect-metadata`. Requires NestJS 10+, PostgreSQL 14+ and Node 18+.

## Quick start

```ts
import { AuditModule, Audited } from '@getattestly/nestjs';

AuditModule.forRoot({
  storage: { adapter: 'pg', pool },
  mode: 'inline',
  tenantResolver: (req) => req.auth.orgId,
  actorResolver: (req) => ({ id: req.auth.userId, type: 'user', label: req.auth.email }),
});

@Audited({ action: 'participant.updated', entity: 'Participant', entityId: (c) => c.args[0], capture: 'diff' })
async updateParticipant(id: string, patch: UpdateParticipantDto) {}
```

Register `AuditContextMiddleware` for your routes so the decorator can read the tenant and actor. Then check the chain with `npx attestly verify --tenant <id> --database-url "$DATABASE_URL"`.

Part of [Attestly](https://github.com/msaaaad/attestly): tamper-evident, tenant-scoped audit trails for NestJS and PostgreSQL. Full documentation, quick start and example app are in the main repository.
