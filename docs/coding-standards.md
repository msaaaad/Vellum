# Coding standards (portable)

Distilled from a production TypeScript backend (NestJS, TypeORM, Postgres, Vitest) and from many
code reviews. Use it as `CLAUDE.md`, as a Cursor rule, or as a Copilot instructions file. Sections
marked (stack) are specific to NestJS / TypeORM / Postgres: keep, adapt or drop them.

How to use it with an AI agent: put the file at the repo root and tell the agent "follow
CODING-STANDARDS.md; before the first edit pick the gates that apply, before saying done walk them
against the diff". The two checklists at the end are the part that makes it work.

## 0. Principles

1. Write for a reader who has never seen this code. Names and structure carry the intent.
2. Optimize for code a senior engineer can understand fast, change without fear, and run
   efficiently. Compiling and passing tests is the minimum, not the goal.
3. Rules apply to what you add or rewrite in the current diff ("touched code"). Fix violations on
   contact. Do not drive-by rewrite untouched code.
4. Follow what the nearest module already does before inventing a new shape. Prefer duplication over
   a wrong abstraction.
5. When a requirement is ambiguous or a design is contested, ask a short question with concrete
   options and a recommendation. Do not silently pick.
6. Report outcomes faithfully. If a test fails or a step was skipped, say so. Do not claim a fact you
   have not verified.

## 1. Naming (hard gate)

Litmus test: if I only saw this name and its call sites, would I know what it means? Can a call
site be read as an English sentence that states the contract (required or optional, pure or I/O,
mutate or check)?

### 1.1 Grammar by kind

| Kind | Shape | Examples |
|---|---|---|
| Types, classes, interfaces | Noun | `Vehicle`, `IOnboardingVehicleItem`, `DriverDepositHelper` |
| Methods, functions | Verb phrase | `getVehicleByIdOrFail`, `assertCanManage`, `buildActiveGigsCte` |
| Locals, params, fields | Noun for the domain thing | `uploadByFileId`, `arrearsAmount`, `requestedImages` |
| Booleans | Question: `is` / `has` / `can` / `should` | `vehicleHasFeaturedImage`, `canManageImages` |
| Events | Past or present verb | `onImageDeleted`, `gigActivated` |

Reject: `data`, `info`, `value`, `item`, `tmp`, `expr`, `result`, `obj`, `flag`, `map` or `list`
alone, truncated words, and a role instead of the thing (`page`, `held`). Do not encode the type in
the name (`vehicleArray`, `vehicleMap`). Maps are `...ById` / `...ByKey`; sets of ids are `...Ids`;
raw query rows are `...Row`; SQL fragments are `...Expression`, `...Sql` or `...Subquery`.

Booleans that return a yes/no must read as a question. `affectsX`, `matchesY`, `contains`, `needs`,
bare adjectives are rejected.

### 1.2 Method verbs are contracts, not decoration

| Verb | Contract |
|---|---|
| `find...` | Optional lookup. Missing is normal. Returns `T \| null`. |
| `get...OrFail` | Required lookup. Missing throws. Never returns null. |
| `get...` (no OrFail) | Cheap in-memory read. Not a DB load-or-throw. |
| `load...` / `fetch...` | Explicit I/O (database or remote). Signals cost at the call site. |
| `resolve...` | Derive a value from known inputs. Not a lookup. |
| `try...` / `...OrNull` | Parse or convert that may fail without throwing. |
| `assert...` | Throws on violation. Never repairs. No `OrFail` suffix. |
| `ensure...` | Make true if needed (create-if-missing), then proceed. |
| `validate...` | Check input shape or rules. Not auth. |
| `build...` | Pure, in memory, no I/O. SQL fragment, payload, options, query builder. |
| `map...To<Target>` | Field-by-field transform with a named target (`mapRowToVehicleDomain`). Never bare `ToDomain`. |
| `parse` / `normalize` / `format` / `calculate` / `compute` | Pure. Must not hide I/O. |
| `create` / `add` / `attach` | Domain write that persists or associates. |
| `persist` | Save an already-built object. |
| `update` / `patch` / `move` | Change existing state. |
| `trash` / `restore` | Soft delete and undo. |
| `delete` / `remove` | Hard delete. |
| `purge` | Irreversible cleanup (orphans, blobs). |
| `enqueue` / `schedule` | Hand work to a durable queue. |
| `notify` / `send` / `publish` | Outbound message or event. |
| `is` / `has` / `can` / `should` | Boolean predicate, no mutation. |
| `process` / `handle` | Only at a queue consumer or pipeline entry. |

