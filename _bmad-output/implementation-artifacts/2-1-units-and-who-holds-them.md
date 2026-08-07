---
baseline_commit: 2cb23009af497cabf09f772d8a4f7db3794264ec
merge_request: 21
---

# Story 2.1: Units and who holds them

Status: review

> **First of four stories in epic 2, the dues ledger.**
> Nothing in the schema knows what a unit is. This story adds that, plus who held it and when —
> the durable identity every later dues story attaches to.
> **2.2** adds the annual amount and cycle, **2.3** derives the instalment schedule, **2.4** turns
> deposits into payments.

## Story

As a treasurer,
I want the association's units recorded, with who held each one and when,
So that a payment or an arrears finding can be attributed to the right person even after a unit
changes hands.

## Acceptance Criteria

**AC1 — the unit number is the identity**

**Given** the association's units
**When** they are recorded
**Then** each is identified by its unit number, which is the durable identity dues attach to

**AC2 — a change of hands closes the previous membership**

**Given** a unit that changes hands mid-year
**When** the new member is recorded
**Then** the previous membership is closed with an end date rather than overwritten
**And** the unit's history states who held it for any date in the past

**AC3 — the database rejects overlaps, not the application**

**Given** a query about who held a unit on a given date
**When** it is answered
**Then** exactly one membership is returned, or none — overlapping memberships for one unit are
rejected by the database, not by application code

**AC4 — a member is not a board member**

**Given** a person who holds a unit
**When** they are recorded
**Then** they are a distinct population from `board_member`, which is an authentication table
**And** recording a unit holder never requires them to have a sign-in

## Tasks / Subtasks

- [x] **Task 1 — Migration 011: the unit** (AC1)
  - [x] `migrations/011_unit.sql`. `unit_number` is the identity a treasurer uses; the row also has a
        uuid primary key because every other table here does and foreign keys are cleaner for it.
  - [x] **Unique on the unit number**, normalised the way 009 normalises vendor names if the numbers
        turn out to vary in spelling (`4B` vs `4b` vs `04B`). Decide this explicitly in the migration
        comment — a unit number is typed by a human off a roll, and "4B" twice is one unit.
  - [x] `grant select on unit to watchdog_reader` — the catalog will read it. Explicit per-table, as
        migration 003 requires.
  - [x] Migration-text test: strip comment lines before matching, and include a positive control.
        Stories 1.6a *and* 1.6c both shipped a test that matched the migration's own prose.
- [x] **Task 2 — Migration 012: the holder, and the dated membership** (AC2, AC3, AC4)
  - [x] A person who holds a unit is **not** a `board_member`. That table is authentication — email,
        password hash, `disabled_at`. A unit holder may never sign in. Model them separately and say
        why in the migration.
  - [x] Membership carries a **`daterange`**, not a pair of nullable dates. Half-open (`[)`) so
        "sold on 1 July" is one membership ending and the next beginning on the same day with no
        overlap and no gap.
  - [x] **`create extension if not exists btree_gist`** — required for `EXCLUDE USING gist` with a
        `uuid` equality operator. It must be created by the **migration runner**, not the writer;
        `watchdog_writer` gets `42501 permission denied to create extension`. Verified.
  - [x] The constraint: `exclude using gist (unit_id with =, held_during with &&)`. Verified working —
        an overlapping insert raises **`23P01`**, and adjacent half-open ranges are accepted.
  - [x] `grant select on` both tables to `watchdog_reader`.
- [x] **Task 3 — The port and its read** (AC2, AC3)
  - [x] `core/ports/unit-directory.ts` — a read port. Two questions this story can answer: who held a
        unit on a date, and the full history for a unit.
  - [x] **Read-only, like 1.6c's queue port.** Recording units and memberships is data entry, and no
        story before 2.4 needs to write them from the application; a write port with no caller is a
        capability waiting to be misused. Say so in the header, as `quarantine-queue.ts` does.
  - [x] `adapters/db/unit-directory-postgres.ts` on the **reader** connection — this only reads, and
        1.6c established the pattern with `readReaderDatabaseUrl()`.
- [x] **Task 4 — Prove the constraint from the outside** (AC3)
  - [x] Database tests that insert a real overlap and assert `23P01`, and that adjacent ranges are
        accepted. Constrain the error — a bare `rejects.toThrow()` passes for any rejection, which
        MR !20 caught in this very shape.
  - [x] **Use savepoints for expected failures.** A rejected statement aborts the transaction, so a
        query issued afterwards fails with `25P02` — "current transaction is aborted" — and the test
        then reports the wrong cause. Verified while writing this story: `savepoint` +
        `rollback to savepoint` leaves the transaction usable.
  - [x] Point-in-time reads return exactly one row inside a membership and zero outside it. Assert
        both; the second is what stops a query that always matches.
  - [x] Per-test scoping in `beforeEach`, not per file. `quarantine-queue-postgres.test.ts` scoped
        per run first and its tests stopped being independent.

## Dev Notes

### The decision that shapes this story

**The unit is durable; the member is not.** Dues attach to a unit number, and the person tied to it
changes. That is why membership is a *dated relationship* and not a column on the unit — and it
cannot be retrofitted. A `current_owner_id` column answers "who owns 4B" and can never answer "who
owned 4B in March", which is precisely the question an arrears finding has to answer.

Recorded in `epics.md` under *Domain detail: how dues actually work*: an arrears flag must name
whoever held the unit **in that period**, not whoever holds it now. Naming the wrong person is an
error a fiduciary tool cannot make.

### Verified while writing this story

Run against the live database in rolled-back transactions, so none of this is inference:

- **`btree_gist` is available (1.8) and not installed.** `pg_trgm` 1.6 is installed. Postgres 18.4.
- **The writer cannot create the extension** — `42501 permission denied to create extension`. The
  migration runner (`DATABASE_URL`) can. This matches migration 002: "Neither role may create
  objects; the schema is owned by the migration runner."
- **`exclude using gist (unit_id with =, held_during with &&)` works.** An overlapping insert raises
  `23P01`; the constraint is named `<table>_unit_id_held_during_excl` by default.
