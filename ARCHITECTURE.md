# Vellum — Architecture (v1)

This document is the source of truth for *how* Vellum works, precisely enough to build from without guessing. It covers the data model, the hash-chain and canonicalization spec, the two write paths, concurrency/ordering, verification, the threat model, and the key decisions with rationale.

Companion: [`README.md`](./README.md) (usage).

---

## 1. System overview

```
                          ┌─────────────────────────────────────────────┐
   HTTP request           │  Your NestJS app                            │
   (JWT: user, org) ─────▶│                                             │
                          │  AuditContextMiddleware                     │
                          │    → resolves { tenantId, actor, reqMeta }  │
                          │    → stores in AsyncLocalStorage (ALS)      │
                          │                                             │
                          │  @Audited() method                          │
                          │    → AuditInterceptor builds an AuditEvent  │
                          │        (action, entity, changes, metadata)  │
                          └───────────────┬─────────────────────────────┘
                                          │
                 mode = inline            │            mode = outbox
             ┌────────────────────────────┴───────────────────────────┐
             ▼                                                          ▼
  AuditWriter.appendInline(event)                        audit_outbox  ◀── enqueue(tx, event)
    • pg_advisory_xact_lock(tenant)                      (unordered, unhashed)
    • seq = last+1 ; prev_hash = last.row_hash                  │
    • row_hash = H(prev_hash, canonical(payload))       BullMQ worker (single writer)
    • INSERT audit_events                                • per-tenant, in seq of insertion
             │                                           • assigns seq + prev_hash + row_hash
             │                                           • INSERT audit_events ; delete outbox row
             └───────────────────────┬───────────────────────────┘
                                     ▼
                          ┌────────────────────┐        ┌──────────────────────────┐
                          │ audit_events        │        │ vellum verify / export   │
                          │ (append-only, RLS,  │◀───────│ dashboard (read-only,    │
                          │  per-tenant chain)  │        │ RLS-scoped role)         │
                          └────────────────────┘        └──────────────────────────┘
```

The `core` package owns everything cryptographic (canonicalization, hashing, verification) and has **no framework dependencies**, so it can be reviewed and unit-tested in isolation. `nestjs` wires it into DI; storage adapters implement a `StoragePort`.

---

## 2. Data model

### 2.1 `audit_events` (the chain)

```sql
CREATE TABLE audit_events (
  id           uuid         NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid         NOT NULL,
  seq          bigint       NOT NULL,                 -- per-tenant, 1..N, contiguous
  occurred_at  timestamptz  NOT NULL,                 -- logical event time (app clock)
  actor_id     text,                                  -- null for anonymous/system
  actor_type   text         NOT NULL DEFAULT 'user',  -- user | system | api_key | anonymous
  actor_label  text,                                  -- snapshot (e.g. email) at event time
  action       text         NOT NULL,                 -- 'participant.updated'
  entity_type  text         NOT NULL,                 -- 'Participant'
  entity_id    text,                                  -- null for non-entity events
  changes      jsonb        NOT NULL DEFAULT '{}',    -- {before, after, diff} (redacted)
  metadata     jsonb        NOT NULL DEFAULT '{}',    -- ip, ua, request_id, route, custom
  hash_version smallint     NOT NULL DEFAULT 1,       -- which canonical scheme produced row_hash
  prev_hash    char(64)     NOT NULL,                 -- row_hash of (tenant_id, seq-1); genesis = 64×'0'
  row_hash     char(64)     NOT NULL,                 -- see §3
  created_at   timestamptz  NOT NULL DEFAULT now(),   -- DB insert time; NOT hashed

  CONSTRAINT audit_events_pkey PRIMARY KEY (id),
  CONSTRAINT audit_events_tenant_seq_uniq UNIQUE (tenant_id, seq)
);

CREATE INDEX audit_events_tenant_time_idx  ON audit_events (tenant_id, occurred_at DESC);
CREATE INDEX audit_events_entity_idx       ON audit_events (tenant_id, entity_type, entity_id);
CREATE INDEX audit_events_actor_idx        ON audit_events (tenant_id, actor_id);
```