Rules:
- A name must match the implementation. Never rename a nullable `findX` to `getXOrFail` to sound
  senior.
- Pure names stay pure. A method named `calculate`, `build`, `map`, `parse` must not call the
  database, HTTP or a queue.
- No `And` in a name (`loadAndSend`). Split, or use one orchestration name for the whole operation.
- Do not use `do`, `check`, `manage`, `maybe`, `cleanup`, or a bare `handle` / `process` when a
  precise verb exists.
- Controller-facing use-case methods (the HTTP entry) keep a domain command name and no `OrFail`
  suffix, even if they throw.

### 1.3 Other naming

- Route and path params name the entity: `:vehicleTerminationId`, never `:id`.
- Do not use UI words in the backend (`car` in the UI, `vehicle` in code, SQL and API).
- A name says what the object is: `oldestOverduePayoutCycle`, not `oldest`.
- Enums that are part of the API live in the input or output DTO file.
- Use plain keyboard (ASCII) characters in everything you write: code, comments, strings, docs,
  commit messages. No en-dash, em-dash, curly quotes, arrows, ellipsis character, `<=` glyphs.

## 2. Types

- `interface` for object shapes (DTOs, rows, domain objects). `type` for unions, intersections,
  mapped types and aliases. Prefer `export interface IFoo` over `type IFoo = { ... }`.
- House style example: `I` prefix on API or domain interfaces, `IDb...` on SQL row shapes. Do not
  prefix every type alias with `T`. `T` is for generic parameters (`TRow`).
- No unnecessary `as` casts. If a field is `T | null` and a branch assumes it is set, put every
  related field in the guard so TypeScript narrows them together. Type the source (row interface,
  return type) correctly instead of casting at call sites. `as unknown as T` is acceptable only on
  test doubles.
- Mutually exclusive shapes are a discriminated union with a literal tag, not nullable soup.
  Use `| null` on a single field only when absence is one optional value.
- `null`, `undefined`, `0` and missing are different product meanings. Do not coerce them silently.
- No `any` in tests. Use typed fixtures, `unknown`, or narrow interfaces.

## 3. Comments (hard gate)

No comments in code, tests or migrations. If a "why" is needed, put it in a name: extract a
predicate or constant whose name states the rule (`isApologyBeforeOldestOverduePayout`).

Only exceptions: a short `TODO` on a not-yet-implemented placeholder, and a comment a reviewer
explicitly asks for. No commented-out code. No JSDoc that restates the signature. Before saying
done, grep your diff for `//`, `/*` and ` * `.

## 4. Functions and control flow

- One responsibility at one abstraction level. Orchestration methods read like the business
  process (get, assert, load, create, publish, map).
- Extract a helper when it is a real domain concept or the same non-trivial block appears twice. Do
  not extract only because a block is long, and do not extract a straight-line query just to name a
  `Promise.all` slot.
- Early returns for guards. Each guard states its own failure. No deep nesting.
- No nested or multi-line ternaries for multi-branch logic. Use `if` / `else` or a named helper.
  A one-line pick of two simple values is fine.
- No default parameter values (`= value`) in signatures, and no `param?: T` with `param ?? default`
  in the body that hides a product default. The call site passes the value. Use an options object
  when several arguments of the same type can be swapped. Framework-required defaults are exempt.
- No positional `true` / `false` arguments. Name the case in the method (`lockHeaderRow`) or use an
  options object.
- Compute a pure value once in a local and reuse it. Do not call the same `build...()` again in
  each error string.
- Magic numbers with domain meaning become named constants near the owning module. A constant used
  by one file stays private to that file.
- Assign a long expression or a complex object to a named local before putting it in an array or
  call. Leave a blank line between the variable block and the next step. Do not `await` inline in
  an object literal or argument.
- Block-bodied arrow callbacks with named locals when a `map` callback calls methods. Expression
  bodies are for trivial 1:1 transforms.
- Use the library or domain type the file already uses (for example `ExcelJS.Row`). Do not invent
  an inline structural type for it.
