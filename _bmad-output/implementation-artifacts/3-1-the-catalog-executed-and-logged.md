---
baseline_commit: 4739f79
merge_request: 35
---

# Story 3.1: The catalog, executed and logged

Status: done

## Why this story exists

Epic 3 is the product's central trust claim made visible: *"ask a question, get an answer you can
prove."* Everything after this story consumes a mechanism that does not exist yet. There is no
`catalog/`, no `tools/`, no `agent/` — verified by `ls`: the source tree the architecture describes
stops at `adapters/`.

Two invariants decide that this is the **first** story of the epic rather than a later one, and the
epic file names both:

- **AD-12**: *"A query path that can execute without writing this record is a defect."* Provenance
  cannot be retrofitted onto an execution path that already exists — a retrofit logs the paths
  somebody remembered.
- **AD-14**: *"Once a catalog entry version is used in production, its SQL text and parameter schema
  are frozen."* Immutability has to be enforced from the first entry, because the second entry is
  when editing one in place starts to look reasonable.

So this story builds one thing and proves two properties of it: **a named catalog entry with typed
parameters runs, and it cannot run without writing provenance first.**

### What this story is not

| Not this story | Whose it is |
| --- | --- |
| `/tools/*` HTTP endpoints, service-token auth | 3.2 |
| The Python service, CrewAI, pytest in the gate | 3.3 |
| A model choosing an entry; tool registration with `strict: true` | 3.4 |
| The pre-render numeric validator (AD-7) | 3.5 |
| Any user-visible surface, ask field, evidence table | 3.6 |
| Reading the provenance log back (UX-DR16) | 3.8 |

Nothing here renders an answer to anybody. The deliverable is a library plus a table, exercised by
tests. Resist adding a route; a route without 3.2's authentication is the unauthenticated data path
AD-15 exists to forbid.

## Story

As the board,
I want every question the system answers to run one of a fixed set of reviewed queries, with who
asked, what they asked, and the exact SQL recorded before any rows come back,
so that an answer can be replayed and audited a year later rather than taken on trust.

## Acceptance Criteria

1. **A catalog entry is a frozen, versioned, typed declaration.** `catalog/` holds entries; each
   declares a stable string id (`verb_noun`), an integer version, its SQL text, and a parameter
   schema carrying `additionalProperties: false`. The registry resolves `(id, version)` to exactly
   one entry, and `dues_status@1` is the first.

2. **Parameters are validated before anything executes.** A value of the wrong type, a missing
   required parameter, or an unknown parameter name is rejected and **no SQL runs and no log row is
   written**. The rejection names the offending parameter.

3. **Provenance is written before the query runs (AD-12).** Executing an entry appends a `query_log`
   row — actor, timestamp, entry id, entry version, bound parameter values, and the exact SQL text —
   *and only then* runs the SQL. If the log write fails, the query does not run and the caller gets
   an error, not rows. There is no code path from "caller asks" to "caller receives rows" that skips
   the log.

4. **The log is append-only in the schema, not by convention (AD-12).** No application role may
   UPDATE, DELETE or TRUNCATE `query_log`, and `watchdog_reader` may not SELECT it at all. Proven by
   connecting as each role and asserting the statement fails.

5. **A published entry version cannot be edited (AD-14).** `catalog/published-versions.json` pins a
   digest of each published `(id, version)`'s SQL text and parameter schema. Changing either without
   minting a new version fails a test whose message says to mint a new version.

6. **The entry SQL executes as `watchdog_reader` with bound parameters (AD-4, AD-5).** Parameter
   values are passed as `pg` placeholders, never interpolated into SQL text. The executor's public
   surface accepts an entry reference and parameters — there is no argument through which a caller
   can supply SQL.

7. **`dues_status@1` returns every number its answer needs, including the derived ones (AD-6).** For
   a unit and year it returns the unit number, the year, the annual amount, the total paid, the
   balance outstanding, the payment count and the date of the most recent payment. The balance is
   computed in SQL; nothing downstream subtracts anything.

8. **Money crosses the boundary as a decimal string.** Every amount `dues_status@1` returns is a
   decimal string, including the derived balance and the summed total. No `Number()`, no
   `parseFloat`, no `::float8` cast anywhere on the path.

## Tasks / Subtasks

- [x] **Task 1 — `migrations/020_query_log.sql` and `migrations/query-log.test.ts` (AC: 3, 4)**
  - [x] Table `query_log`: `id uuid primary key default uuidv7()`, `actor_id uuid not null
        references board_member (id)`, `executed_at timestamptz not null default now()`,
        `entry_id text not null`, `entry_version integer not null`, `parameters jsonb not null`,
        `sql_text text not null`.
  - [x] Constraints: `entry_version > 0`; `entry_id` non-blank; `sql_text` non-blank;
        `jsonb_typeof(parameters) = 'object'`.
  - [x] **Revoke `update, delete, truncate on query_log` from `watchdog_writer` and from `public`.**
        Migration 002's default privileges grant the writer all four on every future table, so
        without this revoke the table is append-only in name only.
  - [x] **Grant nothing to `watchdog_reader`.** Migration 003 already revoked the reader's blanket
        SELECT and its default privilege, so silence is sufficient — but say so in a comment, or the
        next reader assumes it was forgotten. The argument is migration 003's: the LLM-driven query
        path has no business reading the audit trail of its own queries.
  - [x] Index on `(entry_id, executed_at desc)` — story 3.8 reads this table by entry and recency,
        and an index added with the table costs nothing.
  - [x] `comment on table` / `comment on column` for `parameters` and `sql_text` stating why the SQL
        text is stored verbatim rather than referenced by version (AD-14 makes them equivalent
        today; storing it means the log survives the catalog file being deleted).
  - [x] Text test over the migration in the existing style, using `migrations/executable-sql.ts` to
        strip comments before matching. **Match the revoke, not the sentence describing it.**

