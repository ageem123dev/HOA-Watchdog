---
Status: ready-for-dev
baseline_commit:
merge_request:
---

# Story 5.2: A document declares its kind

## Story

As **a treasurer uploading a file**,
I want **to say what kind of document it is when I upload it**,
so that **a mapping can be "for deposits" — which it cannot be if the file decides row by row**.

## Why this is its own story

From the epic's three decisions, taken 2026-08-18:

> **Document kind becomes a property of the file, not the row.** Today `type` is an optional column
> read per row, defaulting to `statement`, and one file may mix kinds. The wizard's premise — *one
> example per document kind* — makes that untenable: a mapping cannot be "for deposits" if the file
> decides row by row. The upload declares its kind and the mapping is keyed on it. This is a change
> to `core/extraction/tabular.ts` and to the published upload contract, so it is a story of its own
> rather than a detail inside another.

**It is a contract change, and the contract is published.** `docs/upload-contract.md` is the
document a treasurer is pointed at, and `docs/upload-contract.test.ts` holds it to the code. Every
story from 5.3 onward keys its mapping on the kind, so a per-row `type` surviving into 5.4 would
make "the mapping for deposits" a phrase with no referent.

## Acceptance Criteria

1. **The kind arrives with the upload, not in the rows.** `readTable` and `readRows` take the
   document kind from their caller. A file whose kind is not declared cannot be read at all — there
   is no default standing in for a missing declaration, because a default *is* the per-row rule
   moved somewhere quieter.

2. **The `type` column is gone, and a file still carrying one is told so.** Removed from
   `OPTIONAL_HEADERS`. A file with a `type` header is **refused with a reason naming it**, not
   silently ignored: an ignored column is a treasurer believing their file said something it did
   not, which is the same "safe but silent" failure story 5.1c refused for `actorId`.

3. **One file is one kind, everywhere that used to ask a row.** The roll-header pre-check, the
   `unit` gating (`KINDS_WITH_UNIT_REFERENCE`) and the roll-row branch all read the declared kind.
   A test proves a file declared `assessment_roll` produces roll rows and one declared `statement`
   produces none, from **the same bytes**.

4. **The upload surface declares the kind.** `app/upload` sends it; a submission without one is
   refused before any file is read. The failure is a sentence a treasurer can act on, not a schema
   error.

5. **The published contract says all of this**, and `docs/upload-contract.test.ts` fails if the
   document and the code disagree. The "One file may mix kinds row by row" sentence and the `type`
   row in the optional-columns table are gone.

6. **The samples still work as samples.** `samples/assessment-roll.csv` and `samples/deposits.csv`
   carry a `type` column today. They are regenerated without it, `scripts/build-samples.mjs` no
   longer writes it, and `samples/samples.test.ts` passes — **see the trap in Dev Notes before
   touching them.**

## Tasks / Subtasks

- [ ] **Task 1 — The kind becomes a parameter.** `readTable`/`readRows` require it; `kindOf` and
      `DEFAULT_DOCUMENT_KIND` are deleted rather than defaulted. Every internal read of the row's
      kind becomes the declared one. (AC1, AC3)
- [ ] **Task 2 — Refuse a file that still carries `type`.** A named reason in `TABULAR_PROBLEMS`,
      not a silent drop. (AC2)
- [ ] **Task 3 — Thread it through ingest and the upload surface.** `core/ingestion/ingest.ts`,
      `app/upload/actions.ts`, `app/upload/upload-state.ts`. A submission with no kind is refused
      before the file is read. (AC4)
- [ ] **Task 4 — Regenerate the samples.** `scripts/build-samples.mjs` and the four sample files.
      Read the trap below first. (AC6)
- [ ] **Task 5 — Rewrite the contract section.** `docs/upload-contract.md` and its test. (AC5)

## Dev Notes

### The trap: the samples are byte-exact fixtures

`.gitattributes` marks `samples/*.csv` as `-text` **on purpose**, with a comment explaining that a
repo-wide CRLF renormalisation would break them. `scripts/build-samples.mjs` writes them with CRLF
line endings because RFC 4180 specifies them, and `samples/samples.test.ts` compares byte for byte.

So regenerating them is not "edit the header row". Change the generator, re-run it, and let the test
compare — and do **not** let an editor, a script, or a `sed -i` rewrite the line endings on the way
past. This session has already had `sed -i` silently convert three CRLF files to LF; on these files
that would fail as *"the application rejects its own sample"*, which reads as a broken application
rather than a broken checkout.

The `.xls`, `.png` and `.pdf` samples are marked `binary` and are **not** affected by this story —
they go to the model extractor, which never sees a header row (AD-9).

### What reads the kind today

`core/extraction/tabular.ts`:

- `OPTIONAL_HEADERS` includes `'type'` (line ~32);
- `DEFAULT_DOCUMENT_KIND = 'statement'` (~35);
- `kindOf(row)` = `optional(row, 'type') ?? DEFAULT_DOCUMENT_KIND` (~145);
- the roll-header pre-check: `dataRows.some((row) => kindOf(row) === 'assessment_roll')`;
- per row: `documentKind = kindOf(row)`, which gates `unitReference` via
  `KINDS_WITH_UNIT_REFERENCE` and decides whether a `RollRow` is built.

Callers: `core/ingestion/ingest.ts` (`readTable` at ~349, `readRows` at ~356), and the tests
`core/ingestion/reading.test.ts`, `docs/upload-contract.test.ts`, `samples/samples.test.ts`.
`ingest` itself is called from `app/upload/actions.ts` and `app/upload/upload-state.ts`, and from
`adapters/db/deposit-ingestion.test.ts` and `adapters/db/roll-ingestion.test.ts`.

### Why a missing kind must refuse rather than default

AC1 forbids a default, and the reason is worth stating because "default to `statement`" is the
smaller diff. A default is the per-row rule relocated: the file still decides, by omission, and the
wizard still cannot say what a mapping is *for*. It also fails in the direction this project keeps
refusing — quietly, and in a way that looks like it worked.

The same argument produced 5.1c's `actorId` refusal and 5.1b's `associationId` refusal. This is the
third instance of one rule: **a caller that supplies nothing must be told, not served a guess.**

### What this story does not do

Mapping, headers, preview and suggestion are 5.3 through 5.6. This story only moves *where the kind
comes from*. If it starts growing a mapping concept, that is the seam being crossed too early.

### References

- `_bmad-output/planning-artifacts/epics.md` — epic 5's three decisions, and the story spine
- `core/extraction/tabular.ts` — the per-row kind, and everything that reads it
- `docs/upload-contract.md` §"Document kinds" and the optional-columns table
- `docs/upload-contract.test.ts` — holds the document to the code
- `.gitattributes` — why the CSV samples are `-text`
- `_bmad-output/implementation-artifacts/5-1c-the-actor-is-proved-not-relayed.md` — the
  refuse-rather-than-ignore precedent, with its reasoning

## Dev Agent Record

### Test Design

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-21 | Created from epic 5's story spine, with the byte-exact sample fixtures flagged as the trap |