- Prefer `if` with early return over a `switch` on an enum filter when each branch is small.
- Dates: use one shared date helper for calendar math, comparison, formatting and weekday checks.
  If it lacks the operation, add it to the helper (with a unit test). Do not hand-roll
  `new Date(y, m, d + n)`, `setDate`, or `getDay()` in feature code.
- API response mapping is field by field. Do not spread helper results or destructure a row into
  the response. The reader must see every response field and its source in one place.

## 5. Performance and data access

Walk this table for every touched service or helper.

| Ask | If yes |
|---|---|
| Do two or more awaits not depend on each other? | `Promise.all`. |
| Am I stacking filter, map, flatMap and spread to collect, filter and de-dupe? | One `for...of` into a Set, Map or array. A pure 1:1 map is fine. |
| Am I looping again to fill a second Map after a helper already walked the list? | Build every index the caller needs in one pass. |
| `.find`, `.some`, `.includes` inside a loop over another list? | Build a Set or Map once. Skip for tiny lists if it hurts clarity. |
| Same query shape awaited inside a loop (N+1)? | One batch query or one batch save. |
| Empty id list about to hit an `IN` or `UNNEST`? | Return early before the database. |
| Large or unbounded id list bound as `IN (:...ids)`? | One array parameter (`ANY` or `UNNEST`) instead. Not by default for small lists. |
| Loading rows to filter, count or sum in code? | Push it to SQL (`WHERE`, `FILTER`, CTE, aggregates). |
| Loading rows only to check existence? | `EXISTS` or `.exists()`. |
| `DISTINCT` only to hide join duplicates? | Fix the join shape. |
| List endpoint with no limit? | Paginate or bound it, unless it is an intentional bulk job. |
| Can auth, ownership or empty input fail before the expensive work? | Run the cheap guard first. |
| Holding a DB transaction open across external HTTP (storage, payments, email)? | Never. Keep transactions around DB work only. |
| Side effect not needed for the response? | Best-effort (`void fn().catch(log)`) or a durable queue with retries. Blob or file cleanup goes to a durable queue. |

Order work by cost: empty input, auth, ownership, cheap existence, expensive joins, external I/O,
writes, non-critical side effects.

## 6. SQL and TypeORM (stack)

- Always list the columns you use (`select`). No `SELECT *` or full-entity loads to read two fields.
  Use `.exists()` for presence checks. Join relations only when a selected field lives on them.
- A reused query shape is a `build...Query` method that returns the query builder only. Keep
  `getOne`, `getMany`, `execute` and `Promise.all` at the call site. Do not wrap the shape plus the
  final call in a `load...` helper.
- Prefer a query builder subquery plus `.getQuery()` for EXISTS and scalar subselects over a
  hand-written `SELECT` string. The local holding it is named `...Expression`, `...Sql` or
  `...Subquery`.
- Multi-line SQL strings are tidied with `.replace(/\s+/g, ' ').trim()`.
- One bind: `.setParameter(name, value)`. Two or more: one `.setParameters({ ... })`. Never chain
  several `.setParameter` calls.
- SQL and CTE aliases are the domain noun (`quote`, `vehicle`) or an initialism of the table words
  (`pcfr` for `paged_cleared_for_repair`). Never `t`, `x`, `tmp`, `page`.
- Soft delete: every join and every search branch that reads a table with `deleted_at` filters
  `deleted_at IS NULL`. When one query in a file filters it, check every sibling query for the same
  filter.
- Write queries the standard readable way. Spell out each subquery and EXISTS as its own named
  chain and combine them in one visible condition. No config-array query generators, no helpers that
  take table, alias or column fragments as parameters, no single-use pass-through methods.
- Multi-column `ILIKE '%term%'` search: never join then `OR` across tables (it skips the trigram
  index). Use `id IN (branch UNION branch ...)` for large fact tables, or per-column `EXISTS` when
  the outer set is already small. One searchable predicate per branch. Add `gin_trgm_ops` indexes
  for new searchable columns.
- Generated columns cannot be updated. Change the source columns.
- Migrations: use the current timestamp, never auto-run them from the agent, never edit old ones.
- Use `PATCH` for partial updates and build a patch containing only the fields the caller sent.

## 7. API design (stack)

