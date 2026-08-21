---
Status: ready-for-dev
baseline_commit:
merge_request:
---

# Story 5.3: The headers we were given

## Story

As **a treasurer setting up an import**,
I want **to upload a sample of my export and be shown the column headings it actually has**,
so that **the mapping I build next is against my file rather than against what somebody assumed my file looks like**.

## Why this is not `readRows`

`core/extraction/tabular.ts` already reads a header row. It cannot be reused as-is, and the reason
is the whole story:

**It refuses rather than reports.** A file with two columns called `amount` returns
`{ reason: 'duplicate-headers' }` and **names neither of them**. That is right for ingestion — taking
the first or the last is how a figure arrives from the wrong column with nothing to show it happened
— and it is useless to a wizard, whose entire job is to tell the treasurer *which* heading is the
problem so they can fix their export.

**It answers a different question.** `readRows` asks "may this file be ingested?" and stops at the
first thing that says no. The wizard asks "what are this file's columns?", and wants **every**
problem at once: a treasurer who fixes a duplicate and is then told about a blank has been made to
upload twice for no reason.

**It is bound to a document kind.** Reading headings is not. The sample is uploaded to *learn* what
it contains, before a mapping exists to say what it is for.

## Acceptance Criteria

1. **A sample yields its headings, in file order.** CSV and spreadsheet alike, through the same
   rectangle `readRows` uses, so a workbook and a CSV of the same shape produce the same list.
   Order is preserved: a mapping is built against positions a treasurer can see.

2. **Duplicates are reported and named.** Every heading appearing more than once is listed, with
   the positions it occupies. Not refused, not deduplicated, not silently first-wins — a treasurer
   with two `amount` columns is told which they are.

3. **Blanks are reported and named by position.** An empty or whitespace-only heading is a column
   with no name, and its position is the only thing that identifies it. It is reported, not dropped:
   a dropped column is one the treasurer cannot map and is never told about.

4. **Every problem is reported at once, not the first one.** A file with a duplicate *and* a blank
   reports both. This is the direct inversion of `readRows`, and it is why this is its own function
   rather than a flag on that one.

5. **A file with no readable header row says so.** Empty file, no rows, or a header row that is
   entirely blank — each distinguishable, because "your file is empty" and "your headings are all
   blank" send a treasurer to different places.

6. **Headings are reported as written, and matched as normalised.** `readRows` matches after
   `trim().toLowerCase()`; a treasurer needs to see ` Unit ` as they typed it. Both forms are
   carried, and the tests state which is which — a report that silently lower-cases is one the
   treasurer cannot find in their spreadsheet.

## Tasks / Subtasks

- [ ] **Task 1 — Read the headings.** A function over the same rectangle, returning headings in
      order with their positions and both forms. No document kind, no ingestion. (AC1, AC6)
- [ ] **Task 2 — Report duplicates and blanks, all of them.** Accumulated, not short-circuited.
      (AC2, AC3, AC4)
- [ ] **Task 3 — Distinguish the empty cases.** No rows, no header row, all-blank header row.
      (AC5)
- [ ] **Task 4 — Reach it from an upload.** A sample is uploaded and its headings come back. Where
      this surfaces is a decision to record before it is built — see Dev Notes.

## Dev Notes

### The decision Task 4 has to make first

**5.2 established that an upload declares its kind. A sample upload does not have one yet** — the
point of the sample is to build a mapping, and the mapping is what the kind is for. So this cannot
simply reuse `ingest`, which now requires `documentKind` on every file and would demand a
declaration the treasurer is not yet in a position to make.

Nor should it: `ingest` stores documents, hashes them for AD-13 idempotency, writes provenance and
resolves vendors. **A sample is not a document the association is keeping.** Running it through
ingestion would put a file into the record that the treasurer only meant to show us.

Record the choice in this story before building it. The options are a separate action that reads
bytes without storing, or an explicit "sample" concept — but a sample that lands in `document` is
the wrong answer whichever way it is reached.

### What exists

- `core/extraction/tabular.ts` — `readRows` and `readTable`, the normalisation
  (`trim().toLowerCase()`), `REQUIRED_HEADERS`, `OPTIONAL_HEADERS`, and the duplicate refusal that
  names nothing (`{ reason: 'duplicate-headers' }`).
- `adapters/extraction/workbook-sheetjs.ts` — decodes a workbook into the same rectangle, which is
  what lets AC1 hold for spreadsheets without a second reader.
- `docs/upload-contract.md` — the published contract. If this story changes what a treasurer is
  told about headings, that document says so too, and `docs/upload-contract.test.ts` holds it to
  the code.

### What this story does not do

No mapping, no suggestion, no preview, no persistence. 5.4 maps a heading to another, 5.5 previews
the result, 5.6 suggests, 5.7 remembers. **If a "which of our fields does this correspond to?"
concept appears here, the seam has been crossed early** — this story only answers *what headings
does this file have*.

### The trap this epic keeps setting

Story 5.2's samples are byte-exact fixtures with deliberate CRLF endings, and `.gitattributes`
marks them `-text` so nothing renormalises them. If this story adds a sample, it is produced by
`scripts/build-samples.mjs` and never edited in place.

### References

- `_bmad-output/planning-artifacts/epics.md` — epic 5's story spine and its three decisions
- `_bmad-output/implementation-artifacts/5-2-a-document-declares-its-kind.md` — the declared kind,
  and why `ingest` now requires one
- `core/extraction/tabular.ts` — the reader this deliberately does not extend

## Dev Agent Record

### Test Design

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-21 | Created from epic 5's story spine, with the sample-is-not-a-document decision flagged for Task 4 |
