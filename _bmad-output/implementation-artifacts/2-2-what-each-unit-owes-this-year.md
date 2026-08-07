---
baseline_commit: b44495b4ece5c4ca06ad432d3afde96996d95dd1
---

# Story 2.2: What each unit owes this year

Status: review

> **Second of four stories in epic 2, the dues ledger.** 2.1 built the unit and who holds it. This
> story records what each unit owes for a year and on what cadence it is paid. 2.3 turns that into
> instalments; 2.4 records what actually arrived.

## Story

As a treasurer,
I want each unit's annual dues and its payment cycle recorded,
So that "paid the proper amount, on time" is a question with a defined answer.

## Acceptance Criteria

**AC1**
**Given** an assessment for a unit and a year
**When** it is recorded
**Then** it carries one annual amount and that unit's cycle — monthly, six-monthly, or annual

**AC2**
**Given** two units on different cycles with the same annual amount
**When** their assessments are compared
**Then** they owe the same total for the year and differ only in when it falls due

**AC3**
**Given** an assessment amount
**When** it is stored
**Then** it is held as an exact decimal — `numeric(p,s)` in the database and a decimal string across
every boundary — never a float and never a JS `number`

## The decision that shapes this story

**The money convention was stated twice in this project and the two disagreed.** Resolved by Matt on
2026-08-07 before implementation, because it decides the schema, the port type, and how story 2.4
compares a payment against an assessment.

| Source | Said |
| --- | --- |
| `ARCHITECTURE-SPINE.md` Consistency Conventions | "Integer minor units (cents) end to end" |
| `migrations/006_extraction.sql` | `total_amount numeric(14,2)` |
| `core/extraction/record.ts:53` | "`totalAmount` is a **decimal string**, never a number" |
| `core/extraction/record.test.ts:83` | a migration-text test pinning `numeric(p,s)` |

Both avoid floats, so neither was wrong — they are different representations. **The shipped
convention won.** Story 2.4 compares an extracted payment against a stored assessment, and two
representations would put a rounding conversion inside the comparison that produces arrears
findings, which is the one place a fiduciary tool cannot be approximate.

`ARCHITECTURE-SPINE.md`'s Money row and AC3 above were both amended to match, with the reasoning
recorded in each. **Do not reintroduce cents here.**

## Verified while writing this story

Probed against the live database and the existing code, so the story does not claim anything it has
not checked:

| Probe | Result | What it decides |
| --- | --- | --- |
| `select 1234567::bigint` through `pg` | returns the **string** `'1234567'` | `bigint` would arrive as a string anyway — one more reason the decimal-string boundary is not a special case |
| `select 1234::integer` through `pg` | returns the **number** `1234` | the only integer type that arrives as a number, and it caps at ~$21M in cents |
| `numeric(14,2)` through `pg` | returns a **decimal string** | which is exactly what `core/extraction/record.ts` documents and relies on |
| Closed-vocabulary precedent | `document_extraction_state`, `extraction.document_kind`, `extraction_currency_supported` | all are `text` + a `check (… in (…))`, **not** a Postgres `enum` |
| `007_document_extraction_state.sql` comment | "The application has a matching constant and a test reads this file to prove the two agree" | the pattern the cycle vocabulary must follow |

## Tasks / Subtasks

