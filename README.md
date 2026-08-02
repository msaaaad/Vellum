# Vellum
Vellum is the treated animal-skin parchment that legal charters, deeds, and official records were written on for centuries — chosen precisely because it lasts and resists alteration. That's the exact metaphor for this product: a permanent, tamper-evident record. It's short, brandable, and evokes "trusted official record" without being literal like nestjs-audit-log. That said — it's a working name, not a decision.
> Tamper-evident, tenant-scoped audit trails for NestJS — a drop-in evidence layer that turns "we log stuff" into "we can *prove* what happened."

`@vellum/nestjs` gives any multi-tenant NestJS + PostgreSQL app an **append-only, hash-chained audit log** with almost no work: add a decorator, and every meaningful action is recorded with *who / what / which tenant / when*, chained so that any later edit or deletion is detectable. One command produces an auditor-ready **evidence pack**.

Built for the moment every B2B SaaS eventually hits: an enterprise customer's security review asks for *"an immutable audit log of all data access and changes"* — and you don't want to build (and defend) that from scratch.

> **Naming note:** `vellum` may be taken on npm — confirm before publishing. Backup names: `attestly`, `sealog`, `ledgermark`, `trailkeep`. The package/CLI names below assume the `vellum` brand; swap as needed.

---

## Table of contents