- [x] **Task 2 — The catalog itself (AC: 1, 2, 5, 7, 8)**
  - [x] `catalog/entry.ts` — the `CatalogEntry` type and its `ParameterSchema`. Pure: no `pg`, no
        `next`, no I/O beyond `node:crypto` in `digest.ts`.
  - [x] `catalog/validate-parameters.ts` — validates a parameter object against a schema. Supports
        exactly the types the catalog uses (`string`, `integer`); rejects unknown properties, missing
        required ones and wrong types, naming the parameter. Adding a type is a code change with a
        test, which is the point.
  - [x] `catalog/entries/dues-status-v1.ts` — `id: 'dues_status'`, `version: 1`, parameters
        `{ unitNumber: string, assessmentYear: integer }`, `additionalProperties: false`.
  - [x] `catalog/registry.ts` — `entryFor(id, version)` and `currentVersionOf(id)`. Duplicate
        `(id, version)` in the registry is a startup-time failure, not a silent last-wins.
  - [x] `catalog/digest.ts` + `catalog/published-versions.json` + `catalog/published-versions.test.ts`
        — the AD-14 freeze. The test recomputes each digest and fails with *"mint a new version"* on
        a mismatch, and fails on a published `(id, version)` that has disappeared from the registry.

- [x] **Task 3 — The port and the executor (AC: 2, 3, 6)**
  - [x] `core/ports/query-log.ts` — `QueryLog.record(entry)` returning the written row's id. Write
        only; there is no read method, because story 3.8 owns the reader and a method nothing calls
        is a capability waiting to be misused. Say so in the docblock, as
        `core/ports/assessment-directory.ts` and `unit-directory.ts` do.
  - [x] `core/ports/catalog-executor.ts` — `execute({ entryId, version, parameters, actorId })`.
        Types only; `core/` imports nothing outward and this must not change that.
  - [x] `adapters/db/query-log-postgres.ts` — connects as **`watchdog_writer`**
        (`readWriterDatabaseUrl`), INSERT only.
  - [x] `adapters/db/catalog-executor-postgres.ts` — connects as **`watchdog_reader`**
        (`readReaderDatabaseUrl`). Order is: resolve entry → validate parameters → **record
        provenance** → execute → return. Each pool follows the existing module-scoped shape in
        `assessment-directory-postgres.ts`, including the `sharedPool.on('error')` listener.

- [x] **Task 4 — Prove the properties, against the real database (AC: 3, 4, 6, 7, 8)**
  - [x] `adapters/db/catalog-execution.test.ts` — seeds a unit, an assessment and payments, runs
        `dues_status@1`, and asserts **both** the returned figures **and** that exactly one
        `query_log` row exists carrying the right entry id, version, parameters and the entry's exact
        SQL text.
  - [x] **The negative that carries AC3**: with the log write made to fail, assert the call rejects
        **and** that no rows were returned to the caller. A test that only asserts the rejection
        passes against an executor that logs after returning.
  - [x] Role tests: `watchdog_reader` SELECT on `query_log` fails; `watchdog_writer` UPDATE and
        DELETE on `query_log` fail. **Assert the error message or `code`**, not `toThrow(Error)` —
        a missing table and a refused grant look identical to `toThrow`.
  - [x] Per-file `RUN_PREFIX` on the seeded unit numbers. `unit`, `assessment` and `payment` are the
        tables every epic-2 database test seeds into.

## Dev Notes

### Provenance goes first, and that is a decision with a cost

AD-12 says the record is appended *"before the result is returned to the caller."* Two orderings
satisfy the literal words; only one satisfies the sentence after it.

**Write the log, then run the query.** The alternative — run, then log, then return — records only
executions that succeeded. A prompt-injected agent that fires five hundred queries which all error
leaves no trace at all under that ordering, and "what did it try?" is exactly the question a
fiduciary audit trail exists to answer.

The cost is real and belongs in the migration's comment rather than in a reviewer's discovery: **the
two statements are on two connections under two roles and cannot share a transaction.** So a logged
execution is a *statement of what was executed*, not proof that rows came back. There is deliberately
no `succeeded` column: recording the outcome would mean an UPDATE, and AC4 makes the table
append-only. If a later story needs outcomes, it appends a second row to a second table — it does not
soften this one.

### `dues_status@1`: what it answers, and the two things it deliberately does not

```
select unit.unit_number, assessment.assessment_year, assessment.annual_amount,
       coalesce(sum(payment.amount), 0)                            as amount_paid,
       assessment.annual_amount - coalesce(sum(payment.amount), 0) as balance_outstanding,
       count(payment.id)                                           as payment_count,
       max(payment.paid_on)                                        as last_paid_on
```

…joined `assessment → unit`, left-joined to `payment` on the unit and the year, filtered by
`unit.normalised_number = unit_normalised_number($1)` and `assessment.assessment_year = $2`.