- [x] **Task 1 — Migration 013: the assessment** (AC1, AC3)
  - [x] `migrations/013_assessment.sql`. One row per unit per year: `unit_id` referencing `unit(id)`,
        `assessment_year`, `annual_amount`, `billing_cycle`.
  - [x] **`annual_amount numeric(14,2)`**, matching `extraction.total_amount` exactly — same
        precision and scale, for the reason recorded above. A check constraint that the amount is
        **positive**: a unit that owes nothing is an absent assessment, not a zero one, and a
        negative annual due is not a thing.
  - [x] **Store the ANNUAL amount, never the instalment.** The tempting error is to record
        `$500/month` for a monthly payer. AC2 exists to forbid it: two units with the same annual
        figure owe the same total whatever their cycle, so the amount column must not be scaled by
        the cycle. Say so in the migration.
  - [x] **`billing_cycle text` + `check (billing_cycle in ('monthly', 'six_monthly', 'annual'))`** —
        a closed vocabulary the database enforces, in the style of `document_extraction_state`. Not a
        Postgres `enum`: nothing here uses one, and adding a value to an enum is a migration where a
        check constraint is a one-line change.
  - [x] **Unique on `(unit_id, assessment_year)`.** Two assessments for one unit in one year is two
        answers to "what does 4B owe for 2024", and neither would look wrong.
  - [x] `assessment_year integer` with a sanity range check. A pasted cell or a typo'd `20024` should
        fail here rather than become a row nobody can find.
  - [x] `grant select on assessment to watchdog_reader` — explicit per table, as migration 003
        requires. **SELECT only**, per AD-4.
  - [x] Migration-text test using the shared `executable()` from `migrations/executable-sql.ts`
        (story 2.1 built it; do **not** write a fourth local copy).
- [x] **Task 2 — The cycle vocabulary, stated once** (AC1)
  - [x] A TypeScript constant for the three cycles, and a test that **reads migration 013 and proves
        the two agree**. This is migration 007's established pattern and its comment says why: "a
        second statement of a shape is only safe when something fails on disagreement."
  - [x] The test must fail if either side gains, loses, or renames a value — check **both
        directions**, not just that every constant appears in the SQL. A one-way check passes when
        the migration has an extra value the application has never heard of.
- [x] **Task 3 — The port and its read** (AC1, AC2)
  - [x] `core/ports/assessment-directory.ts` — a **read** port, for the reason
        `core/ports/unit-directory.ts` and `quarantine-queue.ts` both give: recording assessments is
        data entry and no story before 2.4 does it from the application. Say so in the header.
  - [x] `annualAmount` crosses as a **decimal string**, exactly as `ExtractionRecord.totalAmount`
        does. Never a `number`.
  - [x] `adapters/db/assessment-directory-postgres.ts` on the **reader** connection, following
        `unit-directory-postgres.ts`: lazy pool, named columns rather than `select *`, and a
        connection test asserting it never reaches for the writer URL.
- [x] **Task 4 — Prove the annual-amount property** (AC2, AC3)
  - [x] The assertion AC2 actually asks for: two units, **same annual amount, different cycles**, and
        the stored amounts are equal. A test that merely reads one assessment back would pass against
        a schema that scaled the amount by the cycle.
  - [x] Prove the amount survives the round trip **exactly** — `1234.56` comes back as `'1234.56'`,
        not `1234.56` and not `'1234.5600'`. A float would fail this; so would a `number` at the
        boundary.
  - [x] Constrain every expected failure to its SQLSTATE. A bare `rejects.toThrow()` passes for a
        missing table, which MR !20 caught in this very shape.

## Dev Notes

### What story 2.1 hands over

- `unit(id)` exists and is the FK target. `unit_normalised_number(raw text)` folds case and
  whitespace and is **pinned to `search_path = pg_catalog, pg_temp`** — if this story ever looks a
  unit up by number, use that function rather than the raw column.
- `migrations/executable-sql.ts` is the **shared** migration comment stripper. It is quote-aware
  (trailing comments, nested blocks, `--` inside literals, `$$` bodies, `E'…'`, non-ASCII and astral
  identifiers). Its header states its scope: it is not a general SQL parser and should not grow into
  one. **Import it. Do not write another local `executable`.**
- Test files that write to shared tables carry a per-file random `RUN_PREFIX` and clean up only rows
  carrying it. This is not optional: 2.1's first version cleaned up with `like '%-%'` and two files
  deleted each other's rows mid-run under Vitest's file parallelism.
- `adapters/db/unit-directory-postgres.ts` + `unit-directory-connection.test.ts` are the pattern for
  this story's adapter, including the two things no behavioural test can catch — which role it
  connects as, and what the query text asks for.

### Learnings that apply directly

**From 2.1, the ones that cost the most:**