Notes:
- `seq` is the ordering authority *within a tenant*. `created_at`/`occurred_at` are informational and deliberately excluded from ordering to avoid clock-skew ambiguity.
- `(tenant_id, seq)` is unique — this is what makes concurrent appends safe (a race produces a unique-violation, not a fork).
- `created_at` is **not** part of `row_hash` (it's a DB default that verification can't reproduce deterministically). `occurred_at` (captured by the app clock) **is** hashed.

### 2.2 `audit_outbox` (outbox mode only)

```sql
CREATE TABLE audit_outbox (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid        NOT NULL,
  payload     jsonb       NOT NULL,        -- the full AuditEvent minus seq/prev_hash/row_hash
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  attempts    int         NOT NULL DEFAULT 0
);
CREATE INDEX audit_outbox_tenant_idx ON audit_outbox (tenant_id, enqueued_at);
```

The worker reads, chains, inserts into `audit_events`, then deletes the outbox row (all in one transaction).

### 2.3 `audit_checkpoints` (external-anchoring support)

```sql
CREATE TABLE audit_checkpoints (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid        NOT NULL,
  head_seq     bigint      NOT NULL,       -- chain head at checkpoint time
  head_hash    char(64)    NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  anchored_ref text                        -- where head_hash was published (S3 key, msg id, …)
);
```

A checkpoint says "at this moment the chain head was X." Once `head_hash` is published somewhere the app's DB role can't rewrite, history *before* it is frozen (see §7).

---

## 3. The hash chain — exact specification

The security of the whole system is one function reproduced identically at write time and verify time. It must be defined to the byte.

### 3.1 Canonical payload

For each event, build this object with **exactly these keys** (always present; unknown/absent optionals set to `null`, not omitted):

```jsonc
{
  "v": 1,                                  // = hash_version
  "tenant_id": "6f1e…",
  "seq": 843,
  "occurred_at": "2026-07-20T04:21:07.123Z", // RFC3339, UTC, exactly millisecond precision, 'Z'
  "actor": { "id": "u_12", "type": "user", "label": "sam@x.io" }, // nulls allowed inside
  "action": "participant.updated",
  "entity": { "type": "Participant", "id": "p_88" },
  "changes": { … },                        // already-redacted JSON value
  "metadata": { … }                        // already-redacted JSON value
}
```

### 3.2 Canonicalization (JCS)

Serialize the payload with **RFC 8785 JSON Canonicalization Scheme (JCS)**: keys sorted lexicographically at every level, no insignificant whitespace, UTF-8, canonical number forms. JCS is chosen over hand-rolled `JSON.stringify` because number/unicode edge cases must be deterministic across machines and language runtimes. Use a vetted JCS library in `core`.

`occurred_at` is always normalised to UTC with **exactly 3 fractional digits** before hashing, so precision can never drift.

### 3.3 Row hash

```
prev_hash = (seq == 1) ? "0"×64 : row_hash of (tenant_id, seq-1)
message   = prev_hash            // 64 lowercase hex chars, as ASCII
          + "\n"                 // 0x0A separator
          + JCS(payload)         // UTF-8 bytes
row_hash  = lowercase_hex( SHA-256( message ) )
```

That's the entire scheme. `hash_version` is stored per row so the algorithm can evolve (`v: 2`) without invalidating historical verification — the verifier dispatches on each row's version.

### 3.4 Worked genesis example

```
seq=1, prev_hash = "0000…0000" (64 zeros)
payload = { v:1, tenant_id:"t1", seq:1, occurred_at:"2026-07-20T00:00:00.000Z",
            actor:{id:null,type:"system",label:null}, action:"tenant.created",
            entity:{type:"Tenant",id:"t1"}, changes:{}, metadata:{} }
row_hash = sha256( "0000…0000" + "\n" + JCS(payload) )
```

---

## 4. Recording paths

### 4.1 Context propagation

`AuditContextMiddleware` runs `tenantResolver(req)` and `actorResolver(req)`, plus collects request metadata (ip, user-agent, request id, route), and calls `als.run(context, next)`. Everything downstream (interceptor, imperative API) reads the current context from ALS. Outside HTTP (jobs, CLI, seeds) you wrap work in `withAuditContext(ctx, fn)` manually.

### 4.2 The interceptor

`AuditInterceptor` (global or per-controller):