- **Half-open ranges do not falsely overlap.** `daterange('2026-01-01','2026-07-01')` and
  `daterange('2026-07-01', null)` coexist — a sale on 1 July needs no gap and no overlap.
- **`held @> date` returns exactly one row inside a membership and zero outside.** Tested at
  2026-03-15, 2026-08-20 and 2025-12-31.
- **A constraint violation aborts the transaction** (`25P02` on the next statement). Savepoints are
  the fix, and were verified to leave the transaction usable.

### What epic 1 hands over

- **Migration conventions**: `uuid primary key default uuidv7()`, `timestamptz not null default now()`,
  two-part length checks (009's `char_length(x) <= n` *and* `char_length(btrim(x, ...)) >= 1`, because
  `btrim` before counting lets `'x'` plus 300 spaces through), explicit `grant select … to
  watchdog_reader` per table since migration 003 revoked the default.
- **`alter default privileges`** in migration 002 already grants the writer INSERT/UPDATE/DELETE on
  tables created later. No grant needed for the writer; verified during story 1.6d.
- **Money is integer minor units** — not this story's concern, but 2.2's. Do not add an amount here.
- **Dates**: ISO-8601 `date` for accounting periods, `timestamptz` for events. A membership range is
  dates. The architecture's Consistency Conventions fix this.

### Learnings that apply directly

- **Constrain every expected rejection.** MR !20 found a bare `rejects.toThrow()` that passed for any
  rejection at all while the assertions beside it still held.
- **Allow-lists, not deny-lists.** A list of forbidden things passes everything nobody listed.
- **Check what a test proves when the thing it guards is absent.** The recurring defect of this
  project: `silently` appears in all twelve epic-1 story files.
- **`tsc --noEmit` sees what `npm run build` does not** — baseline is 8. Three epic-1 stories added
  type errors that lint and build both passed.
- **There is no CI.** The local gate is the only gate; `npm run test:db` runs nowhere unless run.

### Project Structure Notes

- `core/` imports nothing outward (`core/ports/boundary.test.ts`).
- Adapters: `adapters/db/`, one pool per adapter, error listener on the pool, `max: 5`.
- No surface in this story. Units arrive by data entry or by 2.4's upload path; neither is here.

### Testing standards

- **"Tested" = `npm run lint` + `npm run build` + `npm test`**, plus `npm run test:db` for this
  story's migrations and adapter, plus `npx --no-install tsc --noEmit` against its baseline of 8.
- Database tests take a fresh scope per test in `beforeEach`.
- Every new test faces the sensitivity check: break the code it covers, confirm it fails, restore.

### References