1. **A cross-check that matches a *name* proves nothing.** Two assertions matched
   `normalised_number` anywhere after `create unique index`, and the index is *called*
   `unit_normalised_number_key` — both stayed green with the index on the wrong column. Match the
   indexed column inside its parentheses, or `pg_get_constraintdef`, never the constraint's name.
2. **Mutate one thing at a time.** 2.1's mutation testing dropped two check constraints together and
   so never showed that either mattered; one of them turned out to be entirely redundant and
   *nothing* could detect its removal. Drop them singly.
3. **A guard that cannot be made to fail is a guard to delete.** Five were found in 2.1, and three
   were written *in the round that fixed the previous one*. After writing any test, break the thing
   it covers and confirm it fails.
4. **`pg` type marshalling is a boundary decision, not a detail.** 2.1's dates cross as
   `YYYY-MM-DD` strings because `pg` builds a JS `Date` at *local* midnight. Money crosses as a
   decimal string for the analogous reason.

### Testing standards

- Two instruments, as epic 1 settled: **database tests** prove constraints by violating them and
  asserting the SQLSTATE, and a **migration-text test** proves the statements say what the prose
  claims — comments stripped via the shared helper.
- SQLSTATEs in play: `23505` unique, `23503` foreign key, `23514` check, `42501` insufficient
  privilege, `22P02` invalid text representation.
- Database tests live behind `WATCHDOG_WRITER_DATABASE_URL` / `WATCHDOG_READER_DATABASE_URL` and run
  under `npm run test:db`. **That suite runs nowhere but here** — there is no CI.
- Gate: `npm run lint`, `npm run build`, `npm test`, `npm run test:db`, and
  `npx --no-install tsc --noEmit` against its **baseline of 8** pre-existing errors.

### Project Structure Notes

| Path | Kind |
| --- | --- |
| `migrations/013_assessment.sql` | NEW |
| `migrations/assessment.test.ts` | NEW |
| `core/assessment/billing-cycle.ts` | NEW — the vocabulary constant |
| `core/assessment/billing-cycle.test.ts` | NEW — proves it agrees with the migration |
| `core/ports/assessment-directory.ts` | NEW |
| `adapters/db/assessment-directory-postgres.ts` | NEW |
| `adapters/db/assessment-directory-postgres.test.ts` | NEW |
| `adapters/db/assessment-directory-connection.test.ts` | NEW |

`core/` imports nothing outward — enforced by `core/ports/boundary.test.ts`.

### References

- `_bmad-output/planning-artifacts/epics.md` — Epic 2, Story 2.2; and "Domain detail: how dues
  actually work (recorded 2026-08-07)", which is the only statement of the per-unit annual amount
  and the per-member cycle.
- `ARCHITECTURE-SPINE.md` — Consistency Conventions (Money, amended 2026-08-07; Dates; Ids), AD-4.
- `migrations/006_extraction.sql`, `core/extraction/record.ts` — the money representation this story
  matches.
- `migrations/007_document_extraction_state.sql` — the closed-vocabulary pattern and the reason for
  the agreement test.
- `_bmad-output/implementation-artifacts/2-1-units-and-who-holds-them.md` — the predecessor.

## Dev Agent Record

### Agent Model Used

### Test Design

## Task 1 - migration 013, the assessment

One behaviour: the `assessment` table exists with the right shape, the right vocabulary and the
right grants. Two instruments, as epic 1 settled — database tests that violate each constraint and
assert the SQLSTATE, and a migration-text test using the **shared** `executable()` stripper.

### Behaviour A - the `assessment` table (AC1, AC3)

1. **Correct-run signal:** an assessment inserts for a unit and a year with an annual amount and a
   cycle, and reads back with the amount **byte-identical** as a decimal string.
2. **How to test it:** against the real database, scoped per test with a per-file `RUN_PREFIX`,
   asserting SQLSTATEs rather than that something threw.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| A1 | The amount is stored as a float, so `1234.56` comes back `1234.5599999999999` and every comparison against a payment is wrong by a fraction that compounds | GUARD - `numeric(14,2)`, matching `extraction.total_amount`. Proved by a round-trip asserting the exact **string**, not a numeric closeness |