**Follow `adapters/db/assessment-directory-postgres.ts` exactly** on three points it already argues
for at length: `unit_normalised_number($1)` so `4b ` finds `4B`; columns named one by one rather than
`select *`; and no cast on any amount, because `pg` maps `numeric` to a decimal string and that *is*
the contract. `count()` returns `bigint`, which `pg` also maps to a string — that is correct for this
project's conventions and should not be "fixed" into a `number`.

Two exclusions, stated so they are decisions and not omissions:

1. **No instalment or arrears comparison.** "What is overdue as of today" needs the schedule, and
   `core/assessment/schedule.ts` already derives it — in TypeScript, with a remainder rule and its
   own test suite. Reimplementing that in SQL is a second statement of the same shape with nothing
   failing on disagreement, which migration 007's comment records this project learning the hard way.
   The arrears question is a later catalog entry that consumes the schedule, or a later story.
2. **No holder.** Naming who held the unit means the temporal join across `unit_membership` and its
   exclusion constraint. It is a real question and it is not this one.

**One attribution rule that must be written down where a reader will find it.** `payment` has no
period column — only `paid_on`. `dues_status@1` therefore attributes a payment to the assessment year
its `paid_on` falls in. A January 2027 payment settling 2026 dues is counted against 2027. That is a
limitation of version 1, it belongs in the entry's docblock, and fixing it is `dues_status@2` — never
an edit to `@1`.

### Why `catalog/` sits beside `core/` and not inside it

The architecture's source tree puts it there: *"`catalog/` — versioned query catalog: reviewed SQL +
typed params."* Keep it pure — SQL as text, schemas as data, no `pg` import — so a reviewer reading a
catalog entry is reading the whole of what will execute.

`core/ports/boundary.test.ts` scans `core/` only, so nothing stops `core/` importing `catalog/`.
Nothing should: the ports carry types, the adapter is what knows both. If a later story wants that
enforced, extend the boundary test rather than relying on this paragraph.

### The AD-14 freeze, and the failure mode it exists to catch

The digest covers the SQL text **and** the parameter schema. Only pinning the SQL leaves the more
likely mistake uncaught — loosening a parameter type in place, which changes what `dues_status@1`
accepts while the audit trail keeps saying `dues_status@1`.

`published-versions.json` is committed data, so the diff shows a digest changing. Make the failure
message say **"mint a new version"**; a bare digest mismatch reads like a broken test and invites
someone to paste the new value in.

### Learnings that apply directly

1. **A green unit test proves a part works; only a test that runs the path proves the parts are
   connected.** Three epic-2 stories were written because of this. Task 4's end-to-end test against
   the real database is the one that matters — a fake pool cannot answer for
   `unit_normalised_number()`, for the role grants, or for `numeric` arriving as a string.
2. **Choose values that discriminate.** An assessment of 1200 paid in two payments of 600 cannot tell
   `amount_paid` from `balance_outstanding` if the test also uses 600 elsewhere. Pick an annual
   amount, a paid total and a balance that are three visibly different numbers, and more than one
   payment so `payment_count` and `max(paid_on)` mean something.
3. **A test that counts rather than checks.** Asserting one `query_log` row exists passes against an
   insert that wrote nulls into `parameters` and `sql_text`. Assert the contents.
4. **`toThrow(SomeType)` cannot tell a contract from a crash.** On every role refusal in Task 4,
   assert the message or the SQLSTATE.
5. **A mutation removing two things at once cannot show that either one matters.** When running the
   sensitivity check on AC3, remove the log write alone — not the log write and its error handling.
6. **Read the file count in the test summary.** This suite has silently under-run twice here.

### Testing standards

- Gate: `npm run lint`, `npm run build`, `npm test`, `npm run test:db`, and
  `npx --no-install tsc --noEmit` against its **baseline of 8 pre-existing errors**. Quote the
  numbers from the run, not from memory.
- No Python in this story, so no pytest and no gate change. That is story 3.3's obligation and
  writing it early would register a gate nothing runs.
- Migration text tests use `migrations/executable-sql.ts`. Do not hand-roll another comment stripper;
  the two that exist are already on the deferred-work list for being quote-unaware.
- Anything writing to `unit`, `assessment`, `payment` or `query_log` needs a per-file `RUN_PREFIX`.

### If this has to be cut

Split at the entry, not at the mechanism. **Tasks 1, 3 and 4 are the story** — the table, the
executor and the proof that provenance cannot be bypassed. `dues_status@1` could degrade to a
trivial entry and the epic would still stand, because 3.4 is where entry selection becomes real.
Cutting the AD-14 freeze (Task 2's last bullet) is the one thing not worth cutting: it is cheap now
and a retrofit once three entries exist.

### References

- `_bmad-output/planning-artifacts/architecture/architecture-HOA-Treasurer-Assistant-2026-07-29/ARCHITECTURE-SPINE.md`
  — AD-4, AD-5, AD-6, AD-12, AD-14; Consistency Conventions (money, ids, naming, tool contracts,
  logging); Structural Seed source tree.
- `_bmad-output/planning-artifacts/epics.md` §Epic 3 — the story spine, the two ordering constraints,
  and the note that `dues_status` is the natural first entry now Epic 2 exists.
- `migrations/002_roles.sql`, `migrations/003_reader_hardening.sql` — the grant model this migration
  must fit into, and the precedent for withholding a table from the reader.
- `migrations/013_assessment.sql`, `migrations/015_payment.sql` — the columns `dues_status@1` reads
  and the money type it must not cast.
- `adapters/db/assessment-directory-postgres.ts` — the pool shape, the reader connection, and the
  three SQL conventions to copy verbatim.
- `core/ports/assessment-directory.ts`, `core/ports/unit-directory.ts` — the docblocks arguing their
  own read-only-ness; `core/ports/query-log.ts` makes the mirror-image argument for write-only.
- `core/assessment/schedule.ts` — the instalment derivation this story must not duplicate in SQL.
- `migrations/executable-sql.ts` — the shared comment stripper every migration text test uses.

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m]

