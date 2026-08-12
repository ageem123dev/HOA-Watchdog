---
baseline_commit: acf90a0
---

# Story 4.1: A finding, and the life it leads

Status: in-progress

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

- [ ] **Task 1 — The migration (AC1, AC2, AC4, AC5, AC6)**
  - [ ] `finding` table: type, subject, period, state, evidence, timestamps, reviewer.
  - [ ] A unique constraint on `(finding_type, subject_id, period)` — the key AD-13 names.
  - [ ] A check constraint that a reviewed finding carries its reviewer and time, and an unreviewed
        one carries neither. The state and its evidence must not be able to disagree.
  - [ ] Grants: the writer inserts and updates; **no delete for anyone**, the way migration 020
        revoked update and delete on `query_log`. "Never dismissed" is a grant, not a habit.

- [ ] **Task 2 — The port (AC1, AC3, AC6, AC7)**
  - [ ] `core/ports/finding.ts`. One creation method whose contract is *raise or update*, never
        *append*. A `dismiss` or `delete` method must not exist, and a comment should say why.
  - [ ] The review transition as its own method, so "record a finding" and "record that a human read
        it" are separately grantable capabilities.

- [ ] **Task 3 — The adapter (AC2, AC3, AC8)**
  - [ ] `insert … on conflict (finding_type, subject_id, period) do update`, so the no-op is the
        database's guarantee rather than a read-then-write race.
  - [ ] The conflict path updates the evidence and **leaves `state`, `reviewed_by` and `reviewed_at`
        alone** — AC3's whole point.
  - [ ] `test:db` proving: raise twice → one row; raise after review → still reviewed; review twice →
        the second is refused or is a no-op, decided explicitly and tested either way.

- [ ] **Task 4 — The gate**
  - [ ] `npm run lint`, `npm run build`, `npm test`, `npm run test:db` (this adds a migration and an
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

_To be filled by the dev agent._

## Review Findings

_To be filled by the review._

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-12 | Story created after the connection-pool chore merged. Deterministic detection confirmed by the project lead the same day, so this story takes no model dependency and Epic 4 stays independent of Epic 3. |
