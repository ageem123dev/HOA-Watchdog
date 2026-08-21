---
Status: done
baseline_commit: 67acbd5
merge_request: 78
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

- [x] **Task 1 — Read the headings.** A function over the same rectangle, returning headings in
      order with their positions and both forms. No document kind, no ingestion. (AC1, AC6)
- [x] **Task 2 — Report duplicates and blanks, all of them.** Accumulated, not short-circuited.
      (AC2, AC3, AC4)
- [x] **Task 3 — Distinguish the empty cases.** No rows, no header row, all-blank header row.
      (AC5)
- [x] **Task 4 — Reach it from an upload.** A sample is uploaded and its headings come back. Where
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

#### Tasks 1-3 - failure modes of reading headings

The interesting ones are all *reporting* failures. A reader that refuses is loudly wrong; a reader
that reports the wrong thing is quietly wrong, and the treasurer acts on it.

| # | Failure mode | Class |
| --- | --- | --- |
| 1a | Positions reported 0-based, so a message names a column the treasurer cannot count to | GUARD - 1-based, asserted directly |
| 1b | The written text discarded and the normalised form reported, sending the treasurer to look for a column their file does not contain | GUARD - both forms carried, and a padded mixed-case fixture proves they differ |
| 2a | Duplication decided on the written form, so `Amount` and `amount ` read as distinct and the file is called fine | GUARD - decided on the matched form, which is what collides at ingestion |
| 2b | A heading duplicated three times reported twice, as though it were two problems | GUARD - one report per heading, every position listed |
| 3a | A blank heading dropped from the list, so it is a column the treasurer cannot map and is never told about | GUARD - reported, and still present in the headings |
| 4a | Only the first problem reported, so a fixed duplicate is followed by a newly-revealed blank and a second upload | GUARD - a fixture with both, asserting both |
| 5a | `no-rows` and `no-headings` collapsed into one reason, sending a treasurer to neither place | GUARD - distinguished, and each asserted |
| 5b | "refuses an empty header row" passing against a reader that refuses everything | GUARD - the inverse in the same block: one named column is readable |

### Completion Notes List

- **Reporting, not refusing, is the whole design.** A file with problems still yields its headings;
  only a file with no headings at all is refused, because there is then nothing to report.
- **Duplication is decided on the normalised form and reported with the written one.** Those are
  different jobs: the match is what would collide at ingestion, the text is what the treasurer can
  find in their spreadsheet. Mutating either direction turns the suite red.
- **The stub came first.** A missing-module error is not a valid red - it says nothing about the
  assertions - so `headings.ts` was written with real signatures and empty bodies. 16 of 17 then
  failed on their own assertions. The one that passed was "finds no problems in a clean file",
  which an empty stub satisfies, and that is worth noticing rather than counting as coverage.
- **Eight mutations, eight caught**: 0-based positions, duplication on the written form, blanks
  dropped, only-the-first-problem, duplicates not reported, an all-blank row accepted, `no-rows`
  folded into `no-headings`, and the written text discarded.

#### Task 4 - the decision, recorded before it was built

**A sample does not go through `ingest`, and there are two independent reasons.**

*It must not.* `ingest` stores the document, hashes it for AD-13 idempotency, writes a provenance
row and resolves vendors. A sample is uploaded so a treasurer can be shown its columns and then
build a mapping. It is not a document the association is keeping, and one landing in `document`
would sit in the permanent record - and in the register a board reads - because somebody wanted to
see their own column names.

*It cannot.* Story 5.2 made a declared `documentKind` mandatory for ingestion, and a sample has
none. The mapping is what the kind is for.

**So the shared half was extracted rather than copied.** `toRectangle` is now the one place that
knows how bytes become rows, and it publishes `TABULAR_CONTENT_TYPES` so neither caller holds its
own list. `ingest` uses it too - its 389 tests pass unchanged, which is the evidence the refactor
preserved behaviour rather than the claim.

Two copies would have drifted, and silently: a format accepted for ingestion but missing from the
sample path is one a treasurer can upload and then cannot build a mapping for, with nothing saying
why.

**What is deliberately not here: the HTTP surface.** A server action with nothing rendering it is
exactly the shape that shipped broken in 5.2 - an action requiring a field no form sent, with every
gate green. The action lands with the screen that calls it, in 5.4.

#### A distinction the composition was about to throw away

`readSampleHeadings` first reported an empty file as `unreadable-file`, and the test I had written
said `no-rows`. The reflex is to correct the test. **`parseCsv` already distinguishes `empty` from
malformed** - `toRectangle` was flattening it - so the test was right and the code was losing
information that existed.

Kept apart as `empty-file`, because *"your file is empty"* and *"your file could not be read"* send
a treasurer to different places, and the second is actively misleading about the first: it invites
them to re-export a file that exported perfectly well. `ingest` still folds both into its existing
`unreadable-file` outcome, on purpose - a document with nothing in it is as unstorable as one that
would not parse - and that fold is now written down rather than incidental.

#### Sensitivity

Fourteen mutations across the three modules, all caught: eight on `readHeadings` (0-based positions,
duplication on the written form, blanks dropped, only-the-first-problem, duplicates unreported, an
all-blank row accepted, `no-rows` folded into `no-headings`, the written text discarded) and six on
the composition (empty folded into unreadable, `no-reader` folded into unreadable, an unknown type
read as an empty rectangle, problems dropped, headings dropped, and `ingest` losing its `no-reader`
distinction - which turns 10 of its own tests red).