### Test Design

Four behaviours, their failure modes, and how each is classified. Written before any test.

#### Behaviour 1 — the `query_log` table (Task 1)

| Failure mode | Class | Where it is forced |
| --- | --- | --- |
| `parameters` stored as text, so the trail cannot be queried by key | GUARD | round-trip test asserts a jsonb object comes back |
| `parameters` is an array, scalar or JSON null — what passing the wrong variable produces | GUARD | `query_log_parameters_are_an_object`, four cases |
| Blank or non-catalog `entry_id`, so the row identifies nothing | GUARD | `query_log_entry_id_shaped` |
| `entry_version` 0 or negative, so `(id, version)` resolves to nothing | GUARD | `query_log_version_positive` |
| Blank or absent `sql_text` | GUARD | `query_log_sql_text_present`, plus the NOT NULL |
| `actor_id` naming no director — a trail that looks answered | GUARD | foreign key |
| **Writer keeps UPDATE/DELETE from migration 002's default privileges** | GUARD | the revoke; observed failing before it existed |
| Reader can read the audit trail of its own queries | GUARD | no grant, asserted by statement and by catalog |

#### Behaviour 2 — `validateParameters` (Task 2)

| Failure mode | Class | Where it is forced |
| --- | --- | --- |
| Undeclared property reaches the query | GUARD | named in the message |
| Required property absent | GUARD | named in the message |
| Wrong type, including `'2026'` for an integer | GUARD | per-type tests |
| Non-integer number: fraction, NaN, Infinity | GUARD | `Number.isInteger` alone |
| A falsy-but-present value (`''`, `0`) read as absent | GUARD | explicit accept test |
| **Inherited property satisfying `required`** — what a `__proto__` payload produces | GUARD | `Object.hasOwn` throughout |
| Values argument that is not an object at all | GUARD | null, array, string, number |

#### Behaviour 3 — the executor's ordering (Task 3)

| Failure mode | Class | Where it is forced |
| --- | --- | --- |
| **Query runs before the provenance write** | GUARD | the query-runner seam; asserted on call order |
| Provenance write fails and the query runs anyway | GUARD | fake log throws; runner asserted never called |
| Unknown entry or version logged as if it executed | GUARD | asserts nothing was recorded |
| Invalid parameters logged as an execution | GUARD | asserts nothing was recorded |
| Values bound in the caller's key order rather than the entry's | GUARD | keys supplied reversed |
| Query fails after the record is written | PROPAGATE | record stays; error escapes |
| Compensating delete for a failed query | OUT-OF-SCOPE | impossible by design — migration 020 revokes DELETE |

#### Behaviour 4 — `dues_status@1` (Task 4)

| Failure mode | Class | Where it is forced |
| --- | --- | --- |
| An amount crosses as a float or a JS number | GUARD | `typeof` assertion per amount |
| Balance left for something downstream to subtract | GUARD | asserted in SQL and in the result |
| `count(*)` reporting one payment for a unit that has paid none | GUARD | the paid-nothing case |
| Payments from another year counted | GUARD | a 2027 payment seeded that must not appear |
| Unit matched literally rather than folded | GUARD | lower-cased, space-padded lookup |
| A `date` compared as an instant | GUARD | calendar-date comparison, timezone-independent |
| Arrears against the instalment schedule | OUT-OF-SCOPE | would restate `core/assessment/schedule.ts` in SQL |
| Payment-to-period attribution | OUT-OF-SCOPE | `payment` has no period column; a later `dues_status@2` |

### Debug Log References

**Task 1 red, and it was the one that mattered.** The migration was written *without* the revokes
first, deliberately. `npm run test:db` then failed five tests — the two migration-text assertions and
three privilege assertions — with `watchdog_writer` successfully running `update query_log` and
`delete from query_log` against a live table. That is migration 002's `alter default privileges`
doing exactly what its comment says, observed rather than assumed. Adding the revokes took it green.

**Task 2 red** was 23 assertion failures against stubs. One of them was a test defect rather than a
code defect, recorded here because it is the shape story 1.5d shipped twice: *"changes when a
parameter type is widened"* set the first property's type to `'string'`, and the first property was
already a string — so the "changed" entry was byte-identical and the assertion passed for a reason
unrelated to the digest. Rewritten to flip the type to the other one, with an assertion that the
flip actually changed something.

**Task 3 red** surfaced a real bug in the helper extracted for it: `declaredMembers(source,
'QueryLog')` matched `interface QueryLogEntry` first, because `indexOf` does not know where an
identifier ends. Both port assertions failed by reading a neighbouring interface's body. Fixed with a
negative lookahead. A port test that silently checks the wrong type reports the port as whatever that
type happens to be.

