---
baseline_commit: acf90a0
---

# Story 4.1: A finding, and the life it leads

Status: review

## Why this story exists

Epic 4 is the one that delivers the product's name. Before any detector runs, the thing it produces
needs an identity and a life — and the epics document is explicit that this comes first, not later:

> **AD-13 comes first, or the product undermines itself.** Alerts are keyed on
> `(finding_type, subject_id, period)` so reprocessing is a no-op. Ship a detector before that key
> exists and the second ingestion run raises the same finding twice — a *duplicate-detection product
> manufacturing duplicates*. The key is not a later optimisation; it is story 4.1.

That is the whole argument. This story ships **no detector and no surface**. It ships the record a
finding is, the key that makes raising it twice impossible, and the one-way lifecycle it travels.

> **AD-13** — "Re-ingesting a document with an existing hash **replaces** that document's derived rows
> rather than appending, and never emits a second alert for a finding already raised. Alerts are keyed
> on `(finding_type, subject_id, period)` so re-processing is a no-op. Exactly one component owns
> creation of each derived entity; a second write path for the same entity is a violation."

### Deterministic, confirmed 2026-08-12

The project lead confirmed the recorded assumption: **SQL identifies the finding, templated prose
describes it, and no reasoning model is involved anywhere in FR-6, FR-7 or FR-8.** Epic 4 therefore
stays independent of Epic 3, and SM-2's claim that *100%* of mathematically exact duplicates are
flagged stays falsifiable — a claim only a deterministic detector can be held to.

Nothing in this story may take a model dependency, and the finding record has no column for
model-written text.

### Never dismissed

The lifecycle is **unreviewed → reviewed**, and there is no third state. A board member cannot make a
finding go away; they can only record that they have looked at it. That is a fiduciary property
rather than a UI preference: a register that can be emptied is a register nobody can rely on, and
"dismissed" is indistinguishable from "hidden by whoever did not want it seen".

## Story

**As** a board member,
**I want** every finding to be raised once and to stay on the record after I have reviewed it,
**So that** the register is a complete history rather than whatever survived the last upload.

## Acceptance Criteria

**AC1 — A finding is a durable record with a stable identity (AD-13).**
Keyed on `(finding_type, subject_id, period)`. Everything a detector needs to raise one is on the
record; nothing about *how it was found* is.

**AC2 — Raising the same finding twice yields one finding.**
Not "one visible finding" — one row. Re-running detection over the same data is a no-op, and this is
the criterion the epic says the whole story exists for. Proven against a real database, because a
uniqueness guarantee that lives only in application code is a guarantee that holds until two requests
arrive together.

**AC3 — Re-raising updates the evidence without resetting the life.**
A second detection run on changed data may correct the evidence a finding carries. It must not
resurrect a reviewed finding as unreviewed — that would let a re-upload quietly undo a board
member's review, which is the same defect as dismissal wearing a different hat.

**AC4 — The lifecycle is one-way: unreviewed → reviewed.**
No dismissal, no deletion, no un-reviewing. Attempting any of them fails loudly rather than silently
doing nothing.

**AC5 — A reviewed finding records who reviewed it and when.**
The register is evidence. "Somebody looked at this" is not evidence; "the treasurer looked at this on
the 3rd" is.

**AC6 — Exactly one component may create a finding (AD-13).**
A port with a single creation path, mirrored by the grants. A second write path for the same entity
is what AD-13 calls a violation, and `core/ports/query-log.ts` is the shape to follow: capability by
declaration, not by convention.

**AC7 — No model, anywhere.**
No import reaches the agent, the catalog, or anything under `core/answer`. Asserted, because the
independence from Epic 3 is a property to protect rather than an accident.

**AC8 — Tested against a real database.**
`test:db`, because AC2's uniqueness and AC4's one-way transition are enforced by constraints and
grants, and a mock cannot be wrong about either.

## Tasks / Subtasks

- [x] **Task 1 — The migration (AC1, AC2, AC4, AC5, AC6)**
  - [x] `finding` table: type, subject, period, state, evidence, timestamps, reviewer.
  - [x] A unique constraint on `(finding_type, subject_id, period)` — the key AD-13 names.
  - [x] A check constraint that a reviewed finding carries its reviewer and time, and an unreviewed
        one carries neither. The state and its evidence must not be able to disagree.
  - [x] Grants: the writer inserts and updates; **no delete for anyone**, the way migration 020
        revoked update and delete on `query_log`. "Never dismissed" is a grant, not a habit.