| A2 | The column holds the **instalment** rather than the annual figure - `$500` for a monthly payer instead of `$6000` - so two units owing the same for the year look different, and 2.3 multiplies an already-divided number | GUARD, but by **contract not constraint**, and worth saying plainly: no check constraint can tell 500 from 6000. What guards it is the column name, the migration comment, and AC2's test that two units with the same annual figure and different cycles store equal amounts |
| A3 | Two assessments for one unit in one year, so "what does 4B owe for 2024" has two answers and neither looks wrong | GUARD - unique on `(unit_id, assessment_year)`, `23505` |
| A4 | An assessment for a unit that does not exist | GUARD - foreign key, `23503` |
| A5 | A cycle outside the vocabulary - `quarterly`, `Monthly`, `''` - so a row exists that nothing downstream can interpret and 2.3 cannot schedule | GUARD - `check (billing_cycle in (...))`, `23514`. Case matters: `Monthly` must fail, because the application constant is lower-case |
| A6 | A zero or negative annual amount. A unit owing nothing is an **absent** assessment, not a zero one; a negative annual due is not a thing | GUARD - `check (annual_amount > 0)`, `23514`. Boundaries: `0`, `-0.01`, and `0.01` which must be accepted |
| A7 | An absurd year - `0`, `20024`, negative - from a typo or a pasted cell, becoming a row nobody can find | GUARD - a range check, `23514` |
| A8 | An amount beyond `numeric(14,2)` capacity | GUARD - Postgres raises `22003` numeric field overflow. Boundary: the largest representable value must be **accepted** |
| A9 | More decimal places than the scale - `1234.567` | **PROPAGATE, documented.** Postgres does not reject it: `numeric(14,2)` **rounds** to `1234.57`. This is inherent to the type and `extraction.total_amount` behaves identically. Tested and recorded rather than guarded, because a caller must know the rounding happens and which way it goes |
| A10 | `watchdog_reader` cannot read the table, so epic 3 cannot answer a dues question; or **can write** it, letting the query path invent an assessment | GUARD - explicit `grant select`, and assert no write privilege (`42501`) |
| A11 | The migration-text test matches the migration's own prose rather than its SQL | GUARD - the **shared** `executable()` from `migrations/executable-sql.ts`, plus a positive control that this migration's statements survive stripping |

**Cross-check (required):** the money representation is verified two independent ways — once by the
round trip returning the exact decimal string, and once by reading the column type out of
`information_schema.columns` and asserting `numeric` with precision 14 and scale 2. A round trip
alone passes against `numeric(20,4)`; a type check alone passes against a column nothing writes to.

**Reverse-it:** insert then read is the inverse pair, and it is the assertion A1 turns on.

### Debug Log References

### Review Findings

## CodeRabbit round 1 (IDE, 2026-08-07) - head `7a88c5c`, base `b44495b`

10 findings, 7 in scope. All 13 branch files appeared in `fileReviewMap`; the other 3 are the
extension picking up uncommitted work, as it always does.

**A process failure first, because it cost the round its scoring.** `argus_ingest` skipped this
review - *"no Argus run recorded for 7a88c5c"*. Argus had run on `main...HEAD` at `ebd6a77`; a fix
commit then became the new head and the review was requested against it without re-running Argus.
Step 4b says to review the **fix commit** for exactly this reason. Recovered by running
`argus_review` on `7a88c5c` and re-ingesting: agreed 2, missed 2, recall 0.5.

**Fixed (4).**