**Task 4 red** was two schema mistakes of mine (`document` has `content_type`, not `media_type`) and
one genuine test defect: `lastPaidOn` was asserted against `new Date('2026-07-11T00:00:00.000Z')`,
which passes only in UTC. `pg` parses a `date` to **local** midnight, so it failed by five hours here
and would fail by a different amount elsewhere. Replaced with a calendar-date comparison.

**A silent under-run, caught by counting.** One full-suite run reported `90 passed | 18 skipped
(108)` — green, with two files uncollected — after `npm run test:db` and `npm test` were chained in
one shell. Re-run alone it collected `111`, matching the 111 `*.test.{ts,tsx}` files on disk. Story
2.7's sixth learning, met in the wild: read the file count, not the word "passed".

### Review Findings

Three per-task `argus_review` calls (`BMAD_REVIEW_ENGINE` unset → argus/agy, `gemini-3.1-pro-high`).
The first call failed with an `agy` error and succeeded on retry; `agy -p` was probed directly to
confirm the backend was healthy rather than assuming it.

#### Task 1 — seven findings, two of them serious

- **`update query_log set …` and `delete from query_log` with no `WHERE`** — *confirmed, fixed.* Both
  tests exist for the day the revoke is missing, and on that day they would have rewritten or wiped a
  real association's audit trail before reporting the problem. Now scoped by `RUN_PREFIX`. Postgres
  checks the privilege before matching rows, so the assertion is unchanged. Verified by re-running
  the mutation: the scoped tests still fail when the grant is restored, and the UPDATE touched only
  this run's rows while doing it.
- **`truncate query_log`** — *confirmed, resolved differently.* TRUNCATE takes no `WHERE`, so there
  is no scoped version. Replaced with an exact-set assertion over `information_schema` privileges,
  which proves the same thing without the loaded gun.
- **`__dirname` in an ESM package "will throw a ReferenceError"** — *not reproduced.* The file
  collected and ran 27 tests; Vitest provides it, and six sibling migration test files do the same.
  Held for family consistency: the repo-wide choice between `__dirname` and `import.meta` is already
  on the deferred-work ledger as one sweep, and making one file differ from six is what that entry
  asks not to do.
- **Hardcoded `'forged_entry'` escapes cleanup** — *confirmed, fixed.* The run where that assertion
  fails is the run that leaves an unfindable row.
- **`information_schema` queries unfiltered by `table_schema`** — *confirmed, fixed.*
- **`LIKE` wildcard injection via `RUN_PREFIX`** — *confirmed latent, not fixed.* The prefix is hex,
  so it contains no `_` or `%` today, and the idiom is the one every sibling test file uses. Changing
  it here alone would diverge from all of them.

#### Task 2 — four findings, and its two `[high]`s rested on a false premise

- **"Non-null assertions cause the build failure"** (two findings) — *not reproduced.* `npm run lint`
  exits 0 with one pre-existing warning in `tsconfig-coverage.test.ts`; `no-non-null-assertion` is
  not enabled, and `adapters/db/*.test.ts` alone carries 33 existing `rows[0]!`. The suggested fix
  would have broken `noUncheckedIndexedAccess`, which is on. Argus's `lint: rc=-1` was its own
  verifier failing to run, not this project's lint.
- **Unnecessary `as never` cast** — *confirmed, fixed.* The parameter is `unknown`; the cast said
  nothing.
- **`expect.unreachable()` inside its own `catch`** — *confirmed, fixed.* Its AssertionError was
  caught by the block asserting the error type, which reports the wrong problem. The error is now
  captured outside the assertions.

#### Tasks 3 and 4 — three findings

- **`delete from query_log where entry_id = 'dues_status'` in cleanup** — *confirmed, fixed.* Scoped
  to this run's `actor_id`. Unscoped it would delete every provenance row that entry has ever
  produced, including a concurrent run's and, on a database with real history, the audit trail
  itself. The same defect shape as Task 1's, written again after it had already been found once.
- **`undefined` bound for an omitted optional parameter** — *confirmed latent, fixed with a test.*
  `pg` throws on `undefined` rather than treating it as SQL NULL. No entry declares an optional bound
  parameter today, so `dues_status@1`'s own tests could never reach it. Rather than adding an
  untested guard, the binding was extracted to `catalog/bind-values.ts` — pure, so it can be tested
  against entry shapes the catalog does not hold yet — and given eight tests including `''`, `0` and
  `false` binding as themselves (`??`, not `||`).
- **The adapter should validate `parameters` shape rather than rely on the check constraint** —
  *disagree.* It is validated once at the edge by `validateParameters`, and the constraint is defence
  in depth. A third check inside the adapter is the redundant interior validation the TDD workflow's
  hardening order explicitly warns against.


#### The whole-story Argus pass and the one local CodeRabbit round

Run on `c37cfec` — `argus_review` over `main...HEAD` first, then one
`coderabbit review --base main --committed --agent` round, whose stream reported
`status: "review_completed"` with **26 reviewedFiles**. Reconciled against
`git diff --name-only main...HEAD`: 26 paths, all 26 reviewed, nothing extra —
confirming the CLI ignores `.coderabbit.yaml`'s `path_filters`, since two of them
are `_bmad-output/` files the merge request will not see. Ingested with the
commit SHA before any fix: 1 review compared, 3 missed, 3 lessons written.

Thirteen findings. Ten applied, three declined.