- [x] **Task 2 — The port (AC1, AC3, AC6, AC7)**
  - [x] `core/ports/finding.ts`. One creation method whose contract is *raise or update*, never
        *append*. A `dismiss` or `delete` method must not exist, and a comment should say why.
  - [x] The review transition as its own method, so "record a finding" and "record that a human read
        it" are separately grantable capabilities.

- [x] **Task 3 — The adapter (AC2, AC3, AC8)**
  - [x] `insert … on conflict (finding_type, subject_id, period) do update`, so the no-op is the
        database's guarantee rather than a read-then-write race.
  - [x] The conflict path updates the evidence and **leaves `state`, `reviewed_by` and `reviewed_at`
        alone** — AC3's whole point.
  - [x] `test:db` proving: raise twice → one row; raise after review → still reviewed; review twice →
        the second is refused or is a no-op, decided explicitly and tested either way.

- [x] **Task 4 — The gate**
  - [x] `npm run lint`, `npm run build`, `npm test`, `npm run test:db` (this adds a migration and an
        adapter), `npx --no-install tsc --noEmit` against the 8-error baseline.

## Dev Notes

### What this story deliberately does not build

No detector, no dashboard widget, no email. 4.2 through 4.4 raise findings; 4.5 through 4.7 show
them; 4.8 mails them. If this story renders anything, it has grown past its purpose.

### The shapes to copy

- **`migrations/020_query_log.sql`** — the closest precedent. It states an append-only property as a
  *grant* rather than a convention, revokes what the default privileges handed out, and explains in a
  comment why the reader role gets nothing. This story wants the same treatment for deletion.
- **`core/ports/query-log.ts`** — a port whose *absent* methods are the design, with the reasoning
  written down. `finding.ts` needs the same for `dismiss`.
- **`adapters/db/query-log-reader-postgres.ts`** — the reader/writer split, and now
  `adapters/db/pool.ts` for the shared pool. **Do not create a new pool**; the fourteen-to-two
  consolidation merged immediately before this story.

### `period` needs defining, not assuming

`(finding_type, subject_id, period)` is AD-13's key, and `period` is the part with no obvious type. A
duplicate-invoice finding and a missed-dues finding do not naturally share one. Options are a date
range, a month string, or a nullable column with a partial unique index for findings that have no
period at all. **Decide it in this story with the reasoning recorded**, because 4.2 through 4.4 all
key against it and changing it later means a migration plus three detectors.

The domain note recorded 2026-08-07 is directly relevant: dues cycles are **per member** — monthly,
six-monthly or annual — so a period that assumes a single global cadence would make a monthly payer
and an annual payer indistinguishable for eleven months of the year.

### Learnings that apply directly

- **Story 3.8**: a grant is not something a mock can be wrong about — prove it with `test:db` by
  pointing the adapter at the denied role and seeing `42501`.
- **Story 3.7**: two states that look alike must each assert the other's absence.
- **The pool branch, immediately before this**: four comments were wrong while the code was right.
  A comment is what a future reader trusts when deciding whether they may change something — and this
  story is almost entirely constraints whose *reasons* matter more than their syntax.
- **Anything carrying a backslash** goes through the editing tool, never a shell heredoc.

### If this has to be cut

Nothing. This story is already the smallest thing that makes 4.2 safe to build, and the epic's
ordering argument is that shipping a detector first is what produces a duplicate-detection product
that manufactures duplicates.

### References

- [Source: ARCHITECTURE-SPINE.md] — AD-13, and AD-16 for why bytes stay out of rows
- [Source: epics.md] — Epic 4's story spine and the three constraints fixing its order; recorded
  assumption 1, confirmed 2026-08-12; the domain note on per-member dues cycles
- [Source: migrations/020_query_log.sql] — append-only as a grant
- [Source: core/ports/query-log.ts] — absent methods as the design

## Dev Agent Record

### The `period` decision, and the probe that made it

`daterange`, not a month string and not a nullable column. The Dev Notes asked for the reasoning to
be recorded; it is recorded in `migrations/021_finding.sql`'s header, and it was **measured against
this database rather than reasoned about**:

```
{"a": "[2026-03-01,2026-04-01)", "b": "[2026-03-01,2026-04-01)", "same": true,
 "annual_eq_monthly": false}
```

Two spellings of March 2026 — `[2026-03-01,2026-04-01)` and `[2026-03-01,2026-03-31]` — canonicalise
to one value and compare equal. A `text` column holding `'2026-03'` cannot see that `'2026-3'` is the
same month, and the unique constraint would then pass two rows for one finding: a duplicate-detection
product manufacturing duplicates, which is the exact failure the epic orders this story first to
prevent. Ranges also carry the per-member dues cadences recorded on 2026-08-07 without a global one.

### What the probe found that reasoning had not

Canonicalisation cuts both ways. **Every empty range collapses to the single value `empty`**, so
`[2026-05-01,2026-05-01)` and `[2026-09-09,2026-09-09)` — May and September, nothing alike — compare
equal and collide on `finding_identity`. Measured: the second upsert updated the first row and
reported `inserted: false`. That is the text-column defect arriving through a different door, and a
detector computing a window from two dates that turn out equal produces it.

An unbounded bound fails differently: "from June onwards", read in 2030, covers four years it did not
cover when it was written, and a register of evidence cannot hold an entry that quietly grows.

Both are now refused by `finding_period_is_bounded`, added to migration 021 after two failing tests.
The table was dropped and re-applied locally rather than fixed in a 022 — the migration has never
been on `main`, and a 022 correcting a table created one commit earlier is history nobody benefits
from reading.

### Why `raise` reports whether the finding was already known

`RaisedFinding.wasAlreadyKnown` is the field story 4.8 needs and cannot work out for itself. AD-13
forbids emitting "a second alert for a finding already raised", and a mailer firing on every raise
would do exactly that — the no-op would hold in the table and fail in the inbox, which is the failure
a board member actually experiences.

It comes from `(xmax = 0) as inserted` on the upsert's `returning` clause, which is true only for a
row the statement inserted. Probed before it was used, and asserted in `finding-postgres.test.ts`
rather than trusted: it is exactly the sort of clever thing that must be proven against a real
database. A preceding `select` could not answer it correctly anyway — two detection runs arriving
together would both read "absent" and both believe they raised it.

### Reviewing twice is refused, and that was a decision

Task 3 asked for it to be decided explicitly. Letting a second review through would overwrite
`reviewed_by`, erasing the first board member's name from the record of who looked — which is the one
question the register exists to answer. Treating it as a quiet no-op fails the other way: the caller
is told their review was recorded when the row names somebody else. So `AlreadyReviewedError`, and it
is distinct from `FindingNotFoundError` because an UPDATE matching nothing succeeds and the two
reasons it can match nothing mean opposite things to whoever reads the surface.

The guard is `and state = 'unreviewed'` in the `where` clause rather than a preceding read, so two
board members clicking at the same moment resolve to one winner in the database.

### Test Design — the failure modes, and what each one is

| Behaviour | Failure mode | Class | Where it is forced |
| --- | --- | --- | --- |
| raise | the same finding raised twice appends | GUARD | `finding-postgres.test.ts`, one row and the same id |
| raise | two spellings of one period pass the key | GUARD | `migrations/finding.test.ts`, `23505` |
| raise | an empty period collapses unrelated windows | GUARD | both files, `23514` |
| raise | an unbounded period grows as it ages | GUARD | `migrations/finding.test.ts`, `23514` |
| raise | re-raising resets a reviewed finding | GUARD | `finding-postgres.test.ts`, the decisive case |
| raise | the conflict key names too few columns | GUARD | a second subject stays a second finding |
| raise | reversed bounds | PROPAGATE | Postgres refuses at construction, `22000` |
| markReviewed | a second review overwrites the first reviewer | GUARD | `AlreadyReviewedError`, first name survives |
| markReviewed | an UPDATE matching nothing reports success | GUARD | `FindingNotFoundError` |
| markReviewed | an unattributable reviewer is recorded | PROPAGATE | `23503`, and the row stays unreviewed |
| markReviewed | a caller backdates a review | OUT-OF-SCOPE | no parameter exists; `now()` stamps it |
| both | a delete path exists | GUARD | grant revoked, and `42501` proven in `migrations/finding.test.ts` |