| # | Finding | What was true |
| --- | --- | --- |
| 1 | *major* - the comment-stripping control passes whether or not stripping works | **Confirmed.** It asserted the absence of "Which role the assessment directory connects as" - the opening line of the *test* file own docblock, which never appears in the adapter. The assertion held with both `.replace` calls deleted. Now it names a phrase present in the adapter before stripping and absent after, and deleting the stripping fails it. **This shape was copied from `unit-directory-connection.test.ts`, which still has it** |
| 7 | *trivial* - `accepts %s` reads back the amount, not the cycle | **Confirmed.** The amount was the same constant for all three cases, so an implementation that mapped or defaulted `billing_cycle` would have passed all three. Now reads back the cycle |
| 5 | *trivial* - call and index signatures still escape the read-only guard | **Confirmed**, and the helper comment claimed it reported "any member" while the regex required a name. Both are now reported under a placeholder, with a planted-declaration test each |
| 3 | *trivial* - name the unit uniqueness guarantee | Fair. The comment named migration 013 constraint but not migration 011 unique index, the other half of why the join returns at most one row |

**Skipped (3), each with the reason.**

| # | Finding | Why not |
| --- | --- | --- |
| 2 | Close the shared pool in `afterAll` | Third time raised across 2.1 and 2.2. The stated consequence does not occur, and the shape is identical in all eight adapters. One open action item covers them together |
| 4 | Run `tsc --noEmit` as a blocking CI step | **There is no CI** - removed 2026-08-07. The substance is already the practice: `tsc --noEmit` is in the local gate precisely because `npm run build` does not type-check test files |
| 6 | *major* - `__dirname` fails during module loading under ESM | The stated consequence is **false here**: the tests pass, because Vitest polyfills it. Checked rather than assumed. The real point is true of all six `migrations/*.test.ts` and is already an open action item |

**The count that matters.** Findings 1 and 7 bring this story to **seven** guards that passed whether
or not the thing they guarded against was present, across 2.1 and 2.2. Four of the seven were
written *while fixing a previous one*, and finding 1 was inherited by copying a sibling file.

*Sensitivity checks on this round, each restored:*

| Mutation | Test that failed |
| --- | --- |
| Both `.replace` stripping lines deleted | `actually removes the comments, and leaves the statements standing`, plus the two source guards that depend on stripping |
| Regex reverted to require a name | both unnamed-member cases |

*Gates:* lint 0 errors, `tsc --noEmit` **8** (= baseline), build clean, `npm test`
**73 files / 1268 passed**, `npm run test:db` **22 files / 423 passed**.

### Completion Notes List

**Task 4 — prove the annual-amount property.** Done, and enlarged. All three written subtasks were
already satisfied by tasks 1 and 3: the AC2 property is asserted both against the table and through
the port, the exact round trip is asserted in both places, and every expected failure names its
SQLSTATE. Ticking them and moving on would have been honest but thin.

*The gap they left.* The entire money decision rests on one sentence, in migration 006 and in the
architecture: **"a binary float cannot represent 0.10"**. No test used that value. Every amount in
play — `1234.56`, `1200`, `3400.00` — either survives a JS-number round trip or fails only on its
scale, so a coercion could have slipped through several of them.

Added: `0.10` carried end to end through the port, **plus a control proving the value
discriminates** — `String(Number('1234.56'))` is `'1234.56'` and survives, while
`String(Number('0.10'))` is `'0.1'` and does not. The control asserts a fact about JavaScript rather
than about this code, which is the point: it shows the chosen value can fail, instead of claiming so
in a comment.

*Sensitivity, and the check that mattered.* Making the adapter coerce through
`String(Number(...))` fails **7** tests — and specifically `returns a value a binary float cannot
represent, unchanged`, which is the one this task exists for. Verified by name rather than by
counting failures, because the previous run truncated its output and a passing new test would have
hidden inside a list of seven.

*Gates on the final head:* lint 0 errors, `tsc --noEmit` **8** (= baseline), build clean, `npm test`
**73 files / 1265 passed**, `npm run test:db` **22 files / 423 passed**.

**Task 3 — the read port and its adapter.** Done. `AssessmentDirectory` answers one question and can
express nothing else; `annualAmount` crosses as a decimal string and `billingCycle` as the shared
union rather than `string`. The adapter reads on the reader connection, matches the unit through
`unit_normalised_number()`, and does not cast the amount on the way out.

*Sensitivity checks, each restored:*