- **`bindValues` read properties plainly while `validateParameters` used
  `Object.hasOwn`** — *confirmed, fixed, with a test.* The two disagree exactly
  on a **declared but optional** parameter: validation skips the type check when
  the value is not an own property, so an inherited one is never checked, and the
  plain read would then bind that unchecked value into the query. The prototype
  hole the validator closes, reopened one function later. No entry declares an
  optional parameter today, so nothing could have hit it — which is why it is
  closed now rather than after the first one does.
- **`declared-members.ts` stripped `//` with a global regex before its
  string-aware brace scan** — *confirmed, fixed.* A member holding
  `'https://example.com'` lost its closing quote, and the scanner then read the
  rest of the file as one string, returning `[]` from an interface that declares
  something. `migrations/executable-sql.ts` is this project's SQL-side fix for
  the identical mistake. Comments and braces are now one pass, and the helper has
  its own test file covering every way it has actually been wrong.
- **`declared-members.ts` returned `[]` on a parse failure** — *confirmed, fixed.*
  A missing or misspelled interface returned the same value as an empty one, so
  `toEqual([])` — the assertion these port tests exist to make — passed for a
  typo. It throws now, and the port test that relied on the old behaviour was
  rewritten.
- **`docs/as-built.md` contradicted itself** — *confirmed, fixed.* Three rows
  were added saying the catalog is enforced by tests while the "What is not
  built" table still called the catalogue not built. Telling a reader which half
  exists is that document's stated purpose.
- **`extract(year from paid_on)` is not sargable** — *confirmed, fixed.* Replaced
  with a half-open range on `paid_on`. Same rows; only one form can ever use an
  index, on the table that grows fastest and from the path a board member waits
  on. Re-pinning the digest was legitimate **because this version has never run
  in production** — AD-14 freezes a version once it has, and the fix after that
  is `dues_status@2` rather than an edit.
- **`registry.test.ts` asserted `bind ⊆ properties` but not the reverse** —
  *confirmed, fixed.* A parameter declared and never bound validates fine,
  reaches no placeholder and is silently discarded, so a caller gets an answer
  computed without the value they supplied.
- **Migration 020's `entry_id` comment described a `btrim` measurement the
  constraint does not use** — *confirmed, fixed.* The pattern admits no
  whitespace at any position, so the padding argument the other migrations make
  does not apply here. A comment describing a different constraint than the one
  present is worse than none.
- **`published-versions.test.ts` reused `ALL_ENTRIES[0]` without requiring two
  properties** — *confirmed, fixed.* On a one-property entry the property-order
  assertion is a no-op and passes against a digest with no ordering behaviour.
- **`table_privileges` query not `distinct` while the column one was** —
  *confirmed, fixed.*
- **The `CatalogExecutor` assertions lived in `query-log.test.ts`** — *confirmed,
  fixed.* Moved to `core/ports/catalog-executor.test.ts`.

Declined:

- **`__dirname` "will throw a ReferenceError and crash the test"** — *not
  reproduced, and raised three times.* The file collects and runs 27 tests;
  `npm run test:db` is green at 622 including them. Vitest provides it, and six
  sibling `migrations/*.test.ts` files do the same. The repo-wide choice between
  `__dirname` and `import.meta.url` is already on the deferred-work ledger as one
  sweep, and its wording is explicit that per-file changes are what it is asking
  not to do.
- **The query-log adapter should validate the `parameters` shape itself** —
  *disagree.* Validated once at the edge by `validateParameters` and once by the
  check constraint. A third check inside the adapter is exactly the redundant
  interior validation the TDD workflow's hardening order warns against.
- **Export `closePool` from the two new adapters and call it in `afterAll`** —
  *declined, ledgered.* There are now nine module-scoped pools with this shape
  and one open action item asking for a single sweep across all of them; adding
  disposal to two would leave seven divergent. The ledger entry was updated to
  name the two new ones. The suite does not hang — the pools idle out.

Argus was then re-run on the fix commit. Its single finding was `__dirname`
again, at `[high]`, and it is answered above.

#### Integration pass over `4739f79..HEAD`

The whole-story look, which per-task reviews structurally cannot be. `argus_review` covered the
accumulated range at `c37cfec` and again over the fix commit; recorded above. What follows is the
acceptance audit against the eight criteria, verified against the files rather than against the
tests' names.

| AC | Verified by | Result |
| --- | --- | --- |
| 1 — frozen, versioned, typed entry | `catalog/registry.ts`, `entry.ts`; sweep in `registry.test.ts` | holds |
| 2 — parameters validated before anything executes | executor order; tests assert **no** log call and **no** query for each rejection | holds |
| 3 — provenance before the query | the query-runner seam; `state.calls` asserted as `['record','query']`, and `['record']` alone when the log throws | holds |
| 4 — append-only by grant | migration 020's revokes; statement tests plus exact privilege sets, table and column | holds |
| 5 — a published version cannot be edited | `published-versions.json`; mutation fired the "mint a new version" message | holds |
| 6 — reader role, bound parameters, no SQL in | `readReaderDatabaseUrl` in the executor, `readWriterDatabaseUrl` only in the log adapter; `CatalogExecutionRequest` has no `sql` member and a test asserts the absence | holds |
| 7 — every number the answer needs, derived included | all seven fields asserted end to end; the balance mutated `-` to `+` and two assertions fired | holds |
| 8 — money as a decimal string | `typeof` asserted per amount; a sweep for `parseFloat`, `Number(`, `::float8` across the whole path returns only the comment warning against them | holds |

Three things only a whole-diff read surfaces, each checked:

- **`core/` does not import `catalog/`.** The dependency direction the architecture draws is intact
  and `core/ports/boundary.test.ts` stays green at 47 tests.
- **The two statements of the catalog-id shape agree.** `^[a-z][a-z0-9_]*$` in migration 020's check
  constraint and in `registry.test.ts`'s sweep. An entry the catalog accepted and the log rejected
  would fail at the moment of logging — which is to say on the query path, in production.
- **Nothing in production calls the executor**, which in epic 2 was the defect that produced three
  extra stories. Here it is the declared scope boundary: story 3.2 is the caller, and unlike those
  epic-2 stories the path is not merely unit-tested — `catalog-execution.test.ts` runs it whole
  against the real database, under both roles, and reads the provenance row back.

#### Merge request !35, round 1 — eight findings

Reviewed `4739f79..37b9df7`. Seven applied, one declined. Two more came from the Argus pass over
this round's own fix diff, and both were applied.

- **I stated a false fact about `pg`, in two files.** `bind-values.ts` and its test both said `pg`
  throws on an `undefined` parameter rather than treating it as SQL NULL. It does not. Checked
  against 8.22.0 rather than argued — binding both values and reading back `is null` returns true
  for each. The coalesce stays, but its reason is now the honest one: it is this function's
  contract, so a fake, a logger or a future driver does not have to rediscover what an absent
  optional parameter meant. A comment giving a false reason is worse than none, because the next
  reader simplifies against it.
- **The declaration lookup was still searching raw text** — *the best finding of the round.* The
  previous round made the *body* scan comment-and-string aware and left the search that positions it
  naive, so a commented-out `interface Foo {` before the real one could aim the scan at a fake body.
  Both now read one masked copy, built in a single pass and held offset-aligned with the source.
  **And the three cases the reviewer asked for would not have caught it**: mutating `masked.search`
  back to `text.search` left all three commented-out cases green, because the following brace lookup
  reads the mask and recovers the real body by accident. It only breaks when an unrelated brace sits
  between the fake and the real declaration — `type Other = { a: string }` — and the scan locks onto
  that instead. That case is now the test.
- **The duplicate-registration guard had no test that failed when it was removed** — *confirmed,
  fixed.* The sweep asserted that `ALL_ENTRIES` currently holds no duplicate, which is a statement
  about the catalog's contents rather than about the rule. `indexEntries` is exported now and tested
  against a catalog that breaks it, plus a case proving two *versions* of one entry are still
  accepted. Verified by mutation: removing the throw fails the new test and leaves the old sweep
  green.
- **Three assertions named no failure** — *confirmed, fixed.* A bare `toThrow(Error)` satisfied by
  anything, a bare `toThrow()` across three parameter cases, and `/assessmentYear/` which matches
  "is required" as readily as "must be an integer", so a validator reporting an explicit `null` as
  an absence passed a test whose name says it does not. This is a lesson the story file already
  recorded and the implementation then violated.
- **The "cannot forge the timestamp" test could not support its name** — *confirmed, fixed.* It
  inserts without `executed_at`, so it passed whether or not the column was caller-settable, and had
  no upper bound. The database can only promise the *default*; forgery is prevented a layer up, and
  that layer is now asserted too — `QueryLogEntry` declares neither field, and the adapter's INSERT
  names neither column.
- **`docs/as-built.md` still carried a stale baseline** — *confirmed, fixed.*
- **A signed, externally immutable anchor for `published-versions.json`** — *declined, ledgered.* A
  fair observation about how strong the AD-14 freeze really is, but the mechanism proposed is
  "consumed by CI" and this project has no CI — removed 2026-08-07 for cost, per AD-2's amendment.
  Externalising the anchor changes what AD-14 guarantees, which makes it a new AD rather than a
  story fix. `catalog/digest.ts` already states the limitation in the same terms. Added to the
  deferred-work ledger against the open CI item so the two are revisited together.

From Argus on the fix diff: the regex-literal limitation of the masking pass is now documented as an
explicit non-goal, and the adapter-source regex was loosened to tolerate a schema prefix and quoting
so reformatting cannot turn it into a test that silently matches nothing.

#### Round 2 — one finding, and it was a true one

Reviewed `37b9df7..36b3c84`, posted as an outside-diff comment.

`docs/as-built.md` claimed *"nothing selects an entry"*. `entryFor(id, version)` resolves one, so
resolution exists; what does not is anything deciding **which** entry answers a question — no intent
routing, no model selection, both story 3.4's. Fixed. It matters because that page's entire stated
purpose is telling a reader which half of the planning artifacts exists, and it is the second
self-contradiction it grew in this story.

#### Round 3 — clean

The round-2 fix was a single line of prose, and no automatic review followed it. That is the state
`bmad-ship-story` §8e warns is indistinguishable from a clean review from the outside, so it was not
read as one: a review was requested explicitly. The first request came back **"Review rate
limited"**; after the prescribed back-off the second returned **"✅ Action performed — Review
finished"**, with no new findings, no new threads, and all eight inline threads resolved by
CodeRabbit — including the one that was declined, which it acknowledged.

**A judgement recorded rather than glossed.** §8c's letter asks for a review of the current head in
one of four shapes, and what arrived was a completion statement instead. It is treated as
convergence because it is *affirmative evidence that a review ran* — the failure that clause exists
to prevent is concluding "clean" from silence, and this is the opposite of silence. Nothing was
pushed during the back-off, so the two substantive rounds remain valid for the commits they cover.

