---
baseline_commit: b44495b4ece5c4ca06ad432d3afde96996d95dd1
---

# Story 2.2: What each unit owes this year

Status: ready-for-dev

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

- [ ] **Task 1 — Migration 013: the assessment** (AC1, AC3)
  - [ ] `migrations/013_assessment.sql`. One row per unit per year: `unit_id` referencing `unit(id)`,
        `assessment_year`, `annual_amount`, `billing_cycle`.
  - [ ] **`annual_amount numeric(14,2)`**, matching `extraction.total_amount` exactly — same
        precision and scale, for the reason recorded above. A check constraint that the amount is
        **positive**: a unit that owes nothing is an absent assessment, not a zero one, and a
        negative annual due is not a thing.
  - [ ] **Store the ANNUAL amount, never the instalment.** The tempting error is to record
        `$500/month` for a monthly payer. AC2 exists to forbid it: two units with the same annual
        figure owe the same total whatever their cycle, so the amount column must not be scaled by
        the cycle. Say so in the migration.
  - [ ] **`billing_cycle text` + `check (billing_cycle in ('monthly', 'six_monthly', 'annual'))`** —
        a closed vocabulary the database enforces, in the style of `document_extraction_state`. Not a
        Postgres `enum`: nothing here uses one, and adding a value to an enum is a migration where a
        check constraint is a one-line change.
  - [ ] **Unique on `(unit_id, assessment_year)`.** Two assessments for one unit in one year is two
        answers to "what does 4B owe for 2024", and neither would look wrong.
  - [ ] `assessment_year integer` with a sanity range check. A pasted cell or a typo'd `20024` should
        fail here rather than become a row nobody can find.
  - [ ] `grant select on assessment to watchdog_reader` — explicit per table, as migration 003
        requires. **SELECT only**, per AD-4.
  - [ ] Migration-text test using the shared `executable()` from `migrations/executable-sql.ts`
        (story 2.1 built it; do **not** write a fourth local copy).
- [ ] **Task 2 — The cycle vocabulary, stated once** (AC1)
  - [ ] A TypeScript constant for the three cycles, and a test that **reads migration 013 and proves
        the two agree**. This is migration 007's established pattern and its comment says why: "a
        second statement of a shape is only safe when something fails on disagreement."
  - [ ] The test must fail if either side gains, loses, or renames a value — check **both
        directions**, not just that every constant appears in the SQL. A one-way check passes when
        the migration has an extra value the application has never heard of.
- [ ] **Task 3 — The port and its read** (AC1, AC2)
  - [ ] `core/ports/assessment-directory.ts` — a **read** port, for the reason
        `core/ports/unit-directory.ts` and `quarantine-queue.ts` both give: recording assessments is
        data entry and no story before 2.4 does it from the application. Say so in the header.
  - [ ] `annualAmount` crosses as a **decimal string**, exactly as `ExtractionRecord.totalAmount`
        does. Never a `number`.
  - [ ] `adapters/db/assessment-directory-postgres.ts` on the **reader** connection, following
        `unit-directory-postgres.ts`: lazy pool, named columns rather than `select *`, and a
        connection test asserting it never reaches for the writer URL.
- [ ] **Task 4 — Prove the annual-amount property** (AC2, AC3)
  - [ ] The assertion AC2 actually asks for: two units, **same annual amount, different cycles**, and
        the stored amounts are equal. A test that merely reads one assessment back would pass against
        a schema that scaled the amount by the cycle.
  - [ ] Prove the amount survives the round trip **exactly** — `1234.56` comes back as `'1234.56'`,
        not `1234.56` and not `'1234.5600'`. A float would fail this; so would a `number` at the
        boundary.
  - [ ] Constrain every expected failure to its SQLSTATE. A bare `rejects.toThrow()` passes for a
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

### Debug Log References

### Review Findings

### Completion Notes List

### File List

### Change Log

- 2026-08-07 — Story created. The money-representation conflict between `ARCHITECTURE-SPINE.md` and
  epic 1's shipped code was surfaced and resolved by Matt before implementation rather than
  discovered during it; the architecture row and AC3 were both amended to match the code. Status ->
  ready-for-dev.