| Mutation | Tests that failed |
| --- | --- |
| Pool built from the writer URL | both connection tests |
| Raw `unit_number` instead of the normalised column | the query-text assertion and `finds the unit however the number was typed` |
| Year filter dropped | 5, including the query-text assertion |
| `annual_amount::float8` on the way out | **6**, including the source guard and every exact-decimal assertion |

The last one is the money decision, and the mutation most likely to be made by someone tidying up.

*Review — and a fifth guard that proved nothing, again mine.* One `argus_review` returned three
findings:

- **low, confirmed and fixed — the one that mattered.** `declaredMethods` matched only method
  shorthand. TypeScript lets the same capability be written as a function-typed property
  (`readonly record: (x) => Promise<void>`), and in that form a **write method would have been
  invisible** to the exhaustive read-only assertion, which would have gone on reporting a read-only
  port. Verified against a planted declaration before fixing, and the new control fails against the
  old regex.
- **medium, skipped.** Method shorthand is bivariant and disables strict function-type checking.
  True, and true of **every** port in this repo — `UnitDirectory`, `QuarantineQueue` and the rest all
  use it. Changing one splits the convention; recorded rather than done here.
- **low, skipped.** The pool `error` listener swallows idle-client errors. It exists to stop Node
  treating them as unhandled and killing the process, and it is identical in
  `unit-directory-postgres.ts` and `quarantine-queue-postgres.ts`. Same argument.

*Sibling defect found, recorded rather than fixed (Step 8 question 4).*
`core/ports/unit-directory.test.ts` — story 2.1, already merged — has the **identical blind spot**:
its `declaredMethods` cannot see a function-typed property, so its read-only assertion would pass
with a write capability declared that way. Logged as an epic-2 action item carrying the exact
one-line fix.

*Gates on `50cdd1a`:* lint 0 errors, `tsc --noEmit` **8** (= baseline), build clean, `npm test`
**73 files / 1265 passed**, `npm run test:db` **22 files / 421 passed**.

**Task 2 — the cycle vocabulary, stated once.** Done. `BILLING_CYCLES` and migration 013's
`assessment_cycle_known` name the same three values, and a test reads the migration to prove it.
Structured after `core/extraction/record.test.ts` rather than inventing a second shape — including
its empty-list guard, which exists because a comparison of nothing to nothing shipped twice in 1.4.

*Set equality, so it fails both ways.* Mutated in three directions, each restored:

| Mutation | Tests that failed |
| --- | --- |
| Migration gains `quarterly` | the agreement test **and** the vacuity control |
| Constant gains `quarterly` | the agreement test and the anchor test |
| Constraint renamed so the parser matches nothing | the vacuity control — the case that would otherwise compare two empty arrays and report green |

The migration is read with `readFileSync` at runtime rather than imported, so nothing under `core/`
gains an outward import; `core/ports/boundary.test.ts` enforces that and `record.test.ts` set the
precedent.

*Review — and a fourth guard that proved nothing, in the same shape as story 2.1's five.* One
`argus_review` returned three findings:

- **medium, confirmed and fixed.** `const cycle: BillingCycle = 'six_monthly'` was commented as
  preventing the type widening to `string`. It does not — an assignment only proves assignability,
  and it compiles just as happily when the type *is* `string`. **The comment asserted a property the
  code did not check.** Replaced with `const notWidened: string extends BillingCycle ? never : true`,
  and verified: widening the type takes `tsc --noEmit` from the baseline 8 to 9, with
  `Type 'true' is not assignable to type 'never'`.
- **low, fixed.** The migration parser hard-coded lower-case `check`/`in`. The constraint name is
  what anchors the match, so the `i` flag costs nothing and stops a future `CHECK (… IN (…))` from
  making the parser silently match nothing.
- **medium, skipped.** `clause![1]!` double non-null assertions. Copied verbatim from
  `record.test.ts`, and runtime-safe: the `expect(clause).not.toBeNull()` above throws first, so the
  assertion is never evaluated against null. Diverging here would split an idiom this file
  deliberately reuses.

*Gates on `b19490d`:* lint 0 errors, `tsc --noEmit` **8** (= baseline), build clean, `npm test`
**70 files / 1251 passed**, `npm run test:db` **20 files / 402 passed**.