- [Why Vellum](#why-vellum)
- [What you get in v1](#what-you-get-in-v1)
- [Install](#install)
- [Quick start (5 minutes)](#quick-start-5-minutes)
- [Recording events](#recording-events)
  - [The `@Audited()` decorator](#the-audited-decorator)
  - [Diffs (before/after)](#diffs-beforeafter)
  - [Imperative + transactional (atomic) API](#imperative--transactional-atomic-api)
- [Verifying integrity](#verifying-integrity)
- [Evidence packs](#evidence-packs)
- [The dashboard](#the-dashboard)
- [Configuration reference](#configuration-reference)
- [Two write modes: inline vs outbox](#two-write-modes-inline-vs-outbox)
- [What Vellum does and does NOT protect against](#what-vellum-does-and-does-not-protect-against)
- [Monorepo layout](#monorepo-layout)
- [Roadmap](#roadmap)
- [FAQ](#faq)

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full technical design (hash-chain spec, canonicalization, schema, concurrency, threat model).

---

## Why Vellum

Most "audit logs" are a `logs` table anyone with DB access can silently `UPDATE` or `DELETE`. That fails a real audit, because nothing proves the log wasn't edited after the fact. Vellum fixes the three hard parts:

1. **Tamper-evidence** — each row embeds a SHA-256 hash of the previous row + its own contents, forming a per-tenant chain. Alter or delete any past row and the chain breaks at a detectable point.
2. **Tenant isolation** — the trail is scoped per organisation with PostgreSQL **Row-Level Security**, enforced at the database, not just in app code. Tenant A can never read tenant B's history.
3. **Evidence, not just logs** — export a filtered, self-describing pack (JSON + PDF) with a verification result and the chain head hash, ready to hand to an auditor or customer.

It feels native to NestJS (decorators, DI, interceptors, an optional BullMQ worker) and native to Postgres (RLS, an append-only trigger, one migration).

---

## What you get in v1

| Capability | Included |
|---|---|
| `@Audited()` decorator + interceptor | ✅ |
| Imperative `record()` and transactional `enqueue(tx, …)` API | ✅ |
| Per-tenant SHA-256 hash chain | ✅ |
| Row-Level Security tenant isolation | ✅ |
| Append-only enforcement (grants + trigger) | ✅ |
| `inline` and `outbox` (BullMQ) write modes | ✅ |
| `vellum verify` — CLI + programmatic | ✅ |
| Evidence pack export — JSON + PDF | ✅ |
| Read-only Next.js dashboard (browse, filter, verify badge, export) | ✅ |
| Prisma / node-postgres storage adapter | ✅ |
| Example app + full test suite | ✅ |

**Out of scope for v1** (see [Roadmap](#roadmap)): external anchoring / transparency log, digital signatures, non-Postgres stores, hosted SaaS, SIEM streaming.

---

## Install

```bash
pnpm add @vellum/nestjs @vellum/core
pnpm add -D @vellum/cli
# outbox mode also needs BullMQ + Redis (you likely already have these)
pnpm add @nestjs/bullmq bullmq
```

Requires: **NestJS 10+**, **PostgreSQL 14+**, Node 18+. Storage adapter for **Prisma** or **pg** (node-postgres).

---

## Quick start (5 minutes)

**1. Run the migration** (creates `audit_events`, indexes, RLS policies, the append-only trigger, and — for outbox mode — `audit_outbox`). Ships as SQL and as a Prisma migration:

```bash
npx vellum migrate            # applies the SQL migration
# or copy prisma/migrations/*_vellum_init from @vellum/nestjs into your Prisma setup
```

**2. Register the module:**

```ts
// app.module.ts
import { AuditModule } from '@vellum/nestjs';

@Module({
  imports: [
    AuditModule.forRoot({
      storage: { adapter: 'prisma', client: () => prisma },   // or { adapter: 'pg', pool }
      mode: 'inline',                                          // 'outbox' for production
      // Tell Vellum how to read the tenant + actor from the request:
      tenantResolver: (req) => req.auth.orgId,
      actorResolver:  (req) => ({ id: req.auth.userId, type: 'user', label: req.auth.email }),
    }),
  ],
})
export class AppModule {}
```

**3. Populate request context** (so the decorator knows the tenant + actor). One middleware:

```ts
// main.ts / a module
import { AuditContextMiddleware } from '@vellum/nestjs';
consumer.apply(AuditContextMiddleware).forRoutes('*');
```

This runs your `tenantResolver`/`actorResolver` and stashes the result in an `AsyncLocalStorage` context for the duration of the request.

**4. Annotate a method:**

```ts
@Audited({ action: 'participant.updated', entity: 'Participant',
           entityId: (c) => c.args[0], capture: 'diff',
           loadBefore: (c) => c.self.repo.findById(c.args[0]) })
async updateParticipant(id: string, patch: UpdateParticipantDto) {
  return this.repo.update(id, patch);
}
```

That's it. Every call now writes a chained audit event. Check it:

```bash
npx vellum verify --tenant <orgId>
# ✔ chain intact — 1,284 events, head 9f2c…a71b
```

---

## Recording events

There are three ways to record, from most convenient to most guaranteed.

### The `@Audited()` decorator

Best for the common case: capture an action around a method.

```ts
@Audited({
  action: 'consent.revoked',        // your event name (dot-namespaced convention)
  entity: 'Consent',                // logical entity type
  entityId: (c) => c.result.id,     // resolve the record id from args/result
  capture: 'snapshot',              // store the returned entity as the "after" state
  redact: ['signatureImage'],       // never store these fields
  metadata: (c) => ({ reason: c.args[1]?.reason }),
})
async revokeConsent(id: string, opts: RevokeDto) { /* … */ }
```

The **pointcut** object `c` passed to resolvers exposes:

```ts
interface AuditPointcut {
  args: unknown[];              // method arguments
  result: unknown;             // method return value (after it runs)
  self: any;                   // the service instance (call repos, etc.)
  request?: unknown;           // the HTTP request, if available
  tenantId: string;            // resolved tenant
  actor: AuditActor;           // resolved actor
}
```

### Diffs (before/after)

A PNG-flat "snapshot" is fine for creates/deletes. For **updates**, provide `loadBefore` so Vellum can compute a field-level diff:

```ts
@Audited({
  action: 'participant.updated', entity: 'Participant',
  entityId: (c) => c.args[0],
  capture: 'diff',
  loadBefore: (c) => c.self.repo.findById(c.args[0]),   // runs BEFORE the method
})
async updateParticipant(id: string, patch: UpdateParticipantDto) {
  return this.repo.update(id, patch);
}
```

Stored `changes` becomes `{ before: {...}, after: {...}, diff: { field: [old, new], … } }` (redacted fields stripped from all three). Diff strategy is pluggable; default is a shallow+nested key diff.

### Imperative + transactional (atomic) API

For **critical writes where you must not lose the audit even if the process crashes**, enqueue the event **inside the same database transaction** as your business change. If the business tx rolls back, so does the audit — no phantom events; if it commits, the event is guaranteed to be chained.

```ts
await this.prisma.$transaction(async (tx) => {
  const claim = await tx.claim.update({ where: { id }, data });
  await this.audit.enqueue(tx, {            // same tx → atomic
    action: 'claim.submitted', entity: 'Claim', entityId: claim.id,
    changes: { after: claim },
  });
});
```

`enqueue(tx, …)` writes to `audit_outbox` within your transaction; the worker later assigns the sequence + hash and moves it to `audit_events` (see [modes](#two-write-modes-inline-vs-outbox)). There is also a fire-and-forget `audit.record({...})` for non-transactional events.

---

## Verifying integrity

Verification recomputes every hash and checks the chain is contiguous and unbroken.

```bash
npx vellum verify --tenant <orgId> [--from <seq>] [--to <seq>] [--json]
```

Sample output:

```
Vellum verify — tenant 6f1e…  (1,284 events)
  ✔ sequence contiguous (1 … 1284, no gaps)
  ✔ every row_hash reproduces from canonical payload + prev_hash
  ✔ every prev_hash links to the prior row
  RESULT: INTACT   head = 9f2c3e…a71b   verified_at = 2026-07-20T04:21:07Z
```

On tampering it fails loudly and points at the break:

```
  ✗ BROKEN at seq 842: stored row_hash ≠ recomputed
    → this row (or an earlier one) was modified after it was written.
  RESULT: TAMPERED
```

Programmatic equivalent:

```ts
const result = await this.verifier.verify(orgId);     // { ok, count, head, brokenAt? }
```

---

## Evidence packs

Produce a self-describing bundle for an auditor or customer:

```bash
npx vellum export --tenant <orgId> --from 2026-01-01 --to 2026-06-30 --format pdf
```

Each pack contains a **manifest** — tenant, date range, event count, chain head hash, tool version, generated-at, and the verification result (PASS/FAIL) — plus the events themselves. `--format json` yields machine-readable output; `--format pdf` yields a human-readable cover page + table. The export always re-runs verification first and stamps the result on the cover, so the pack carries its own proof of integrity.

---

## The dashboard

`apps/dashboard` is a **read-only** Next.js app for humans:

- Browse/filter events by entity, actor, action, date.
- A per-tenant **"chain: verified ✓ / tampered ✗"** badge (calls the verifier).
- One-click evidence-pack export.
- Reads exclusively through a read-only API using an RLS-scoped role — the dashboard can never write to or mutate the trail.

---

## Configuration reference

```ts
AuditModule.forRoot({
  storage: {
    adapter: 'prisma' | 'pg',
    client?: () => PrismaClient,     // prisma
    pool?: Pool,                     // pg
    schema?: 'public',
    table?: 'audit_events',
  },
  mode: 'inline' | 'outbox',         // default 'inline'
  outbox?: {                         // required when mode = 'outbox'
    queueName?: 'vellum-audit',
    connection: RedisOptions,        // BullMQ connection
    batchSize?: 100,
    pollMs?: 1000,
  },
  tenantResolver: (req) => string,               // REQUIRED
  actorResolver:  (req) => AuditActor,           // REQUIRED
  hash?: { algorithm?: 'sha256', version?: 1 },  // future-proofing
  redact?: string[],                             // global field paths to strip
  clock?: () => Date,                            // injectable time (tests)
  onError?: (err, event) => void,                // hook: never silently drop
})
```

`forRootAsync({ useFactory, inject })` is supported for DI-driven config.

| Option | Default | Notes |
|---|---|---|
| `mode` | `inline` | `outbox` recommended in production |
| `hash.algorithm` | `sha256` | recorded per row via `hash.version` |
| `redact` | `[]` | applied to `changes` + `metadata` before hashing |
| `clock` | `() => new Date()` | inject a fixed clock in tests |
| `onError` | throws | in `outbox` mode, failures are retried by BullMQ |

---

## Two write modes: inline vs outbox

**`inline`** — simplest, zero extra infra. The interceptor writes the chained event synchronously after the method succeeds, serialising per-tenant appends with a Postgres advisory lock. Great for getting started and low/medium throughput.
*Caveat:* it is not automatically atomic with your business transaction (use the [transactional API](#imperative--transactional-atomic-api) if you need that guarantee).

**`outbox`** — recommended for production. Events land in `audit_outbox` (cheaply, ideally in your business transaction), and a **BullMQ worker** drains them **in order, per tenant**, assigning the sequence + hash and inserting into `audit_events`. This gives you:
- **atomicity** (outbox insert rides your transaction → no lost or phantom events),
- **a fast hot path** (no hashing/locking in the request),
- **clean per-tenant serialisation** (the worker is the single writer, so sequencing needs no locks).

Both modes produce the identical on-disk chain; you can switch by config. Full sequencing/concurrency details in [`ARCHITECTURE.md`](./ARCHITECTURE.md#concurrency--ordering).

---

## What Vellum does and does NOT protect against

Being honest about this is the whole point of an audit tool.

**It DOES detect:** any edit, deletion, or reordering of *individual* past rows — the chain breaks at that point and `verify` fails. Casual tampering, buggy code, a rogue `UPDATE`, or accidental deletes are all caught.

**It does NOT, by itself, stop:** a determined actor with **full database ownership** who rewrites the *entire* chain forward from the point they change (recomputing every subsequent hash). A self-contained in-DB chain is tamper-**evident against partial edits**, not tamper-**proof against a total rewrite**.

**How you close that gap** (v1-friendly, roadmap for automation): periodically publish the chain's **head hash** somewhere the app's DB role cannot alter — WORM object storage (S3 Object Lock), a second append-only system, email to auditors, or (later) a public transparency log. Vellum records these as **checkpoints**; once a head hash is anchored externally, no in-DB rewrite can move history behind that point undetected. v1 ships the checkpoint table + a manual `vellum checkpoint` command; automated anchoring is on the roadmap.

The append-only **trigger + grant model** also means the *application* role literally cannot `UPDATE`/`DELETE` the table — only a superuser/table owner can, which narrows the threat to people who already hold the keys to the database.

---

## Monorepo layout

```
vellum/
├─ packages/
│  ├─ core/            # framework-agnostic: canonicalization, hashing, verifier, types
│  ├─ nestjs/          # AuditModule, @Audited, interceptor, context, writer, outbox worker
│  ├─ cli/             # `vellum` — migrate | verify | export | checkpoint
│  └─ storage-prisma/  # + storage-pg — adapters implementing the StoragePort interface
├─ apps/
│  └─ dashboard/       # read-only Next.js UI
├─ examples/
│  └─ basic-nestjs/    # runnable demo (participants + consents) with a tamper test
└─ ARCHITECTURE.md
```

`packages/core` has **zero framework deps** so the hashing/verification logic can be reused and audited in isolation. Adapters implement a small `StoragePort` interface, so adding another database later doesn't touch the core.

---

## Roadmap

- **v1.1** — automated external anchoring (S3 Object Lock / webhook / email) on a schedule.
- **v1.2** — Ed25519 signatures on evidence-pack manifests (portable, offline-verifiable proof).
- **v1.3** — Merkle batching (anchor one root per N events instead of per-row heads).
- **Later** — non-Postgres adapters, SIEM/stream export, and a hosted dashboard with long-term WORM retention (the paid tier).

---

## FAQ

**Does this replace application logging?** No — it complements it. Logs are for debugging; Vellum is for *provable records of who changed what*.

**Performance?** In `outbox` mode the request path does one cheap insert; hashing happens off the hot path. In `inline` mode you pay one hash + one insert + a per-tenant advisory lock per audited action.

**Reads too, or just writes?** Both — `@Audited({ action: 'record.viewed', capture: 'none' })` records access without a payload, which is often exactly what "audit log of all data *access*" means.

**PII?** Use `redact` (global or per-decorator). The hash is computed over the **stored (redacted) form**, so what you can verify is exactly what you kept. Don't put secrets in audit payloads.

**Can I use it without multi-tenancy?** Yes — use a single constant tenant id; you still get the chain, verification, and evidence packs.

---

*Vellum — because "we have logs" isn't the same as "we can prove it."*