- [Source: epics.md#Story-2.1] — the three ACs this story owns
- [Source: epics.md#Domain-detail-how-dues-actually-work] — why membership is dated, and why an
  arrears flag must name the holder at the time
- [Source: ARCHITECTURE-SPINE.md] — the ERD's `UNIT ||--o{ ASSESSMENT : owes` and
  `UNIT ||--o{ PAYMENT : makes`; Consistency Conventions for ids, dates and money
- [Source: migrations/002_roles.sql] — `alter default privileges`, and that only the migration runner
  creates objects
- [Source: migrations/009_vendor.sql] — the two-part length check and the normalisation pattern
- [Source: core/ports/quarantine-queue.ts] — the read-only port header this story's port should echo

## Dev Agent Record

### Agent Model Used

### Test Design

## Task 1 - migration 011, the unit

One behaviour, and it is a schema rather than a function: the `unit` table exists with the right
shape and the right grants. Two instruments, as epic 1 settled: the **database tests** prove the
constraints by violating them, and a **migration-text test** proves the statements say what the
prose claims — with comments stripped, because stories 1.6a and 1.6c both shipped a test that
matched the migration's own explanation instead of its SQL.

### Behaviour A - the `unit` table and its identity (AC1)

1. **Correct-run signal:** a unit inserts with a unit number; a second unit with the same number
   -- in any spelling that means the same unit -- is rejected by the database.
2. **How to test it:** against the real database, scoped per test, asserting the SQLSTATE rather
   than merely that something threw.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| A1 | `4B` and `4b` insert as two units, so a treasurer's roll silently describes two properties where one exists -- and every dues figure attached to one of them is invisible from the other | GUARD - unique on a normalised form, not on the raw string |
| A2 | A unit number of `''` or `'   '` is stored, so a row exists that names nothing and joins to everything a human might search for | GUARD - the two-part length check 009 arrived at: `char_length(x) <= n` **and** `char_length(btrim(x, ...)) >= 1`. Measuring after `btrim` alone lets `'x'` plus 300 spaces through |
| A3 | The number is unbounded, so a pasted spreadsheet cell becomes a unit number of several kilobytes | GUARD - a length cap |
| A4 | `watchdog_reader` cannot read the table, so epic 3's catalog cannot answer a single question about units, and the failure appears one epic later as a permission error | GUARD - explicit `grant select`, since migration 003 revoked the default |
| A5 | `watchdog_reader` can **write** it, which would let the LLM-driven query path invent units | GUARD - assert no write privilege, as `quarantine-item.test.ts` does for its own table |
| A6 | The migration-text test matches the migration's prose rather than its SQL | GUARD - strip comment lines, and carry a positive control proving the stripper did not eat the statements |
| A7 | A unit number that differs only by leading zeroes (`04B` vs `4B`) is treated as two units | OUT-OF-SCOPE - recorded. Zero-padding is a real convention in some associations and dropping it is a data decision, not a schema one. The normalisation chosen here folds case and whitespace only; if a roll turns up with padded numbers, that is a decision for whoever loads it |

**Cross-check (required):** the unique constraint is verified twice by independent means -- once by
inserting a colliding spelling and asserting `23505`, and once by querying
`information_schema`/`pg_indexes` for the index itself. A constraint that exists but is never
violated in a test, and a violation that happens for some other reason, are different failures and
only one assertion each would catch them.


## Task 2 - migration 012, the holder and the dated membership

Two behaviours. The holder is an ordinary table; the membership is the one the story exists for,
because AC3 says overlaps are rejected **by the database, not by application code** -- so the test
that matters inserts a real overlap and reads the SQLSTATE back.

**Probed against the live database before designing the constraints** (`c:/tmp/probe.sql`, run
2026-08-07):

| Probe | Result | What it decides |
| --- | --- | --- |
| `daterange('2024-01-01','2024-06-30','[]')` | `[2024-01-01,2024-07-01)` | Postgres **canonicalises `daterange` to `[)` itself** -- it is a discrete type |
| `upper_inc` of that value | `false` | so is `lower_inc` `true` |
| `upper_inc(daterange(d, null))` | `false` | an open-ended membership is already half-open |
| `lower_inc(daterange(null, d))` | `false` | an unbounded **lower** is the one case `lower_inc` catches |
| `isempty(daterange(d, d))` | `true` | same-day start and end is an empty range, not a one-day one |
| `[2024-01-01,2024-07-01) && [2024-07-01,)` | `false` | sold-on-1-July is one membership ending and the next beginning, with no overlap and no gap |
| `[2024-01-01,) && [2024-07-01,)` | `true` | two open-ended memberships for one unit **do** collide |

**A constraint deleted before it was written.** The obvious way to state "half-open" is
`check (lower_inc(held_during) and not upper_inc(held_during))`. Row 1 above shows it can never fail
for any bounded range, because Postgres has already canonicalised the value before the check runs --
it would pass whether or not the thing it guards against were possible, which is precisely the shape
this project keeps shipping. What survives from it is the half that *can* fire:
`lower(held_during) is not null`, rejecting a membership that never began.

### Behaviour B - the `unit_holder` table (AC2)

1. **Correct-run signal:** a person is recorded and reads back with the name they were given.
2. **How to test it:** against the real database, scoped per test.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| B1 | A holder is modelled as a `board_member`, so recording who owns 4B requires giving them an account -- and a holder who never signs in is unrepresentable | GUARD - a separate table, with the reason stated in the migration. `board_member` is authentication: email, password hash, `disabled_at` |
| B2 | A blank or whitespace-only name is stored, so a membership points at a person who is not named | GUARD - the same two-part length check as `unit`, for the same reason |
| B3 | An unbounded name lets a pasted cell become a person | GUARD - a length cap |
| B4 | The name is made **unique**, so the association's second `John Smith` cannot be recorded and the first one silently acquires the second one's unit | GUARD **against** the constraint - assert two holders with the same name both insert. Names are not identities; this is the one place where the obvious constraint is the bug |
| B5 | `watchdog_reader` cannot read it, so epic 3 cannot name whoever held a unit | GUARD - explicit `grant select` |
| B6 | `watchdog_reader` can write it, letting the query path invent a person | GUARD - assert no write privilege |

### Behaviour C - the dated membership and its exclusion (AC2, AC3, AC4)

1. **Correct-run signal:** a unit's memberships cannot overlap, and the database is what refuses
   them -- with no application code in the path.
2. **How to test it:** insert a real overlap and assert `23P01`. **Expected failures need
   savepoints**: a rejected statement aborts the transaction, so the next query fails with `25P02`
   and the test then reports the wrong cause.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| C1 | Two overlapping memberships for one unit are stored, so "who held 4B in March" has two answers and an arrears finding names the wrong person | GUARD - `exclude using gist (unit_id with =, held_during with &&)`, raising `23P01` |
| C2 | The exclusion is **not scoped by unit**, so two different units cannot be held over the same dates -- which is every association | GUARD **against** over-constraining - beside-case: overlapping ranges on *different* units must both insert. Without `unit_id with =` this passes every C1 test and breaks the product |
| C3 | Adjacent half-open ranges are treated as overlapping, so "sold on 1 July" cannot be recorded at all | GUARD - assert the adjacent pair inserts |
| C4 | Two **open-ended** memberships for one unit are stored, so a sale that forgot to close the previous membership leaves two current holders | GUARD - covered by C1's constraint; asserted separately because it is the likeliest real data-entry error and its ranges are unbounded rather than overlapping in the obvious way |
| C5 | An empty range (`[d,d)`) is stored, so a membership exists that covers no date and answers no query | GUARD - `check (not isempty(held_during))` |
| C6 | A membership with no start date is stored, so the unit was held from the beginning of time | GUARD - `check (lower(held_during) is not null)`. The surviving half of the deleted half-open check |
| C7 | A membership references a unit or a holder that does not exist | GUARD - foreign keys, asserting `23503` for each separately. One test covering "a bad reference" would pass with either key missing |
| C8 | `held_during` is null | GUARD - `not null` |
| C9 | `btree_gist` is missing, so `exclude using gist` cannot use `=` on a `uuid` and the migration fails outright | GUARD - `create extension if not exists btree_gist` in the migration. **Verified:** `watchdog_writer` gets `42501 permission denied to create extension`, so it must be the migration runner that creates it |
| C10 | `watchdog_reader` can read neither table, or can write either | GUARD - as B5/B6 |
| C11 | The test asserts `rejects.toThrow()` without constraining the error, so it passes for a missing table, a syntax error or a permission denial | GUARD on the **test** - assert the SQLSTATE. MR !20 caught this exact shape on this project |
| C12 | A holder holds two *different* units over the same dates | OUT-OF-SCOPE - allowed, and deliberately. Owning two units at once is ordinary. The exclusion is per unit, which C2 asserts |
| C13 | A membership's range is edited later so it overlaps a sibling | OUT-OF-SCOPE for the schema - the exclusion constraint covers `update` as well as `insert` by construction, but no story before 2.4 writes memberships from the application, so there is no update path to test |

**Cross-check (required):** the exclusion is verified twice by independent means -- once by
inserting a real overlap and asserting `23P01`, and once by reading the constraint back out of
`pg_constraint` and asserting it is an `EXCLUDE` naming both `unit_id` and `held_during`. Task 1
found two guards that matched an index's *name* rather than its column, so the second assertion must
match the constraint's **definition**, not the string `held_during` appearing somewhere in it.


## Task 3 - the port and its read

Two behaviours: the port's shape, and the adapter that answers it. The port is **read-only**, for
the reason `core/ports/quarantine-queue.ts` gives about itself -- a capability with no caller is a
capability waiting to be misused, and nothing before story 2.4 writes units or memberships from the
application.

### Behaviour D - the `UnitDirectory` port (AC2, AC3)

1. **Correct-run signal:** a caller can ask who held a unit on a date, and for a unit's whole
   history, and can express nothing else.
2. **How to test it:** the port is types plus prose, so it is tested the way 1.6c tested its own --
   by asserting on the declaration's text, with a control proving the instrument works.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| D1 | The port declares a write -- record a unit, close a membership -- with no caller, so a capability nobody needs exists to be reached for | GUARD - read-only, with the reason in the header. Asserted against the declared method names, not against the string `insert` appearing somewhere |
| D2 | Dates cross the boundary as `Date`, so a membership beginning 2024-07-01 reads back as 2024-06-30 for anyone west of UTC. `pg` converts `date` to a JS `Date` at local midnight by default | GUARD - the SQL returns text and the port's type is a `YYYY-MM-DD` string. A calendar date is not an instant |
| D3 | "Still holds it" is expressed as a far-future date rather than an absence | GUARD - `heldUntil: string \| null`, null meaning still held, matching the unbounded upper bound the schema uses |

### Behaviour E - the Postgres adapter (AC2, AC3)

1. **Correct-run signal:** against the real database, the right holder comes back for a date, and
   the whole history comes back in order.
2. **How to test it:** database tests for the answers, plus the two things no behavioural test can
   catch -- which role it connects as, and what the query text asks for. `quarantine-queue-connection.test.ts`
   established both.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| E1 | A unit number typed in another spelling finds nothing, so `4b ` off a roll silently has no holder | GUARD - match on `normalised_number` through `unit_normalised_number($1)`, the function migration 011 defines |
| E2 | The query returns the *previous* holder on the day of sale, so 1 July has two answers or the wrong one | GUARD - `held_during @> $2::date`, with boundary tests on 30 June, 1 July and 2 July |
| E3 | An open-ended membership stops answering for dates far in the future | GUARD - a query years out returns the current holder |
| E4 | A date before any membership, or a unit with no memberships, throws instead of answering "nobody" | GUARD - `null` and `[]` respectively |
| E5 | The history comes back in whatever order the plan produced, so two renders disagree | GUARD - `order by lower(held_during)`, asserted both behaviourally and in the query text. The queue adapter's own tiebreak note applies: a behavioural test alone caught a missing order in only two runs of three |
| E6 | The adapter builds its pool from the **writer** URL, which satisfies every behavioural test here because `watchdog_writer` can do everything `watchdog_reader` can -- and leaves migration 012's grants unexercised | GUARD - the connection test, mocking `../auth/env` rather than reaching into the adapter |
| E7 | `select *` carries `normalised_number` out to callers, a comparison key no human has a use for | GUARD - source assertion, as the queue adapter has |
| E8 | The pool is built at module load, so `next build` fails on a machine with no database | GUARD - lazy `getPool()`, the shape `../auth/env.ts` records the reason for |
| E9 | The unit number is interpolated into the SQL | GUARD - parameterised, asserted in the query text |
| E10 | Two memberships come back for one date | OUT-OF-SCOPE here - made impossible by the exclusion constraint, which `migrations/unit-membership.test.ts` proves fires. A defensive `throw` for it could not be triggered from a test without dropping the constraint, and a guard that cannot be made to fire is the shape this project keeps deleting. The adapter states the dependency instead |
| E11 | "This unit does not exist" and "nobody held it then" are the same answer (`null`) | OUT-OF-SCOPE - recorded. Nothing in this epic distinguishes them, and an error contract no caller consumes is scope invented here. It belongs with whichever surface first lets a treasurer type a unit number |

**Cross-check (required):** the boundary answer is verified two independent ways -- `holderOn` on
30 June, 1 July and 2 July, and `historyFor` returning both memberships with the day of sale as one
membership's end and the other's start. A single-date probe would pass against an adapter that
returned the first row it found.


### Debug Log References

**Baseline, and an anomaly worth recording.** The first `npm test` of this session reported
**`49 passed | 9 skipped (58)`, 1167 tests**, and exited green. Three consecutive runs immediately afterwards, on an unchanged tree, reported
**`53 passed | 9 skipped (62)`, 1192 tests**. A JSON-reporter run confirmed all 62 files on disk are
collectible, so nothing is missing from the glob.

Four files and 25 tests silently did not run, and the summary still said green. I could not reproduce
it in three attempts and have no explanation. It is recorded rather than dismissed because it is this
project's signature defect — something that passes by not doing its job — occurring in the suite
itself, and because with CI removed this suite is the only gate there is.

**Practical consequence:** read the *file count* in the summary, not only pass/fail. The expected
figure at this baseline is **62 files, 1192 passing, 265 skipped**. A run reporting fewer files is
not a green run.


### Review Findings

## CodeRabbit round 1 (IDE, 2026-08-07) — head `f82c2ad`, base `6f8e403`

7 findings. `argus_ingest` ran before any fix (13 lessons written). Reconciliation: all 11 files in
`main...HEAD` appear in `fileReviewMap`; 3 extra files — `.gitignore`, `.mcp.json` and
`.claude/commands/argus-review.md` — are the extension picking up uncommitted work, which it does
whatever the scope setting says.

**Fixed (5).**

| # | Finding | What was actually true |
| --- | --- | --- |
| 1 | `says why it cannot write` is non-sensitive | **Confirmed and deleted.** `/read/i` matches `readonly`, which every field of `UnitHolding` carries — so that half passed against a port stripped of every word of rationale. Checked against a bare port, not assumed. Not tightened: making it sensitive means matching a specific sentence, which is testing prose — the thing the migration tests strip comments to avoid. The exhaustive method list already protects the API, and it is a property of the code |
| 2 | Pin `search_path` on the normalisation function | **Fixed.** The body calls `lower`, `regexp_replace`, `btrim` and `chr` unqualified, and it decides unit *identity* — it backs a stored generated column and the unique index on it. A shadowed `lower` would change which numbers are the same unit, and rows written before and after would disagree. Two assertions: the migration text, and `pg_proc.proconfig` on the live function |
| 3 | The 750ms budget is the wrong direction for the beside-case | **Fixed, differently.** The finding is right that a timing budget can only produce false failures for the "does not block" assertion. Its proposed fix — drop the bound and await the insert — would leave a blocked case hanging until Vitest's timeout with two transactions still open, so `finally` would never roll them back and every later test would queue behind their locks. Raised to 5s instead: free when passing, still bounded when not |
| 4 | Don't assert `covers_dates` for the empty range | **Confirmed, and stronger than reported.** Every empty daterange has a **null lower bound** — verified for `[d,d)`, `(d,d+1)` and the `empty` literal — so `lower(held_during) is not null` already rejects all of them. Dropping `not isempty(...)` from the live database changed no behaviour and left **all 351 tests passing**. The constraint was deleted, and two tests now stop it returning: one on the migration text, one asserting `pg_constraint` holds exactly one check constraint |
| 5 | `executable` misses trailing and block comments | **Fixed once, shared.** Both files declared their own copy handling only leading `--`. Extracted to `migrations/executable-sql.ts`, now quote-aware: trailing comments, nested `/* */`, `--` inside a string literal, `$$` bodies kept whole. 8 tests of its own, including a positive control |

**Out of scope (2)** — both on files this branch does not own:

| # | Finding | Disposition |
| --- | --- | --- |
| 6 | `.mcp.json` and `.claude/commands/argus-review.md` commit a machine-specific Argus path | Real, and already an open epic-1 action item ("portable Argus paths … must change together"). Both files are **uncommitted work on another branch**; fixing them here would drag them into this MR |
| 7 | `argus-review.md` uses `git diff HEAD`, omitting untracked files | Real, same file, same branch. Recorded alongside the existing `$ARGUMENTS` shell-injection item for that file |

**The lesson worth keeping from #4.** Task 2's mutation testing dropped both check constraints
together and so never showed that either one mattered. A mutation that removes two things at once
cannot tell you which of them is load-bearing. Re-run one at a time, the redundant constraint was
invisible to all 351 tests.

*Sensitivity checks on this round's fixes, each restored:*

| Mutation | Tests that failed |
| --- | --- |
| `set search_path` removed | `pins the search_path on the normalisation function` **and** `carries the pinned search_path on the live function` |
| `not isempty(...)` put back | `does not carry a redundant isempty check` **and** `carries the start-date check itself, by its definition` |
| `lower(...) is not null` deleted | 4 tests — both behavioural cases, the migration-text assertion, and the definition cross-check |

*Gates after the round:* lint 0 errors, `tsc --noEmit` **8** (= baseline), build clean, `npm test`
**68 files / 1230 passed**, `npm run test:db` **19 files / 364 passed**.



## CodeRabbit round 2 (MR !21, 2026-08-07) — head `ff65c97`

4 actionable findings. Three fixed, one skipped with the reason on its thread.

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | The `catch` in `source()` turns a missing file into `''` | **Fixed.** A path that stopped resolving made every assertion fail with "expected `''` to match /select/i", naming the wrong cause. Nothing could make the catch fire in a test, so it was an unproven guard. Removed; `readFileSync` now throws `ENOENT` with the path |
| 2 | Close the adapter pool in `afterAll` | **Skipped**, second time. The stated consequence does not occur — the db suite completes with no teardown stall — and `quarantine-queue-postgres.test.ts` has the identical shape, which CodeRabbit itself notes. Adding a close helper to one of seven adapters would leave it inconsistent and would not address the pool problem, which is an open epic-1 action item covering all seven |
| 3 | `still treats a backslash in a plain literal as ordinary text` passes either way | **Confirmed and fixed — the fourth guard in this story that proved nothing, and it was written *in the round that fixed the third*.** The escape branch copies every character it scans, so `select 3;` appeared in the output under either behaviour. A `--` comment after the literal makes the difference observable: closed literal → real comment, stripped; open literal → swallowed as text, survives |
| 4 | `E'` needs a word boundary before it | **Fixed.** `/^[Ee]'/` matches the `e'` at the end of `else'b'`, ordinary SQL. Scanned as an escape string, a backslash consumes the closing quote and the scanner runs past the literal's end |

*Sensitivity checks, each restored:*

| Mutation | Test that failed |
| --- | --- |
| Word boundary removed | `does not read the e at the end of a keyword as an escape-string prefix` |
| All literals scanned as escape strings | **both** literal tests, including the beside-case that previously could not fail |
| Unicode boundary reverted to ASCII `\w` | `treats a non-ASCII identifier as a word too` |

*Argus on the same round* raised three more. One (`\w` is ASCII-only, so `añe'b'` misparses) was
fixed with a test. One was `.mcp.json`'s hardcoded path — the user's uncommitted file, already an
open action item. The third — the naive `//` stripper in the two `*-connection.test.ts` files, which
is the same class of trap this round fixed for SQL — is **latent**: neither adapter contains a `//`
inside a string literal, checked. Recorded as an epic-2 action item rather than answered with a
second parser.

*Gates:* lint 0 errors, `tsc --noEmit` **8** (= baseline), build clean, `npm test`
**68 files / 1236 passed**, `npm run test:db` **19 files / 369 passed**.


## CodeRabbit round 3 (MR !21) and the Argus pass on it — head `1f06236`

One CodeRabbit finding and three from Argus, all on the same 20-line scanner. Fixed, and then the
scanner was given a written scope so this stops recurring.

| Finding | Disposition |
| --- | --- |
| `sql[i - 1]` is a code *unit*, so an astral character like `𐐀` yields a lone low surrogate, which matches no letter property | **Fixed.** Verified empirically first: the lone surrogate fails `\p{L}`, the whole code point passes. `precedingCodePoint()` now returns the complete character |
| `precedingCodePoint` assumed any low surrogate is preceded by a high one | **Fixed.** It now checks the pairing, so malformed input cannot make it return a letter *plus* a surrogate |
| The dollar-tag regex was ASCII-only | **Fixed.** `$café$` is a legal Postgres tag; the regex uses Unicode property escapes now |
| Anchor the caller regex as a second guard against a multi-character return | **Rejected, after trying it.** The anchor makes the surrogate-pairing check *unobservable* — a two-character string matches neither the anchored nor the unanchored form — so with both in place neither could be made to fail. Kept the one a test can falsify, which is the same reasoning that deleted `not isempty(held_during)` from migration 012 |

**And a fifth guard that proved nothing, caught by its own sensitivity check.** The first version of
`does not mistake a letter before a lone low surrogate for that character` put a *space* before the
surrogate, and passed with the fix reverted. A **letter** is what makes it falsifiable: slicing two
units blindly returns `a` + surrogate, the property test then matches the `a`, and the scanner reads
a plain literal instead of an escape string.

*Sensitivity checks, each restored:*

| Mutation | Test that failed |
| --- | --- |
| Preceding code *unit* instead of code point | `treats an astral identifier character as a word too` |
| High-surrogate pairing check removed | `does not mistake a letter before a lone low surrogate for that character` |
| Dollar tag reverted to ASCII-only | `keeps a tagged dollar-quoted body whole, including a non-ASCII tag` |

**Scope, now written into the file.** None of these are reachable from the real input — checked, not
assumed: no migration uses `E'…'`, a tagged dollar quote, or a non-ASCII identifier, and Node's UTF-8
decoder replaces invalid bytes with U+FFFD so no lone surrogate can arrive from a file. The fixes
are one line each and the helper is shared, so they were worth taking; but the header now says
plainly that this is not a general SQL parser and should not grow into one.

*Gates:* lint 0 errors, `tsc --noEmit` **8** (= baseline), build clean, `npm test`
**68 files / 1239 passed**, `npm run test:db` **19 files / 372 passed**.

## Argus round 2 (the review-gate pass on round 1's own diff)

Three **low** findings, all latent holes in the two parsers round 1 introduced — two of them in the
file created to close exactly this class of hole. All three verified against the code: true, and
none reachable by anything in the repo today. Fixed, on the same argument that justified writing the
shared stripper at all: the hole is worth closing while no assertion depends on it.

| Finding | Fix |
| --- | --- |
| The stripper mishandles double-quoted identifiers | `"…"` handled like `'…'`; a `--` inside a quoted identifier is part of the name |
| The stripper ends an `E'…'` escape string early at `'` | Escape strings handled separately, with a beside-case proving a backslash in a *plain* literal is still ordinary text |
| `declaredMethods` brace matching is not string-aware | String and template literals skipped before counting |

**And the sensitivity check caught my own fix being untestable.** The first version of
`counts braces outside string literals only` used `'{'` and `'}'` on separate methods — and they
*balanced*, so a naive counter still reached the real closing brace at the right depth. The test
passed with the string-awareness removed. Rewritten around a single unmatched `'}'`, it now fails
with `['closing']` instead of `['closing', 'second']`. Two guards that proved nothing in this story
were found this way; this is the third.

## Two pre-existing tests that my new test file pushed over their timeout

Adding `migrations/executable-sql.test.ts` put one more file into Vitest's parallel pool, and two
scrypt tests from epic 1 began timing out at Vitest's 5s default — **reproducibly in the full run,
never in isolation**. Confirmed as `Error: Test timed out in 5000ms`, not an assertion failure.

Both were given a 30s bound. This is the one place in this story where a test I do not own was
edited, so the reasoning is recorded rather than assumed:

- `spends comparable effort on an unknown address as on a wrong password` asserts a **ratio** between
  two code paths, so it is indifferent to how slow the machine is. Verified rather than argued:
  with the 30s bound in place, removing the dummy verification from the absent-user path still fails
  it — `0.03ms` against `22.96ms`.
- `is usable in practice — a real hash and verify completes` asserts two boolean results. Its bound
  was raised and **not** its scrypt parameters; lowering those is the single change that would make
  it stop meaning anything, since "usable at the real parameters" is the whole claim.

Three consecutive full unit runs afterwards: **68 files, 1234 passed**, no flake.

### Completion Notes List

**Task 1 — migration 011, the unit.** Done. `unit` holds the durable identity dues attach to;
`unit_normalised_number()` is deliberately its own function rather than a reuse of
`vendor_normalised_name()`, so a later change to vendor matching cannot silently redefine which
units are the same unit. Leading zeroes are not folded (`04B` != `4B`), recorded as A7 OUT-OF-SCOPE
rather than decided by accident.

*Two guards that proved nothing, both found by the Step 9 sensitivity check and not by reading the
tests.* The text test and the database cross-check each matched `normalised_number` anywhere after
`create unique index`. The index's own name is `unit_normalised_number_key`, so **both stayed green
with the index pointed at the raw `unit_number` column** — they asserted a naming convention while
the constraint they named had stopped working. Both now match the indexed column inside its
parentheses. Separately, the "defines a normalisation of its own" test began as a deny-list
(`not.toMatch(/vendor_normalised_name/i)`) and failed on a `comment on` literal that merely explains
the separation — catching a mention rather than a dependency; replaced with an allow-list on what
the generated column actually calls.

*Sensitivity checks run, each restored afterwards:*

| Mutation | Test that failed |
| --- | --- |
| Unique index moved to the raw `unit_number` column (database) | `treats two spellings of one number as the same unit` **and** `carries the unique index the constraint depends on` |
| Same move in `011_unit.sql` (file) | `makes the normalised number unique` |
| Length check replaced with `char_length(btrim(...)) between 1 and 64` | `refuses a number that is only padding around one character` |

The last of these is migration 006's known-wrong shape: it lets `'x'` plus three hundred spaces
through, because `btrim` removes the padding before anything counts it. After the mutations the
schema was re-derived by dropping `unit`, deleting its `schema_migration` row and re-running
`npm run migrate`, so the database matches the file rather than a hand-written `alter`.

*Gates on `7966ed4`:* lint 0 errors, `tsc --noEmit` **8** (= baseline), build clean,
`npm test` **63 files / 1198 passed**, `npm run test:db` **299 passed**. One `argus_review` on the
task diff returned no findings (confidence 1). The single lint *warning* — an unused `resolve`
import in `tsconfig-coverage.test.ts` — predates `baseline_commit` and is in a file this story does
not touch; left alone rather than smuggled into this diff.

*Anomaly note, against the Debug Log above:* the expected file count is now **63**, not 62 —
`migrations/unit.test.ts` is the new one. Read the file count on every run.

**Task 2 — migration 012, the holder and the dated membership.** Done. `unit_holder` is separate
from `board_member` because that table is authentication and a unit holder may never sign in.
Holder names are deliberately **not** unique — the one place in this migration where the obvious
constraint is the bug, since the association's second John Smith must be recordable.

*A constraint deleted before it was written.* The obvious statement of "half-open" is
`check (lower_inc(held_during) and not upper_inc(held_during))`. Probing the live database first
showed Postgres canonicalises `daterange` to `[)` itself, so that check could never fail for any
bounded range — it would pass whether or not the thing it guards against were possible. What
survives is `lower(held_during) is not null`, the half that can actually fire.

*Two test suites deleting each other's rows — found by two failures that would not reproduce.*
`unit.test.ts` and `unit-membership.test.ts` both cleaned up with `like '%-%'`, which matches any
value containing a dash, including the rows the other file was using at that moment. **Vitest runs
test files in parallel**, and both write to `unit`. Whichever file lost the race saw a count
assertion fail, intermittently, in the suite that is now the only gate this project has.

Proved rather than inferred: inserting `deadbeef-4B` and running the old cleanup statement verbatim
removed it. Both files now carry a per-file random `RUN_PREFIX` and delete only rows carrying it —
the convention `quarantine-item.test.ts` had right first. Three consecutive `test:db` runs
afterwards: **16 files, 325 passed**, no flake.

*Sensitivity checks run, each restored by dropping the tables, deleting the `schema_migration` row
and re-running `npm run migrate`, so the schema comes from the file:*

| Mutation | Test that failed |
| --- | --- |
| Exclusion unscoped to `exclude using gist (held_during with &&)` | `accepts overlapping memberships on two different units` **and** the `pg_get_constraintdef` cross-check |
| Exclusion dropped entirely | both overlap tests, the cross-check, and the in-transaction savepoint test |
| Both range checks dropped | `refuses a membership covering no dates` and `refuses a membership with no start date` |

The first is the one that matters: it passes every overlap test in the file and makes it impossible
for two different units to be held over the same dates, which is every association. That is what the
beside-case exists for. The cross-check matches `pg_get_constraintdef` output rather than the
constraint's name, because task 1 shipped two assertions that matched an index's name and stayed
green with the index on the wrong column.

*Review.* One `argus_review` on the task diff returned one **low** finding: `holder_id` is not
indexed. Verified against the live schema — true; `unit_id` is covered by the exclusion's gist index
on `(unit_id, held_during)` and `holder_id` has nothing. **Skipped, with the reason recorded in the
migration**: both of this story's questions filter by unit, nothing in this epic queries by holder,
and no story before 2.4 writes these tables from the application, so there is no delete path whose
referential check would scan. The migration names the two triggers for adding it.

*Gates on `c245450`:* lint 0 errors, `tsc --noEmit` **8** (= baseline), build clean, `npm test`
**64 files / 1205 passed**, `npm run test:db` **325 passed**.

**Task 3 — the read port and its adapter.** Done. `UnitDirectory` answers the two questions this
story exists for and can express nothing else; the write side is absent on purpose, and the header
says why. Dates cross the boundary as `YYYY-MM-DD` strings because `pg` builds a JS `Date` at *local*
midnight for a Postgres `date`, which moves a 1 July membership to 30 June for anyone west of UTC.

*Two findings worth keeping.*

**An ordering test that was right by luck.** Deleting the `order by` from `historyFor` left
`returns every tenure, earliest first` **green** — the planner happened to return insertion order —
and failed only the query-text assertion. This is the same thing `quarantine-queue-connection.test.ts`
recorded about its own tiebreak, reproduced independently: a behavioural ordering test is a detector
that is usually right. Both tests stay.

**A test narrowed rather than weakened.** `interpolates nothing into its SQL` first forbade `${`
anywhere, and the shared `TENURE_COLUMNS` constant tripped it. Relaxing it to "not the unit number"
would have been a test bent to fit the code. It now permits exactly one interpolation *by name*, and
a second test proves that name resolves to a literal containing no interpolation of its own. The
constant is shared deliberately — spelling the columns out twice would let the two queries drift,
and the `to_char` assertion matches the whole file, so it would stay green with only one casting.

*Sensitivity checks run, each restored:*

| Mutation | Test that failed |
| --- | --- |
| Raw `unit_number` instead of the normalised column | `finds the unit however the number was typed` + the query-text assertion |
| `@>` reassembled as `lower(...) <= d and (upper(...) is null or upper(...) >= d)` | `names the incoming holder on the day of the sale itself` — the reassembly reads as equivalent and hands 1 July to **both** tenures |
| `to_char` dropped from the upper bound | both tests that read `heldUntil` |
| Pool built from the writer URL | both connection tests |
| `order by` deleted | the query-text test **only** — see above |

*Review.* One `argus_review` returned three findings, all verified against the real files:

- **high — module-scoped pool leaks on Next.js HMR.** True, and true of **all seven** db adapters,
  not this one. Fixing it in one file would leave it inconsistent with six siblings and would not
  address the leak. Folded into the existing epic-1 action item, which this story updated: it now
  names seven pools and both halves of the defect.
- **medium — the test never closes the adapter pool, so Vitest will hang.** The stated consequence
  does not occur: the db suite completes in 31s with no teardown stall, and
  `quarantine-queue-postgres.test.ts` — the other reader adapter — has the identical shape. Skipped,
  with the measurement rather than an opinion.
- **low — the mutable `scope` reassigned in `beforeEach` breaks under concurrent execution.** Vitest
  runs a file's tests sequentially unless `.concurrent` is used, which nothing here does, and three
  sibling files use the same pattern. Skipped.

*Gates on `942d353`:* lint 0 errors, `tsc --noEmit` **8** (= baseline), build clean, `npm test`
**67 files / 1220 passed**, `npm run test:db` **18 files / 349 passed**.

**Task 4 — prove the constraint from the outside.** Done, and enlarged. Its two written subtasks —
insert a real overlap and assert `23P01`, and use savepoints for expected failures — were already
satisfied by task 2's tests. Ticking them and moving on would have been honest but thin, because
AC3's claim is narrower than "an overlap is rejected": it is that the overlap is rejected **by the
database, not by application code**, and a single-connection test cannot tell those apart. An
application-level "check then insert" passes every other test in the file — two writers each read an
empty table, each find no overlap, and each insert.

So the task added two concurrent writers on separate connections, both inside open transactions:
overlapping ranges on **one** unit must block the second writer while the first is uncommitted and
then fail with `23P01`; overlapping ranges on **two** units must not block at all.

*The blocking assertion is the evidence, not decoration.* A concurrency test that only observes "one
of them failed" passes against a database that serialised the inserts completely and against one
that never overlapped them — which is how story 1.5d shipped a `Promise.all` concurrency test that
passed against a deliberately racy implementation. `stillPending` asserts the contended insert has
not settled after 750ms with the rival transaction still open.

*Sensitivity checks run, each restored:*

| Mutation | Test that failed |
| --- | --- |
| Exclusion dropped entirely | `makes the second of two concurrent overlapping writers wait, then refuses it` |
| Exclusion unscoped to `held_during` alone | **both** concurrency tests, the beside-case included — it starts blocking across units |

The second is what stops the first test being satisfied by a constraint that serialises every
membership in the association.

*Review.* One `argus_review` returned one **low** finding: the `setTimeout` in `stillPending` is not
cleared when the promise settles first, leaving a 750ms handle alive after the assertion is made.
Verified — true, and it fires on the beside-case every run. Fixed. No regression test accompanies it:
the only observable is a live handle inside Node, and asserting it through
`process._getActiveHandles()` would test the runtime rather than this file.

*Gates:* lint 0 errors, `tsc --noEmit` **8** (= baseline), build clean, `npm test`
**67 files / 1220 passed**, `npm run test:db` **18 files / 351 passed**.

### File List

**New**

- `migrations/011_unit.sql` — the `unit` table, `unit_normalised_number()`, the unique index on the
  normalised form, and `grant select` to `watchdog_reader`.
- `migrations/unit.test.ts` — 6 migration-text tests (comments stripped, with a positive control)
  and 9 database tests.
- `migrations/012_unit_membership.sql` — `btree_gist`, the `unit_holder` and `unit_membership`
  tables, the two range checks, the per-unit exclusion constraint, and `grant select` to
  `watchdog_reader` on both.
- `migrations/unit-membership.test.ts` — 7 migration-text tests and 19 database tests, including the
  beside-case for the exclusion's scope and a savepoint test proving a violation does not strand the
  transaction.

**Modified**

- `migrations/unit.test.ts` — cleanup scoped to a per-file `RUN_PREFIX`; it was deleting
  `unit-membership.test.ts`'s rows mid-run.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — the shared-pool action item now names
  seven adapters and the HMR half of the same defect.

**New (review round 1)**

- `migrations/executable-sql.ts` — the shared, quote-aware comment stripper both migration test
  files now use.
- `migrations/executable-sql.test.ts` — 8 tests for it, including a positive control.

**New (task 3)**

- `core/ports/unit-directory.ts` — the read port: `heldBy(unitNumber, on)` and
  `historyFor(unitNumber)`, with `UnitHolding` carrying calendar-date strings.
- `core/ports/unit-directory.test.ts` — 4 tests on the declaration's shape, including a control for
  the brace-matching helper that reads the interface body.
- `adapters/db/unit-directory-postgres.ts` — the adapter, on the reader connection.
- `adapters/db/unit-directory-postgres.test.ts` — 13 database tests, built around the day a unit
  changes hands.
- `adapters/db/unit-directory-connection.test.ts` — 11 tests on the two things behaviour cannot
  catch: which role it connects as, and what the query text asks for.

### Change Log

- 2026-08-07 — CodeRabbit round 1 applied. Five fixes, two findings routed to existing action items.
  A redundant check constraint deleted after review showed no test could detect its removal, and the
  `search_path` on the normalisation function pinned.
- 2026-08-07 — Task 4 complete (`bf5403d`). Two concurrent writers, with an assertion that they
  genuinely contended. All four tasks done; status -> review.
- 2026-08-07 — Task 3 complete (`942d353`). The read port and its reader-connection adapter, plus a
  sensitivity check showing the behavioural ordering test was passing by luck.
- 2026-08-07 — Task 2 complete (`c245450`). Migration 012, its 26 tests, and a fix to a defect this
  task exposed: two db test files were deleting each other's rows under Vitest's parallelism. A
  half-open `check` was deleted before it shipped because probing showed it could never fire.
- 2026-08-07 — Task 1 complete (`7966ed4`). Migration 011 and its two-instrument test suite. Two
  guards that proved nothing were found by the sensitivity check and tightened before the task was
  ticked; see Completion Notes.


- 2026-08-07 — Story created. Scope is the unit and its dated membership, epic 2's foundation. The
  exclusion constraint AC3 requires was verified against the live database before the story claimed
  it, including that `btree_gist` needs the migration runner and that expected-failure tests need
  savepoints. Status -> ready-for-dev.