- Reporting endpoints take `fromDate` and `toDate` (inclusive calendar days in one fixed timezone,
  validated as date strings), not a fixed period such as `year`, `month` or a Week/Month/Year enum.
  Cap the range when work grows with it and throw a bad request that names the dates. A `toDate`
  after today is treated as today. A `fromDate` after `toDate` or after today is a bad request.
- One screen, one endpoint when the cards and the table share the same filters.
- The response carries every field the screen shows, with the meaning the design gives it. If a
  field has no backend source, stop and ask. Do not drop it, substitute it, or invent a value.
- Every action that opens, jumps to or pre-selects something gets its ids in the response (entity
  id, cycle id, batch id, payout ids, method). Before calling an endpoint done, go through each
  click handler of the screen and name the response field that feeds it.
- A person in a response is an object `{ id, firstName, middleName, lastName, phone }`, not flat
  `ownerName` strings. The frontend builds the display name.
- The API sends data, never display text: no labels, subtitles or print-ready strings. Return raw
  numbers, ISO dates and enums. Exceptions: spreadsheet cell text, messages the backend itself
  sends, and exception messages.
- An amount shown on a card gets a `currency` next to it.
- When the design is ambiguous about a period (for example overdue "now" vs in the period), send
  both fields (`...PeriodAmount`, `...TotalAmount`) and let the frontend pick.
- A derived figure that is "whatever is left" (a balancing figure) is not what its name says. Show
  the real source value and give the remainder its own neutral, named line. State in the field
  description what each sign means, and check that description against live data.
- Swagger: do not hand-write query params that already live on a query DTO. Descriptions add
  non-obvious meaning (null means what, the formula, the window). Do not restate the property
  name. Keep error response text short ("Bad request").

## 8. Errors and HTTP status (stack)

| Situation | Throw |
|---|---|
| Resource id does not exist (or soft-deleted) | `NotFoundException` (404) |
| Valid request that breaks a rule or eligibility | `BadRequestException` (400) |
| Caller lacks permission | `ForbiddenException` (403) |
| Missing or invalid auth | Framework or guard (401) |

- The Swagger decorator must match what the service throws. Do not document a 404 under bad
  request.
- Name the failing domain thing in the message: type, id, plate, stage. If the message would still
  make sense after deleting every id from the request, it is too generic.
- A status guard lists the blocked states, each with its own named `if` and message. No blanket
  `!==`.
- Proofread error strings like code.

## 9. Tests

- Test behavior-bearing units (services, helpers, use cases, consumers, cron, validators). Skip
  controllers and modules unless asked.
- Specs live in the feature's `__tests__` folder. The top `describe` is the unit under test, with
  one nested `describe` per method or behavior group.
- Fixtures own the data. Each fixtures file owns its own ids and scalars. Do not import another
  feature's fixtures to reuse an id, and do not borrow another library's test utilities (copy
  them). No bare id, amount or date constants at the top of a spec. Entity ids are UUID-shaped even
  in generated rows (`00000000-0000-4000-8000-000000000001`), never `run-1` or `"0"`.
- Assert SQL-ish strings with an independently written literal, not by re-deriving from the same
  builder call. Mocked tests cannot catch SQL syntax errors, so run every new hand-built query
  against a real local database.
- A mock that hides a collaborator's failure is a gap. Before saying a missing-data case is
  handled, read what the real downstream method does (does it throw?) and test through the real
  method at least once.
- A reconcile test on a figure defined as the remainder of the others passes by construction and
  proves nothing. Assert the source value against what the collaborator returned.
- Cover happy, edge and out-of-scope cases on purpose. When behavior changes, extend the existing
  spec instead of creating a parallel file.
- Run tests with a CPU cap on the CLI (for example `--maxWorkers=50%`). Never put it in committed
  config. Do not rerun after trivial edits.
- Use the project's test framework API consistently (for example `vi.*`, not `jest.*`).

## 10. Process

### 10.1 Plan, then build

- When asked to plan, write a real plan file before any code and tell the user the path. Do not
  start implementing until they say go. Structure: title and overview, then per workstream
  (Problem, Findings with file paths, Solution with locked decisions, Out of scope), then an
  implementation checklist, then the test cases to cover.
- Do not leave contested choices open inside a plan. Ask, get the answer, then write it as locked.
- Do not plan documentation unless it was asked for. Self-documenting code carries the intent.
- One API (or one change) at a time: build it, verify it, say it is done, wait for the user to test.