Also worth recording: the `TABULAR_CONTENT_TYPES` round-trip test **passed against an empty list**
when first written, because a loop over nothing reports success. It now asserts the list is
non-empty first.

### Review Findings

#### The AC audit (step 4c)

| AC | Test | Mutation that turns it red |
| --- | --- | --- |
| 1 - same rectangle, CSV and workbook | `rectangle.test.ts` CSV and xls/xlsx cases | an unknown type read as an empty rectangle - 11 red |
| 2 - duplicates named | `names a duplicated heading and where it occurs` | duplicates not reported - 4 red |
| 3 - blanks named by position | `names the position of an empty heading` | blanks dropped - 5 red |
| 4 - every problem at once | `reports a duplicate and a blank together` | only-the-first-problem - 1 red |
| 5 - empty cases distinguished | the three refusal cases | `no-rows` folded into `no-headings` - 1 red; all-blank row accepted - 2 red |
| 6 - written and matched forms | `reports a heading as written and as matched` | the written text discarded - 1 red |

#### The local CodeRabbit round - three findings, three confirmed

`review_completed`, 9 of 9 diff files, coverage reconciled. All three were real, and all three were
defects this story introduced.

**1 (major) - two copies of the folding.** `headings.ts` and `tabular.ts` each defined
`trim().toLowerCase()`. Identical today; the risk is the day one changes, and the symptom then is a
wizard reporting columns the importer treats as something else - worse than either behaviour alone.
`normaliseHeading` is exported and `tabular` imports it.

**The behavioural test could not see the sharing**, which is worth recording: it asserts the folding
is *correct*, and a `tabular.ts` that quietly kept its own identical copy would pass. So a
structural check reads the source and refuses a second definition, in the shape
`test_no_data_credentials.py` uses for AD-3 - the property is structural, so the check is too.
Reverting `tabular` to its own copy turns it red.

**2 (major) - the content type was not canonicalised.** `acceptance.ts` has folded
`text/csv; charset=utf-8` since epic 1, and `ingest` passes the already-folded value - so
`toRectangle` never met a raw one until this story added a second caller. A sample arrives straight
from a form. Unnormalised, **every CSV a browser labels with a charset would have come back
`no-reader`**: "we cannot read this format", about the format the wizard exists to read.

Canonicalised in `readSampleHeadings`, where the raw value arrives, rather than inside
`toRectangle` - `ingest` already folds at its own boundary, and normalising twice would hide which
caller was responsible.

**3 (minor) - a vacuous assertion written while preventing vacuity.** The "needs no store" test
asserted `readSampleHeadings.length <= 2`. `Function.length` counts parameters *before* the first
default, so it reads 1 here and would keep reading 1 however many dependencies were added after
`deps`. Replaced with the observable property: the call succeeds given nothing but a file.

**Ingest scored it as two Argus misses** - `argus_ingest` on `2e57e28` wrote the lesson *"Look
harder in TypeScript under core/extraction/** for input validation."* Argus had reviewed this exact
code twice and found neither, which is the whole reason both reviewers run.

#### A direction worth watching

`core/extraction/sample-headings.ts` now imports from `core/ingestion/acceptance.ts`, which is the
reverse of the usual direction here - `ingest` imports extraction, not the other way about. There is
**no cycle today**: `acceptance.ts` imports nothing at all, and `core/ports/boundary.test.ts` passes
(it enforces that `core/` imports nothing outward, which this respects).

Recorded rather than resolved, because the alternative was a third copy of a five-line MIME fold and
that is the defect this round was about. The latent trap is real though: an import of `extraction`
added to `acceptance.ts` would close the loop.

### File List

- `core/extraction/headings.ts` *(new)* - `readHeadings`, the reporting reader
- `core/extraction/headings.test.ts` *(new)* - 17 cases
- `core/extraction/rectangle.ts` *(new)* - `toRectangle` and `TABULAR_CONTENT_TYPES`, the one place
  that knows how bytes become rows
- `core/extraction/rectangle.test.ts` *(new)* - 11 cases
- `core/extraction/sample-headings.ts` *(new)* - the composition, taking no store and no kind
- `core/extraction/sample-headings.test.ts` *(new)* - 9 cases
- `core/ingestion/ingest.ts` - `read` now uses the shared dispatch; behaviour unchanged
- `core/extraction/tabular.ts` - imports the shared `normaliseHeading` instead of defining one
- `core/ingestion/acceptance.ts` - `normalizeContentType` exported for the sample boundary

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-21 | Task 4: a sample is read without being stored; the bytes-to-rows dispatch is shared with ingest rather than copied |
| 2026-08-21 | Local CodeRabbit round: three findings, three confirmed - a duplicated folding, an uncanonicalised content type, and a vacuous arity assertion |
| 2026-08-21 | Status done, written in this commit rather than after the merge |
| 2026-08-21 | Tasks 1-3: readHeadings reports duplicates and blanks by position, all at once, and distinguishes the empty cases |
| 2026-08-21 | Created from epic 5's story spine, with the sample-is-not-a-document decision flagged for Task 4 |