**Task 1 — migration 013, the assessment.** Done. `annual_amount numeric(14,2)` matching
`extraction.total_amount`, the cycle as a check-constraint vocabulary, and one row per unit per year.

*The guard that is a contract, not a constraint.* `annual_amount` is the annual figure and never the
instalment, and **no check constraint can tell 500 from 6000**. What guards it is the column name,
the migration comment and AC2's test. Said plainly in the migration rather than left implicit,
because if the amount were ever stored already divided, story 2.3 would divide it again and every
expected instalment would be wrong by a factor of twelve.

*A behaviour propagated rather than guarded.* `numeric(14,2)` **rounds** an amount carrying more
decimals than the scale — `1234.567` stores as `1234.57` — it does not reject it. Inherent to the
type, and `extraction.total_amount` behaves identically. Pinned by a test so a caller relying on it,
or surprised by it, finds the answer there rather than in production.

*Sensitivity checks, one change each, every one restored by dropping the table and re-running the
migration so the schema comes from the file:*

| Mutation | Tests that failed |
| --- | --- |
| `annual_amount` as `double precision` | **8** — the `information_schema` type cross-check, the migration-text assertion, and every money assertion |
| Unique on `unit_id` alone | `accepts the same unit in a different year` |
| Unique on `assessment_year` alone | the same-year-different-unit case, and 5 others |
| Positive-amount check dropped | the zero and the negative case |
| Cycle vocabulary dropped | the migration-text assertion and all three rejection cases |

Mutated **one at a time**, which is 2.1's lesson: a mutation removing two things at once cannot show
that either one matters, and that is how 2.1 shipped a check constraint nothing could detect the
removal of.

*Review.* One `argus_review` on the task diff returned one **low** finding: `__dirname` is not native
to ESM and this package is `"type": "module"`. Verified — true, and true of **all six**
`migrations/*.test.ts` files, which rely on Vitest's polyfill; the ports and adapters family uses
`import.meta.url` instead. Changing one of six would split the convention inside `migrations/`, so it
is recorded as a repo-wide consistency item rather than fixed here.

*Gates on `83ac8c3`:* lint 0 errors, `tsc --noEmit` **8** (= baseline), build clean, `npm test`
**69 files / 1246 passed**, `npm run test:db` **402 passed**.

### File List

**New**

- `migrations/013_assessment.sql` — the `assessment` table: annual amount, cycle, one row per unit
  per year, and `grant select` to `watchdog_reader`.
- `migrations/assessment.test.ts` — 7 migration-text tests and 23 database tests.
- `core/assessment/billing-cycle.ts` — the frozen vocabulary and its union type.
- `core/assessment/billing-cycle.test.ts` — 5 tests, including the both-directions agreement with
  migration 013 and a type-level assertion against widening.
- `core/ports/assessment-directory.ts` — the read port.
- `core/ports/assessment-directory.test.ts` — 5 tests on the declaration shape.
- `adapters/db/assessment-directory-postgres.ts` — the adapter, on the reader connection.
- `adapters/db/assessment-directory-postgres.test.ts` — 12 database tests.
- `adapters/db/assessment-directory-connection.test.ts` — 9 tests on the two things behaviour cannot
  catch: which role it connects as, and what the query text asks for.

**Modified**

- `_bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md` — the Money row amended.
- `_bmad-output/planning-artifacts/epics.md` — story 2.2's third acceptance criterion amended.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status, plus two new action items.

### Change Log

- 2026-08-07 — All four tasks complete. Migration 013, the cycle vocabulary, the read port and its
  reader adapter. Two guards that proved nothing were found by their own sensitivity checks and
  fixed before the tasks were ticked. Status -> review.

- 2026-08-07 — Story created. The money-representation conflict between `ARCHITECTURE-SPINE.md` and
  epic 1's shipped code was surfaced and resolved by Matt before implementation rather than
  discovered during it; the architecture row and AC3 were both amended to match the code. Status ->
  ready-for-dev.
