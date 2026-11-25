# I built an audit log you can prove wasn't edited

Every B2B product hits the same moment. A customer's security team sends a questionnaire, and one
line says: *"Provide an immutable audit log of all data access and changes."*

Most of us answer with a `logs` table. The trouble is that anyone with database access can
`UPDATE` or `DELETE` a row in it, and nothing shows that it happened. A log you can quietly edit is
not evidence.

Attestly is my attempt at fixing that for NestJS and Postgres apps. You add a decorator, and every
audited action is written to an append-only table where each row carries a SHA-256 hash of the row
before it. Change or remove any past row and the chain stops adding up.

```ts
@Audited({ action: 'participant.updated', entity: 'Participant', capture: 'diff',
           entityId: (c) => c.args[0],
           loadBefore: (c) => c.self.repo.findById(c.args[0]) })
async updateParticipant(id: string, patch: UpdateParticipantDto) {
  return this.repo.update(id, patch);
}
```

```
$ attestly verify --tenant 78508e1e-...
  [ok] sequence contiguous (1 ... 2, no gaps)
  [ok] every prev_hash links to the prior row
  [ok] every row_hash reproduces from canonical payload + prev_hash
  RESULT: INTACT
```

## Watch it catch someone

The claim is easy to make and easy to doubt, so there's a script that tests it. `pnpm demo:tamper`:

1. seeds a real chain (a participant, consent, a service agreement, a claim, an incident),
2. runs `attestly verify` and gets `INTACT`,
3. connects as a superuser and rewrites one row (`UPDATE audit_events SET changes='{}' WHERE action='consent.granted'`),
4. runs `attestly verify` again and gets `TAMPERED at seq N`,
5. exports the evidence pack, whose cover page now says `FAILED`.

The append-only trigger blocks that `UPDATE` for every role, so the script has to switch the trigger
off first. That is the point: it shows what someone needs to be able to do, not a trick that
sidesteps the protection. The dashboard's chain badge flips the same way.

## What it does not protect against

I would rather say this up front than have you find it later.

A chain stored in the same database it protects is tamper-**evident** against edits to individual
rows. It is not tamper-**proof** against someone who owns the database and rewrites the whole chain
from the edit onward, recomputing every hash after it. If that is your threat model, the chain alone
is not enough.

The fix is to publish the chain's head hash somewhere the app's database role cannot change, such
as S3 Object Lock, an append-only system, or an email to your auditor. Attestly has a `checkpoint`
table and a `attestly checkpoint` command for recording what you published and where. Once a head
hash is anchored, nobody can move history behind it without that being detectable.

Today the anchoring is manual. Automating it is on the roadmap, along with signed evidence packs.
Until then, Attestly narrows the people who could tamper undetected to those holding the keys to your
database who also know to rewrite everything after the change and are willing to skip anchoring.
That is a much smaller group than "anyone who can run an UPDATE", but it is not zero.

## What's in it

- Per-tenant hash chains, canonicalised with RFC 8785 JSON so the hash is stable across runtimes.
- Tenant isolation through Postgres Row-Level Security, enforced by the database.
- `@Audited()` plus an imperative API, including a transactional one so an audit event commits or
  rolls back together with the business change it describes.
- Inline writes, or an outbox with a worker when you want hashing off the request path.
- A `attestly` CLI: `migrate`, `verify`, `export` (JSON and PDF evidence packs), `checkpoint`.
- A read-only dashboard for browsing and filtering a tenant's chain.
- `pg` and Prisma storage adapters that behave identically, tested against the same cases.
- An NDIS provider example that audits consent, claims and incidents, since that is the kind of
  record where "prove it" matters.

## Try it

```bash
pnpm add @attestly/nestjs @attestly/core pg
pnpm add -D @attestly/cli
npx attestly migrate --database-url "$DATABASE_URL"
```

Then register `AuditModule.forRoot(...)`, add one middleware, and put `@Audited()` on a method. The
README walks through it, and CI checks that walkthrough on every change by installing the packed
packages into a brand-new app and verifying the chain it produces.

Source, docs and the full threat model: https://github.com/msaaaad/Vellum

If you see a way to alter the log without detection, I want to hear about it. That is the bug that
matters most for a project like this.
