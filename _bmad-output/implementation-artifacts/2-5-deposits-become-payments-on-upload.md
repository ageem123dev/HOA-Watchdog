---
baseline_commit: TBD
---

# Story 2.5: A deposit becomes payments when it is uploaded

Status: ready-for-dev

> **Added 2026-08-08, after story 2.4.** 2.4 built the ledger — the `payment` and `held_payment`
> tables, the resolve-or-hold decision, and the repository that replaces both on re-ingest. It did
> not connect any of it to the upload path. This story does, and it exists because 2.4's own AC1 is
> not true end to end without it.

## Why this story exists

Story 2.4's first acceptance criterion reads *"Given an uploaded deposit document, when its records
are extracted, then each payment is stored against a unit"*. Every piece needed for that was built
and tested, and **nothing calls any of it**. Verified by search: the only non-test files mentioning
`createPaymentRepository`, `resolveLine` or `createHeldPaymentQueue` are the three that define them.

Upload a deposit today and you get `extraction` rows and no payment. The gap was not caught by any
review, because every part has tests and they all pass — which is the point worth carrying into this
story: **a set of green units does not add up to a working path, and only something that exercises
the whole path can say otherwise.**

## The three gaps, precisely

| Gap | What it means today |
| --- | --- |
| `core/ingestion/extract-document.ts` takes `{ repository, extractor, quarantine }` and no payment repository | Nothing writes a payment, ever |
| The extractor was never taught to emit `unitReference` | 2.4 added the field to `ExtractionRecord` and to `validate.ts`, but not to the Gemini prompt or the tabular reader, so it is `null` on every row in practice |
| Nothing resolves a reference to a `unit_id` | `resolveLine` takes a lookup as a **parameter**, deliberately, so it stays pure. No adapter implements one. `UnitDirectory` answers "who held 4B", not "which unit is `4b`" |

## Story

As a treasurer,
I want an uploaded deposit to become payments without further action,
So that what arrived is in the ledger by the time I look at it.

## Acceptance Criteria

**AC1**
**Given** a deposit document is uploaded and extracted
**When** ingestion completes
**Then** each line that names a known unit is stored as a payment against that unit, and each line
that does not is held — without anyone invoking a second step

**AC2**
**Given** a deposit line naming a unit in a spelling the roll does not use exactly
**When** it is resolved
**Then** it matches through `unit_normalised_number()` and only through it, and a reference that does
not fold to a known unit is held rather than guessed at

**AC3**
**Given** a document that is not a deposit
**When** it is ingested
**Then** nothing is written to `payment` or `held_payment`, and the vendor path behaves exactly as it
did before this story

**AC4**
**Given** the same deposit uploaded twice
**When** it is ingested the second time
**Then** the payments and held lines it produced are replaced, not duplicated — AD-13, through the
real ingestion path rather than through a repository called directly

## Tasks / Subtasks

- [ ] **Task 1 — A unit directory that answers "which unit is this reference"** (AC2)
  - [ ] Extend `core/ports/unit-directory.ts` with a read that takes a raw reference and answers with
        a unit id or nothing. It is a **read**; the port stays incapable of creating a unit, which is
        what stops a deposit inventing one.
  - [ ] The adapter matches on `unit.normalised_number = unit_normalised_number($1)` — the same
        folding, not a reimplementation of it. Assert the query text, as `unit-directory-connection.test.ts`
        already does for its siblings.
  - [ ] **Resolve in one query for the whole document, not one per line.** A CSV bank feed is
        hundreds of lines; a lookup per line is hundreds of roundtrips inside the ingest transaction.
        Fetch the references the document mentions and build the map once.
- [ ] **Task 2 — The extractor emits a unit reference for deposit lines** (AC1)
  - [ ] Teach the extraction path to populate `unitReference`. `validate.ts` already accepts it and
        already refuses it on any kind but `deposit`, so the contract exists — only the producer is
        missing.
  - [ ] Both producers, or say which and why: the Gemini extractor and the tabular reader. A CSV bank
        feed goes through the second, and that is the shape the pilot actually ingests.
  - [ ] A deposit fixture end to end: bytes in, records out, with the reference populated.