### Sensitivity checks — five mutations, five caught

Run against the adapter, each reverted immediately:

| Mutation | Result |
| --- | --- |
| the conflict branch also resets `state`/`reviewed_by`/`reviewed_at` | 1 failed |
| `'[)'` becomes `'[]'` | 2 failed |
| `(xmax = 0)` becomes `true` | 1 failed |
| `and state = 'unreviewed'` dropped from the `where` clause | 1 failed |
| the `FindingNotFoundError` branch removed | 1 failed |

The first attempt at the `'[]'` mutation edited the *comment* rather than the SQL and reported all
twelve passing. Worth recording: a sensitivity check that patches the wrong occurrence looks exactly
like a test that is not sensitive.

It also corrected a comment. "Treats `until` as exclusive" claimed the two-window test caught an
inclusive upper bound; it does not — under `[]` those ranges are still distinct. What catches it is
the test that reads the stored period back. The comment now says so.

Two mutations on the port, both caught: adding `dismiss()` failed two tests, and planting
`import '../answer/grounded-answer'` and `import '../agent/chat-client'` failed AC7's assertion.

### Completion Notes

- **AC7 is asserted, and the first version of the assertion was wrong.** Matching `'core/answer'` as
  a substring misses `'../answer/grounded-answer'`, which is how the import would actually be spelled
  from `core/ports/`. Specifiers are now resolved to paths, the way `boundary.test.ts` does it.
- The assertion is scoped to the two production files this story ships, which is what can honestly be
  checked while there is no detector. Story 4.2 should extend the list.
- `README.md`'s migration count moved 20 → 21. `docs/readme.test.ts` caught it, which is the gate
  working.
- **Deferred, and not this story's**: `adapters/auth/user-directory-postgres.ts` still builds its own
  `Pool` with settings identical to `pool.ts`'s `SETTINGS`. The fourteen-to-two consolidation missed
  it, almost certainly because it sits under `adapters/auth/` rather than `adapters/db/`. Not fixed
  here — mixing a chore into a story is what the one-story-one-branch rule exists to prevent.

## Review Findings

### Argus, three rounds

Every finding was verified against the real file before it was acted on, and every one was real.

**Round 1 — three findings, all in the tests, none in the code.**

1. *(high)* `migrations/finding.test.ts` ran a bare `truncate finding` to prove the writer cannot
   truncate. On the one run where the grant has regressed — the only run where the test does anything
   at all — it would have emptied the table before reporting it. Two tests above it sat a comment
   congratulating the DELETE test for being scoped. **Fixed**, then fixed again in round 2.
2. *(medium, ×2)* Both test files read `DATABASE_URL` for the owner connection used in teardown, but
   neither counted it as required. With the role URLs set and `DATABASE_URL` absent, the suites ran,
   passed, and left every row behind — `owner?.` made the skipped cleanup invisible. **Fixed**:
   `DATABASE_URL` is part of `configured`, and `owner` is a `Client` rather than a `Client | null`,
   which removes the silent path instead of documenting it.

Found while fixing those: the adapter test seeded members as `finding-adapter-<random>` and cleaned
up on `finding-adapter-%`, which also matches members from an aborted earlier run whose findings still
reference them — a `23503` out of `afterAll`. The emails now carry the run prefix.

**Round 2 — the repo had already answered the TRUNCATE question, and better.**

The transactional rollback worked, and was verified by granting `TRUNCATE` and watching the rows
survive. It was still the wrong answer: `query-log.test.ts` settled this shape with *"the privilege
set is the same proof without the loaded gun"*, and the open action item from story 3.1 names the
exact-set assertion over `information_schema` as the fix wherever it appears. I had read that item —
the DELETE test two lines up cites it — and invented a third approach for the case it calls out. A
denied `TRUNCATE` also still takes an `ACCESS EXCLUSIVE` lock on a table other files use concurrently.

**Fixed**: exact-set assertions over `table_privileges` *and* `column_privileges`, because a
column-level grant does not appear in the first — `roles.test.ts` records a live `GRANT UPDATE (note)`
that a table-level assertion reported as clean. Sensitivity, both directions: `grant truncate` fails
the privilege assertion; `grant delete` fails it *and* the behavioural refusal.

