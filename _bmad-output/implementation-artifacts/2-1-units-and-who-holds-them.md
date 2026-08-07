# Story 2.1: Units and who holds them

Status: ready-for-dev

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

- [ ] **Task 1 — Migration 011: the unit** (AC1)
  - [ ] `migrations/011_unit.sql`. `unit_number` is the identity a treasurer uses; the row also has a
        uuid primary key because every other table here does and foreign keys are cleaner for it.
  - [ ] **Unique on the unit number**, normalised the way 009 normalises vendor names if the numbers
        turn out to vary in spelling (`4B` vs `4b` vs `04B`). Decide this explicitly in the migration
        comment — a unit number is typed by a human off a roll, and "4B" twice is one unit.
  - [ ] `grant select on unit to watchdog_reader` — the catalog will read it. Explicit per-table, as
        migration 003 requires.
  - [ ] Migration-text test: strip comment lines before matching, and include a positive control.
        Stories 1.6a *and* 1.6c both shipped a test that matched the migration's own prose.
- [ ] **Task 2 — Migration 012: the holder, and the dated membership** (AC2, AC3, AC4)
  - [ ] A person who holds a unit is **not** a `board_member`. That table is authentication — email,
        password hash, `disabled_at`. A unit holder may never sign in. Model them separately and say
        why in the migration.
  - [ ] Membership carries a **`daterange`**, not a pair of nullable dates. Half-open (`[)`) so
        "sold on 1 July" is one membership ending and the next beginning on the same day with no
        overlap and no gap.
  - [ ] **`create extension if not exists btree_gist`** — required for `EXCLUDE USING gist` with a
        `uuid` equality operator. It must be created by the **migration runner**, not the writer;
        `watchdog_writer` gets `42501 permission denied to create extension`. Verified.
  - [ ] The constraint: `exclude using gist (unit_id with =, held_during with &&)`. Verified working —
        an overlapping insert raises **`23P01`**, and adjacent half-open ranges are accepted.
  - [ ] `grant select on` both tables to `watchdog_reader`.
- [ ] **Task 3 — The port and its read** (AC2, AC3)
  - [ ] `core/ports/unit-directory.ts` — a read port. Two questions this story can answer: who held a
        unit on a date, and the full history for a unit.
  - [ ] **Read-only, like 1.6c's queue port.** Recording units and memberships is data entry, and no
        story before 2.4 needs to write them from the application; a write port with no caller is a
        capability waiting to be misused. Say so in the header, as `quarantine-queue.ts` does.
  - [ ] `adapters/db/unit-directory-postgres.ts` on the **reader** connection — this only reads, and
        1.6c established the pattern with `readReaderDatabaseUrl()`.
- [ ] **Task 4 — Prove the constraint from the outside** (AC3)
  - [ ] Database tests that insert a real overlap and assert `23P01`, and that adjacent ranges are
        accepted. Constrain the error — a bare `rejects.toThrow()` passes for any rejection, which
        MR !20 caught in this very shape.
  - [ ] **Use savepoints for expected failures.** A rejected statement aborts the transaction, so a
        query issued afterwards fails with `25P02` — "current transaction is aborted" — and the test
        then reports the wrong cause. Verified while writing this story: `savepoint` +
        `rollback to savepoint` leaves the transaction usable.
  - [ ] Point-in-time reads return exactly one row inside a membership and zero outside it. Assert
        both; the second is what stops a query that always matches.
  - [ ] Per-test scoping in `beforeEach`, not per file. `quarantine-queue-postgres.test.ts` scoped
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

### Debug Log References

### Review Findings

### Completion Notes List

### File List

### Change Log

- 2026-08-07 — Story created. Scope is the unit and its dated membership, epic 2's foundation. The
  exclusion constraint AC3 requires was verified against the live database before the story claimed
  it, including that `btree_gist` needs the migration runner and that expected-failure tests need
  savepoints. Status -> ready-for-dev.