- [ ] **Task 3 — Ingestion writes payments** (AC1, AC3, AC4)
  - [ ] Thread a `PaymentRepository` into `extract-document.ts` as a dependency, beside `quarantine`.
        It is the same shape as the vendor hold, which is the precedent to follow rather than invent
        around.
  - [ ] **Only for `deposit` documents.** AC3 is the guard: an invoice must write nothing to either
        table, and the vendor path must be untouched. Assert it — a change that quietly wrote empty
        payment sets for every document would pass every other test here.
  - [ ] The payment write and the extraction write must both land or neither. Decide and record
        whether they share a transaction or are ordered so a failure between them is recoverable —
        `extraction-repository-postgres.ts` records the same hazard for its own state write.
  - [ ] **An entirely-held deposit is a success, not a failure.** Every line unresolved is an ordinary
        outcome, and the document's extraction state must reflect that it was read.
- [ ] **Task 4 — Prove the path, not the parts** (AC1, AC4)
  - [ ] One test that starts at an uploaded deposit and ends with rows in `payment` and
        `held_payment`, going through the real ingestion entry point. This is the test whose absence
        let story 2.4 ship a complete set of green units and no working path.
  - [ ] Re-ingest the same document through that same entry point and assert the counts do not double
        — AD-13 proved where it actually has to hold, not at the repository.
  - [ ] A deposit mixing resolvable and unresolvable lines, since that is the ordinary case and the
        one where a partial write would be least visible.

## Dev Notes

### The lesson this story is built around

Story 2.4 shipped `payment`, `held_payment`, `resolveLine`, a repository and a queue — all tested,
all green, all unreachable. No review caught it: Argus, CodeRabbit's IDE round and two MR rounds each
looked at code that was correct in itself.

**A green unit test proves a part works. Only a test that runs the path proves the parts are
connected.** Task 4 exists before Tasks 1–3 in importance, and if time runs short it is the one to
keep.

### What 2.4 hands over

- `payment`, `held_payment` (migrations 015–018), both `numeric(14,2)`, both cascading from
  `document`.
- `resolveLine(line, lookup)` — pure, holds rather than guesses, and holds rather than crashing on an
  amount `payment` cannot store.
- `PaymentRepository.replace(documentId, lines)` — one transaction, both tables, locks the parent
  `document` row, refuses an entirely empty reading.
- `HeldPaymentQueue` — read-only, on the reader connection.
- `HOLD_REASONS`: `unknown-unit`, `missing-reference`, `missing-amount`, `missing-date`,
  `unsupported-amount`.

### Learnings that apply directly

Twelve guards that proved nothing were found across epic 2, most written while fixing a previous one.
The shapes most likely here:

1. **A test that counts rather than checks.** Row counts pass against an insert that wrote nulls into
   every column.
2. **`toThrow(SomeType)` cannot tell a contract from a crash.** Assert the message.
3. **A guard nothing can reach.** If no test can force a branch, delete the branch.
4. **Choose values that discriminate.** `Number('83.34') * 100` is exactly 8334; `0.29` is not.
5. **Read the file count in the test summary.** The suite silently under-ran twice in this project,
   reporting green with three files uncollected.

### Testing standards

- Gate: `npm run lint`, `npm run build`, `npm test`, `npm run test:db`, and
  `npx --no-install tsc --noEmit` against its **baseline of 8**. Quote the numbers from the run, not
  from memory — three commit messages in epic 2 carried counts that were wrong.
- Per-file `RUN_PREFIX` on anything writing to a shared table.

### References

- `_bmad-output/implementation-artifacts/2-4-deposits-become-payments.md` — the predecessor and the
  source of everything this story wires up.
- `core/ingestion/extract-document.ts` — the orchestration this story extends.
- `core/ingestion/hold-unknown-vendors.ts` — the precedent for a hold path inside ingestion.

## Dev Agent Record

### Agent Model Used

### Test Design

### Debug Log References

### Review Findings

### Completion Notes List

### File List

### Change Log

- 2026-08-08 — Story created, after story 2.4 was found to have built the payment ledger without
  connecting it to upload. Verified by search that nothing calls `createPaymentRepository`,
  `resolveLine` or `createHeldPaymentQueue` outside their own tests. Status -> ready-for-dev.