### Completion Notes List

**What was built.** Migration 020 (`query_log`, append-only by grant), a pure `catalog/` holding
`dues_status@1` with its typed schema and an AD-14 digest freeze, two write-only/read-only ports, two
Postgres adapters under the two roles, and the executor that ties them together in the one order
AD-12 permits.

**AD-12 is structural here, not customary.** The provenance row is written *before* the SELECT, so
there is no path from "caller asks" to "caller receives rows" that skips the log. That ordering is
the one property no database test can demonstrate — if the write fails, logging first and logging
last are indistinguishable from outside — which is why the query runner is a seam and
`catalog-executor-postgres.test.ts` watches it.

**Two costs of that ordering, stated rather than discovered.** The log write and the query are on two
connections under two roles and cannot share a transaction, so a row states what was executed, not
that rows came back. And there is deliberately no `succeeded` column: recording an outcome needs an
UPDATE, which migration 020 revokes.

**Sensitivity checks run (four, each restored and re-verified green):**

1. Migration 020 written without its revokes → 5 failures, including `watchdog_writer` really
   updating and deleting rows. This is also the evidence that the *scoped* rewrites of those tests
   kept their detecting power.
2. `Object.hasOwn(supplied, name)` → `name in supplied` → the prototype-inheritance test failed.
3. `annual_amount - coalesce(…)` → `+` → two `dues_status` assertions failed **and** the AD-14 freeze
   fired with its "mint a new version" message. One mutation, both properties.
4. `parameters[name] ?? null` → `parameters[name]` → the omitted-optional test failed.

**Sibling defects found, and what happened to each:**

- `migrations/roles.test.ts` carries the same unbounded `update board_member set …` and
  `delete from board_member` shape that was fixed in this story's new tests. Pre-existing and not in
  this story's scope — **recorded as deferred work.**
- The `declaredMembers` helper is duplicated across five `core/ports/*.test.ts` files. A shared
  `core/ports/declared-members.ts` now exists and the new port test uses it; migrating the five is a
  sweep across well-reviewed files and is **recorded as deferred work** rather than done here. The
  prefix-matching bug fixed in the shared copy exists in all five.

**Out of scope, deliberately, and why:** no `/tools/*` route (3.2 — a route without its
authentication is the unauthenticated data path AD-15 forbids); no arrears or instalment comparison
(would restate `core/assessment/schedule.ts` in SQL with nothing failing on disagreement); no holder
lookup; no reader for the log (3.8). `dues_status@1` attributes a payment to the year its `paid_on`
falls in — a stated limitation of version 1, fixed one day by `dues_status@2` and never by an edit.

**Documentation kept honest by its own tests.** `docs/readme.test.ts` failed on both the migration
count and the missing `catalog/` entry; README updated. Three rows added to `docs/as-built.md`'s
invariant table.

**Gate on this head** — `npm run lint` 0 errors / 1 pre-existing warning; `npm run build` succeeded;
`npm test` **95 passed | 18 skipped (113 files), 1766 passed | 483 skipped**, file count matching the
113 test files on disk; `npm run test:db` **38 files, 623 passed**; `npx --no-install tsc --noEmit`
**8 errors, exactly the baseline**. No Python in this story, so no pytest and no gate change — that
remains story 3.3's obligation.

### File List

**Added**

- `migrations/020_query_log.sql`
- `migrations/query-log.test.ts`
- `catalog/entry.ts`
- `catalog/registry.ts`
- `catalog/registry.test.ts`
- `catalog/validate-parameters.ts`
- `catalog/validate-parameters.test.ts`
- `catalog/bind-values.ts`
- `catalog/bind-values.test.ts`
- `catalog/registry.test.ts` (duplicate-guard regression)
- `catalog/digest.ts`
- `catalog/published-versions.json`
- `catalog/published-versions.test.ts`
- `catalog/entries/dues-status-v1.ts`
- `core/ports/query-log.ts`
- `core/ports/query-log.test.ts`
- `core/ports/catalog-executor.ts`
- `core/ports/declared-members.ts`
- `core/ports/declared-members.test.ts`
- `core/ports/catalog-executor.test.ts`
- `adapters/db/query-log-postgres.ts`
- `adapters/db/catalog-executor-postgres.ts`
- `adapters/db/catalog-executor-postgres.test.ts`
- `adapters/db/catalog-execution.test.ts`

**Modified**

- `tsconfig.json` — `catalog/**/*.ts` added to `include`; without it the whole directory was
  type-checked by nothing, which `tsconfig-coverage.test.ts` caught.
- `README.md` — migration count, and `catalog/` in the Layout block.
- `docs/as-built.md` — three invariants added to the enforced-by-tests table.
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

| Date | Change |
| --- | --- |
| 2026-08-09 | Story created |
| 2026-08-09 | Tasks 1-4 implemented test-first; three per-task Argus reviews; gate green |
| 2026-08-09 | Local round: whole-story Argus + one CodeRabbit CLI review, 13 findings, 10 applied |
| 2026-08-09 | Integration pass and acceptance audit; merge request !35 opened |
| 2026-08-09 | MR round 1: 8 findings, 7 applied, 1 declined and ledgered; all threads resolved |
| 2026-08-09 | MR round 2: 1 outside-diff finding, applied |
| 2026-08-09 | MR round 3 clean after a rate-limit back-off; status done, ready to merge |