### 10.2 Git and shipping

- Commit only when told. Never push unless told. No destructive git operations without asking.
- Commit messages: conventional commits, short body lines (100 characters or less), no reviewer
  names, no tool attribution footers unless the team wants them.
- Before the final commit, and again before handing back, run `git fetch` and merge the base branch.
  A branch that is behind the base is the first thing a reviewer notices.
- Keep the diff focused on the task. Check the changed file list against the task before
  committing. Never claim an update that was not made.
- Rule and instruction files are not committed as part of a feature unless asked.
- Never read, print or paste secrets, `.env` contents, tokens or credentialed URLs. Load only the
  keys a single command needs. If a user pastes a token for a live test, store it in a temp file,
  use it, delete the file, and treat the token as exposed.
- Local database work: local container only, ask before each command, run only SQL the user approved
  (or a connectivity ping). Show changed SQL again before running it. Restore any row you changed
  (use an exit trap so the restore runs even when a step fails).

### 10.3 Review hygiene

- When a reviewer flags one instance, grep the diff for siblings of the same pattern before calling
  it fixed.
- If you catch yourself having written a wrong claim in a description or test name, correct it
  immediately and say plainly what was wrong. Do not defend it.
- If the user catches a rule miss: fix it in the same turn, then check whether the written gate was
  too soft and strengthen it.

## 11. Before the first edit (preflight)

Pick the gates that apply to the files you will touch. Read-only exploration is allowed first.

- Touching a service or helper: sections 4, 5, 6 and 8.
- Touching a response or DTO: section 7.
- Touching a spec or fixtures: section 9.
- Touching names or strings: sections 1 and 3, and the ASCII rule.
- Touching dates: use the date helper.
- Touching a migration: current timestamp, never run it.
- Running local tests: add the CPU cap on the command line.

## 12. Before claiming done (ship check)

Walk this against your diff only. Do not trust memory: grep.

1. Names match contracts (`OrFail` on required lookups only, pure names are pure, booleans are
   questions, SQL fragments have a suffix, no vague verbs).
2. One responsibility and one abstraction level per method. No nested ternaries.
3. Independent awaits are in `Promise.all`. No N+1. Empty lists short-circuit. No O(n*m) lookups.
4. Filters and aggregates are in SQL. Lists are bounded. No `DISTINCT` hiding a join. Search uses
   the union or EXISTS shape.
5. Cheap guards run first. Side effects are classified (best-effort or durable). No transaction
   across external HTTP.
6. Explicit column selects. Soft-delete filters on every read of a soft-deleted table.
7. Errors name the failing domain thing and use the right exception class and Swagger decorator.
8. No comments, no non-ASCII, no `as` casts that hide a null gap, no default parameter values, no
   positional booleans.
9. Response: every field the screen shows, every navigation id, person objects, currency next to
   amounts, no display text, field descriptions checked against live data.
10. Tests: fixtures own ids (UUID-shaped), real collaborators exercised at least once, no
    tautological reconcile checks, run with the CPU cap, all green.
11. New hand-built SQL ran against a real local database.
12. Branch is up to date with the base branch, only intended files changed, nothing committed or
    pushed without being asked.
13. Final question: if another senior engineer inherits this in six months, will the names,
    structure, SQL shape and execution model make the intended behavior obvious? If not, improve
    it before saying done.

## 13. Lessons that came from real reviews

- A figure computed as the remainder of other figures hides what really happened. Show the real
  source value and give the gap its own line.
- A reconcile test on a remainder passes by construction. Assert against the source.
- A mocked collaborator can hide a throw. Read the real method and test through it once.
- Check the sign and meaning of a derived field against live data before writing it into API docs.
  Read which code path the endpoint really uses before writing a claim about it (one path clamped a
  value at zero, the other did not).
- Search for sibling queries when one gets a soft-delete filter.
- Batch external calls per page or export (one call with many keys), not one per row.
- Do not make a response depend on the server timezone. Read date columns as text (`YYYY-MM-DD`)
  when you only need the calendar day.
- A missing optional dependency (such as default plan rates) must not 404 the whole page. Handle it
  where it is needed and return null for the affected row.
- Fix a reviewer's point at its root, then update every place that repeats the same wording (API
  description, tests, docs, PR text).