*(low)* `__dirname` under `type: module`. **Skipped with a reason**: the open action item asks for one
choice across the repo rather than per file, so converting this file alone is the churn the item
exists to prevent. Recorded in a comment at the use site.

**Round 3 — two `info` findings, both accepted.**

1. The `the key AD-13 names` suite seeded a `board_member` no test in it reads — copied from the
   lifecycle suite below, where a reviewer is genuinely needed. **Removed**, with its cleanup.
2. The story was still `in-progress` while going to review. **Fixed** in the story file and
   `sprint-status.yaml`. Argus also proposed moving `epic-4` to `review`; **not done** — an epic takes
   `backlog`/`in-progress`/`done`, and seven stories of Epic 4 remain.

Round 4 on the fix commit: clean, no findings.

### The AC audit, which found the one thing three review rounds did not

AC4 reads: *"The lifecycle is one-way: unreviewed → reviewed. No dismissal, no deletion, **no
un-reviewing**. Attempting any of them fails loudly rather than silently doing nothing."*

Dismissal and deletion were satisfied by the grant. Un-reviewing was satisfied by **the port having no
method for it** — which is precisely the argument this migration rejects one suite further down, where
it says never-dismissed has to be a grant rather than a habit. Probed rather than assumed:

```
{"unreviewed": "ACCEPTED — the lifecycle is not one-way",
 "reattribute": "ACCEPTED — the first reviewer can be replaced"}
```

`finding_review_is_attributed` cannot catch this. A check constraint sees one row and not the row that
was there before, and setting all three columns back to their unreviewed values is internally
consistent. So a plain `UPDATE` un-reviewed a finding, and a second one replaced the reviewer's name
in the record of who looked — the defect the adapter refuses and nothing else did.

**Fixed** by `finding_lifecycle_is_one_way`, a `before update` trigger: once `state` is `reviewed`,
`state`, `reviewed_by` and `reviewed_at` are final. `evidence` stays mutable, deliberately, and has
its own positive control — a rule that froze the reviewed row entirely would pass both new refusals
and break AC3.

Sensitivity: dropping the trigger fails both new tests; restoring it passes all 725.

This is the third story where the AC audit caught something the review rounds did not (3.6b, 3.8, and
now this), and the shape is consistent: a clause that is *mostly* satisfied, where the unsatisfied
half is the one nobody would think to test.

### AC audit — the rest

| AC | Verdict |
| --- | --- |
| AC1 identity | `finding_identity` on the three columns; nothing on the record says how it was found |
| AC2 one row | proven against the real database, including two spellings of one month |
| AC3 amend without resetting | the decisive adapter test, plus a database-level control |
| AC4 one-way | **gap found and closed** — see above |
| AC5 who and when | recorded, and now un-replaceable |
| AC6 one creation path | one method on `FindingRegister`, mirrored by the grants |
| AC7 no model | asserted over both production files, with the specifiers resolved |
| AC8 real database | 725 `test:db` cases |

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-12 | Story created after the connection-pool chore merged. Deterministic detection confirmed by the project lead the same day, so this story takes no model dependency and Epic 4 stays independent of Epic 3. |
| 2026-08-12 | Tasks 1–4 implemented. `period` decided as `daterange` with the reasoning probed rather than assumed; `finding_period_is_bounded` added after the probe found that every empty range collapses to one value. Gate green: lint clean, build clean, 2283 tests, 721 `test:db`, tsc at the 8-error baseline. |

## File List

| File | Change |
| --- | --- |
| `migrations/021_finding.sql` | NEW — the table, the key, the one-way lifecycle, and the revoked delete |
| `migrations/finding.test.ts` | NEW — 19 cases against the real database, including the two spellings of one month |
| `core/ports/finding.ts` | NEW — `FindingRegister` and `FindingReviewer`, and the absent `dismiss` |
| `core/ports/finding.test.ts` | NEW — what the ports may declare, and AC7's independence assertion |
| `adapters/db/finding-postgres.ts` | NEW — the upsert and the one-way review, on the shared writer pool |
| `adapters/db/finding-postgres.test.ts` | NEW — 12 cases, five mutations caught |
| `README.md` | migration count 20 → 21 |