1. Read `@Audited()` options via `Reflector`; if absent, pass through.
2. Resolve `tenantId` + `actor` from ALS (throw if missing and `action` isn't marked `system`).
3. If `capture: 'diff'`, call `options.loadBefore(pointcut)` **before** `next.handle()`.
4. Run the handler → `result`.
5. Build `changes`:
   - `snapshot` → `{ after: result }`
   - `diff` → `{ before, after: result, diff: computeDiff(before, result) }`
   - `none` → `{}`
6. Apply redaction (global `redact` ∪ decorator `redact`) to `changes` and `metadata`.
7. Resolve `entityId`, `metadata`.
8. Hand the assembled `AuditEvent` to the active **write path** (§4.3 / §4.4).

Errors in the handler are re-thrown *before* any event is written (a failed operation produces no "success" audit; if you want to audit failures, record explicitly in a `catch`).

### 4.3 Inline path

```
appendInline(event):
  in a short DB transaction:
    pg_advisory_xact_lock( hashTenant(event.tenant_id) )   -- serialise this tenant only
    last := SELECT seq, row_hash FROM audit_events
            WHERE tenant_id = $1 ORDER BY seq DESC LIMIT 1
    seq        := (last?.seq ?? 0) + 1
    prev_hash  := last?.row_hash ?? "0"×64
    row_hash   := H(prev_hash, canonical(event, seq))
    INSERT audit_events(… seq, prev_hash, row_hash …)
  commit
```

The advisory lock is keyed on the tenant, so different tenants append fully in parallel; only same-tenant appends serialise. The `(tenant_id, seq)` unique constraint is the backstop: if two writers ever raced past the lock, one gets a unique violation and retries.

### 4.4 Outbox path (recommended)

**Enqueue** (in the caller's transaction, so it's atomic with the business change):

```
enqueue(tx, event):  INSERT INTO audit_outbox(tenant_id, payload) VALUES (…)
```

**Worker** (single consumer per queue; processes a tenant's rows in `enqueued_at` order):

```
for batch of outbox rows (grouped by tenant, ordered by enqueued_at):
  in one DB transaction:
    lock/read chain head for tenant
    for each row in order:
      seq++, prev_hash = running head, row_hash = H(...)
      INSERT audit_events
      DELETE audit_outbox row
    commit
  (BullMQ retries the batch on failure; deletes happen only on commit → at-least-once
   becomes exactly-once because re-processing a still-present outbox row just re-chains it,
   and an already-deleted row won't be reprocessed.)
```

Because the worker is the **sole writer** in outbox mode, sequencing needs no advisory lock — ordering comes from single-threaded processing per tenant. This is why outbox both scales the hot path and simplifies correctness.

---

## 5. Concurrency & ordering

- **Ordering authority:** `seq`, assigned at chain-append time (inline: under the tenant lock; outbox: by the single worker). Never derived from wall-clock time.
- **Cross-tenant:** fully parallel in both modes.
- **Within-tenant:** serialised (lock in inline; single worker in outbox).
- **Crash safety:** outbox insert is atomic with the business tx; the worker's append+delete is atomic. A crash mid-worker re-processes the surviving outbox rows — idempotent because a row is deleted only after its `audit_events` insert commits.
- **Clock skew:** irrelevant to integrity; only affects the informational `occurred_at`.

---

## 6. Verification algorithm

```
verify(tenant_id, from?, to?):
  rows := SELECT * FROM audit_events WHERE tenant_id = $1
          [AND seq BETWEEN from AND to] ORDER BY seq ASC
  expect_seq := from ?? 1
  expect_prev := (from && from>1) ? rows[0].prev_hash : "0"×64   -- anchor when ranged
  for row in rows:
    assert row.seq == expect_seq            else GAP at expect_seq
    assert row.prev_hash == expect_prev     else LINK break at row.seq
    recomputed := H(row.prev_hash, canonical(row, row.hash_version))
    assert recomputed == row.row_hash       else HASH break at row.seq
    expect_prev := row.row_hash
    expect_seq  += 1
  return { ok, count, head: last.row_hash, brokenAt? }
```

For a *ranged* verification the first row's `prev_hash` is trusted as an anchor; for a full verification the anchor is the genesis constant, so the whole chain is proven end to end. Evidence-pack export always runs a full verify (or verifies up to a checkpoint) so the pack can't present a valid-looking slice from an already-broken chain.

---

## 7. Threat model (read this honestly)

| Threat | Caught? | Mechanism |
|---|---|---|
| App code edits/deletes a past row | ✅ | append-only grants + trigger block it; if bypassed, chain breaks |
| Rogue one-off `UPDATE`/`DELETE` via app role | ✅ | trigger raises; RLS + no grants |
| Deleting a middle row | ✅ | `seq` gap + broken link |
| Reordering rows | ✅ | `prev_hash` links won't match |
| Cross-tenant read | ✅ | RLS policy on `tenant_id` |
| **Full chain rewrite by DB owner/superuser** | ⚠️ **only with anchoring** | recomputing every hash forward is internally consistent — external checkpoint needed |
| Secret leakage into the log | 🚫 mitigated | `redact`; hash is over the redacted stored form |

**Append-only enforcement:**

```sql
-- application role gets INSERT + SELECT only
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM app_role;
GRANT  INSERT, SELECT           ON audit_events TO   app_role;

-- belt-and-suspenders trigger (a superuser can still drop it — hence anchoring)
CREATE FUNCTION vellum_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_events is append-only'; END $$;
CREATE TRIGGER vellum_no_mutation BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION vellum_forbid_mutation();
```

**RLS:**

```sql
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY vellum_tenant_read  ON audit_events FOR SELECT
  USING (tenant_id = current_setting('vellum.tenant_id', true)::uuid);
CREATE POLICY vellum_tenant_write ON audit_events FOR INSERT
  WITH CHECK (tenant_id = current_setting('vellum.tenant_id', true)::uuid);
```

The writer sets `SET LOCAL vellum.tenant_id = '<uuid>'` inside its transaction (mirrors a standard per-request RLS setup). The dashboard uses a **separate read-only role** with only `SELECT`.

**The honest summary:** Vellum makes tampering *evident* for anyone below full-database-owner, and — once you anchor head hashes externally (v1: manual `vellum checkpoint`; v1.1: automated) — evident even against a database owner for all history before the anchor. It is not a blockchain and doesn't pretend to be; it's a pragmatic, auditable evidence layer.

---

## 8. Key decisions & rationale

1. **Per-tenant chains, not one global chain.** Cleaner tenant isolation, per-tenant export/verify, RLS-friendly, and parallel appends across tenants. Cost: a `seq` per tenant (trivial).
2. **`seq` for ordering, not timestamps.** Deterministic and skew-proof; timestamps stay informational.
3. **JCS canonicalization.** Cross-runtime determinism is non-negotiable for a hash others must reproduce; hand-rolled stringify has too many edge cases.
4. **Outbox as the recommended mode.** Solves atomicity *and* the per-tenant serialisation bottleneck with infra the target user already runs (BullMQ + Redis). Inline stays as the zero-config on-ramp.
5. **`core` is framework-free.** The trust-critical code is small, dependency-light, and independently testable.
6. **Honesty about the DB-owner threat.** Building in checkpoints from day one (even if anchoring is manual in v1) keeps the door open to real tamper-proofing without a redesign.
7. **Redaction before hashing.** You can only prove what you stored; hashing the redacted form keeps verification consistent with retention/PII rules.

---

## 9. Build order (suggested)

1. `core`: types, JCS wrapper, `hashEvent()`, `verifyChain()` + unit tests (determinism, tamper detection, gap detection).
2. SQL migration + `storage-pg` adapter implementing `StoragePort` (`appendInline`, `head`, `readRange`, `enqueue`, `drainOutbox`).
3. `nestjs`: `AuditModule.forRoot`, ALS context + middleware, `@Audited` + interceptor, inline writer.
4. Outbox mode: `enqueue(tx)`, BullMQ worker, exactly-once drain.
5. `cli`: `migrate`, `verify`, `export` (JSON then PDF), `checkpoint`.
6. `examples/basic-nestjs` incl. a **tamper test** (superuser `UPDATE` → `verify` fails) — this is the demo that sells it.
7. `apps/dashboard`: read-only list/filter, verify badge, export button.
8. `storage-prisma` adapter; polish; README badges; publish.

**Definition of done for v1:** a fresh NestJS app can install, migrate, add one decorator, generate events, `vellum verify` passes, a deliberate tamper makes it fail, and `vellum export --format pdf` produces a pack whose cover says "VERIFIED".
