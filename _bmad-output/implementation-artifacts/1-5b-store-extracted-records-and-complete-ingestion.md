---
baseline_commit: c54185bdb0fcc3158e94caf74e2df12a2307338c
---

# Story 1.5b: Store extracted records and complete ingestion

Status: in-progress

> **Second of three stories from epic story 1.5.**
> **1.5** built the parts and proved them: the `extraction` table, the record vocabulary, the validator, the unreadable outcome, and deterministic CSV and Excel parsing. **None of it is connected** — uploading a spreadsheet today still produces no records.
> **This story connects it**, which is what makes the epic's ACs true.
> **1.5c** then adds the provider path for PDFs and images, writing through the same repository this story builds.

## Story

As a treasurer,
I want the figures the system read out of my upload to actually be recorded,
so that uploading a spreadsheet leaves the association with a ledger rather than a filed document.

## Acceptance Criteria

These are the epic's ACs that 1.5 could not satisfy without persistence, plus the replacement half of AD-13.

**AC1 — A parsed document's records are stored against it**

**Given** an uploaded CSV or Excel file that parses and validates
**When** ingestion runs
**Then** one `extraction` row exists per record read from it
**And** the write happens through the `watchdog_writer` role

**AC2 — A document that cannot be read stores nothing new, and destroys nothing old**

Two cases, because they have different correct outcomes.

**Given** a *new* upload that fails parsing or validation
**When** ingestion runs
**Then** no `extraction` row exists for that document
**And** the document row and its stored bytes are retained, so a fix needs no re-upload
**And** the treasurer is shown the Document Unreadable outcome

**Given** a *re-ingestion* of bytes already held, which then fails parsing or validation
**When** ingestion runs
**Then** the document's existing extraction set is preserved **unchanged**
**And** the treasurer is shown the Document Unreadable outcome

**And** in both cases replacement happens only after a complete set has passed validation —
nothing is deleted until there is something to put back.

**AC3 — Re-ingesting replaces the whole set**

**Given** a document that already has extraction records
**When** the same bytes are ingested again
**Then** every previous record for that document is gone and the new set is present
**And** at no point does the document have a partially replaced set

**AC4 — One document's failure does not affect the batch**

**Given** a batch where one file is unreadable
**When** it is uploaded
**Then** every other file is parsed and stored normally
**And** only the unreadable one reports that outcome

## Tasks / Subtasks

- [x] **Extraction repository** `adapters/db/extraction-repository-postgres.ts` (AC: 1, 3)
  - [x] Writer role, following `document-repository-postgres.ts`
  - [x] `replace(documentId, records)` — delete and insert **in one transaction**, so "never partially replaced" is a property of the code rather than of luck
  - [x] A deterministic concurrency test using the `pg_stat_activity` interleaving technique, **not `Promise.all`**
  - [x] Port in `core/ports/`, since `core/` may not import `pg`

- [ ] **Fill in `replaceDerivedRows`** (AC: 3)
  - [ ] 1.4 left it a called, tested no-op with a comment naming this moment. This is it
  - [ ] **One order, stated once: parse → validate the complete set → replace.** Replacement is a single transactional delete-then-insert taking the whole validated set. It is **never** called on a parse or validation failure, and nothing is deleted until there is something to put back
  - [ ] **Delete the existing call site first.** `ingest.ts` currently invokes `replaceDerivedRows` in the `alreadyHeld` branch, *before* anything is parsed. That call must be removed, not filled in — giving it a body where it stands would delete a document's good records and then fail to replace them
  - [ ] `replaceDerivedRows(documentId)` is therefore the wrong shape: it carries no records. Either widen it to take the set, or drop it and let the repository own replacement outright — and record which

- [ ] **Wire parsing into ingestion** `core/ingestion/ingest.ts` (AC: 1, 2, 4)
  - [ ] Route by content type: CSV and Excel to the deterministic path; PDF and image are **not** handled until 1.5c and must not silently succeed
  - [ ] Order: the `document` row and its bytes are durable **before** parsing begins, so a parse failure never loses the upload
  - [ ] A new per-file outcome for unreadable, alongside 1.4's `accepted` / `already-held` / `rejected` / `failed`
  - [ ] One document's failure cannot fail the batch — the property 1.4 established and this must not regress

- [ ] **Surface** `app/upload/` (AC: 2)
  - [ ] The unreadable-document state, rendering `UNREADABLE_MESSAGE` from `core/extraction/validate.ts`
  - [ ] Distinct from 1.4's unreadable-**file** state: one is a file that would not open, the other a file that opened and could not be read
  - [ ] **Partial extraction is never displayed under any state** (UX-DR12, verbatim)
  - [ ] Tokens only — `core/design/no-raw-values.test.ts` enforces this

## Dev Notes

### What 1.5 already built — do not rebuild

| Thing | Where | Note |
| --- | --- | --- |
| `extraction` table | `migrations/006_extraction.sql` | Many rows per document; `on delete cascade`; index on `document_id` |
| Record vocabulary | `core/extraction/record.ts` | Kinds, currencies, length caps, `numeric(14,2)` precision — parity-tested against the migration |
| Validator + copy | `core/extraction/validate.ts` | Closed problem set; `UNREADABLE_MESSAGE` |
| CSV parser | `core/extraction/csv.ts` | RFC 4180, zero dependencies |
| Header contract | `core/extraction/tabular.ts` | `readTable(text)` → records or problems |
| Excel decoding | `adapters/extraction/workbook-sheetjs.ts` | `readWorkbook(bytes)` → the same rectangle |
| Document repository | `adapters/db/document-repository-postgres.ts` | The pattern to follow, incl. the interleaving test |
| **`replaceDerivedRows`** | `core/ports/document-repository.ts` | Still an empty called seam. **This story fills it.** |

### The one wiring decision to make deliberately

`readTable` takes CSV **text**; `readWorkbook` takes **bytes** and returns rows. They do not currently
share an entry point, because 1.5 had no caller to serve. Decide where routing lives and record it:
either ingestion branches on content type and calls the right pair, or a small function in
`core/extraction/` takes rows and both callers feed it. The second keeps the contract in one place
and is probably right, but it is a decision rather than an obvious default.

### Ordering, which is a safety property

The `document` row and its bytes must be durable before parsing begins. A parse failure then costs
the treasurer nothing: the document is held, and the failure is reported against it.

**Correction to an earlier draft of this note.** It said a corrected export "re-reads under AD-13's
replacement". That is wrong. Document identity is the content hash, so corrected bytes are a
*different* document and `alreadyHeld` never fires for them. AD-13's replacement applies only to
**the same bytes** ingested again. A corrected export produces a second document, and whether the
first should then be superseded is an open question — record it as one rather than assuming the
replacement path already covers it.

### Scope boundaries

| This story | 1.5c | 1.6 |
| --- | --- | --- |
| Store records; wire the deterministic path | The provider path for PDF and image | — |
| The unreadable surface state | Staged extraction progress | Quarantine surface |
| — | AD-9, AD-10, the credential guard | Vendor resolution |

PDF and image uploads are accepted by the gate today but have no extraction path until 1.5c. **They
must not report success as though they were read.**

Name the outcome rather than leaving it to the implementation: a per-file `stored-not-read` that
`ingestOne` returns, the batch preserves, and the surface renders as "held, not yet read". It is not
`accepted`, because nothing read it, and not `failed`, because nothing went wrong. The document and
its bytes are kept, so 1.5c reads them without a re-upload. Test that a PDF upload produces exactly
this outcome and no `extraction` row.

### Testing standards

`bmad-dev-tdd` applies. Database tests belong in `migrations/` or `adapters/db/`, or they skip
silently under `npm test` while reporting green — see 1.5's notes.

**This story must make that skip fail closed, and it is a real gap rather than a tidy-up.** Every AC
here is about persistence, and the tests that prove them only run under `npm run test:db`. Today
that suite skips without credentials and CI's `verify:database` job does not run at all unless
`WATCHDOG_WRITER_DATABASE_URL` and `WATCHDOG_READER_DATABASE_URL` are defined — so the pipeline can
be green having executed none of them, and the story could be called done on the strength of a suite
that never ran. That is the project's characteristic failure at the CI level rather than in a test.

Name the enforcement explicitly: `npm run test:db` must **fail** rather than skip when the database
is unreachable, and the pipeline must run it for this branch. If the variables genuinely cannot be
provided, that is a decision to raise — not a silence to accept.

The characteristic failure of this codebase is a guard that reads as protective and proves nothing;
twelve have now been found. In this story the likely candidates are the transaction boundary (a
"replacement" test that never observes a partial state proves nothing about atomicity) and the
batch-isolation test (one that never makes a real failure happen proves nothing about isolation).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5]
- [Source: ARCHITECTURE-SPINE.md#AD-13] — the replacement half
- [Source: ARCHITECTURE-SPINE.md#AD-4] — writer role for ingestion
- [Source: epics.md#UX-DR12] — partial extraction is never displayed
- [Source: 1-5-read-a-document-into-structured-records.md] — everything this story connects
- [Source: 1-4-upload-a-document-and-see-it-accepted-or-rejected.md] — the repository pattern and the interleaving test

## Dev Agent Record

### Agent Model Used

### Test Design

## Task 1 — the extraction repository

One behaviour, and it is the whole story in miniature: **replace a document's records as a set**.

**Behaviour A — `replace(documentId, records)`**

*If it ran correctly, how would I know?* After it returns, the document's rows are exactly the set
passed in — no survivors from the previous set, no partial mixture — and no other document's rows
moved.

*How am I going to test this?* Against a real database. This behaviour is a transaction boundary,
and a fake proves only that the fake was written to agree. `document-repository-postgres.test.ts`
is the pattern, including its deterministic interleaving technique.

*What else can go wrong?* The dangerous failures here are not wrong values — they are **missing
rows nobody notices**. A ledger that quietly loses three lines from a re-read looks exactly like a
ledger that never had them, and the treasurer has no way to tell.

*Could this problem happen anywhere else?* **It already did, twice.** 1.4's content-hash uniqueness
exists because a read-then-write lets two uploads both insert. And 1.5's first cardinality attempt
had `unique (document_id)`, which would have made this method impossible. Same shape, third
appearance: the database decides, not the application.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| A1 | **Delete and insert in separate transactions.** A crash between them leaves the document with *no* records where it had a full set — the worst outcome available, and invisible | GUARD | Single transaction; a forced failure mid-way leaves the previous set intact |
| A2 | Replacement **appends** instead of replacing, so a re-read doubles every figure | GUARD | After replacing, the row count equals the new set exactly |
| A3 | Replacing document X disturbs document Y | GUARD | Y's rows unchanged, asserted rather than assumed |
| A4 | **An empty set silently wipes a document's records.** `replace(id, [])` is indistinguishable from "extraction found nothing" and would delete a good set | GUARD | Refused — an empty replacement is a caller error, not an instruction |
| A5 | Two concurrent replacements interleave, leaving a mixture of both sets | GUARD | Deterministic interleaving test: hold one uncommitted, poll `pg_stat_activity` until the second genuinely blocks, then commit. **Not `Promise.all`** — that passed against a deliberately racy implementation in 1.4 |
| A6 | A record violating a database constraint aborts mid-insert, leaving a partial set | GUARD | The whole call fails and the previous set survives |
| A7 | An unknown `documentId` silently succeeds, writing nothing | GUARD | Foreign-key violation escapes (`23503`) rather than a quiet no-op |
| A8 | Money loses precision on the way in | GUARD | Cross-check: written and read back as strings, compared by Postgres rather than through `Number` |
| A9 | The port lives in `core/` but needs `pg` | Unrepresentable | Port in `core/ports/`, implementation in `adapters/db/` — `core/ports/boundary.test.ts` enforces it |

**Inverse/cross-check (required).** Write a set, read it back, and assert the round trip preserves
every field — with amounts compared **in the database** (`total_amount = $1::numeric(14,2)`) rather
than through a JavaScript number, which is the conversion the column exists to prevent and which
1.5's review caught me doing.

**Out of scope for this task:** deciding *when* replacement is called (Task 3), the `replaceDerivedRows`
seam (Task 2), and the surface (Task 4).

### Debug Log References

**Task 1 — red.** 13 failing against a stub whose methods throw, 97 baseline untouched. Each failed
on its own assertion rather than on a collection error — the shape a real red should have.

**Task 1 — sensitivity, four mutations, all detected.** The two that matter are the first two,
because they are the failures this method is shaped around:

| Mutation | Failures | Reading |
| --- | --- | --- |
| Split the transaction — delete, then `begin`, then insert | **2** | The atomicity tests are real, not decorative |
| Remove the `rollback` on the error path | **3** | Without it the delete stands and the document is left empty |
| Obey an empty set instead of refusing it | 1 | Precisely the destroy-a-good-set case |
| Append instead of replacing | 3 | |

### Completion Notes List

**Task 1 — `adapters/db/extraction-repository-postgres.ts` and `core/ports/extraction-repository.ts`.**

`replace(documentId, records)` makes the given set the document's complete set. Delete and insert are
**one transaction**, and that is the whole design: separated, a failure between them leaves a
document holding no records where it held a full set — and a ledger missing three lines looks exactly
like a ledger that never had them. Nothing tells the treasurer which happened. The destructive part
and the fallible part therefore share a fate, and the `rollback` on the error path is what enforces
it.

**An empty set is refused, not obeyed.** `replace(id, [])` reads identically to "extraction found
nothing", so obeying it would destroy a good set on a caller's mistake. Clearing a document's records
is a different intention and needs a different method to express it.

`findByDocument` reads `issued_on` as text: letting the driver build a `Date` and formatting it back
introduces a timezone shift, and the record's contract is an ISO calendar date rather than an
instant. Amounts stay strings end to end, and the exactness test compares them **in Postgres**
(`total_amount = $1::numeric(14,2)`) rather than through `Number` — the conversion 1.5's review
caught me making in the equivalent test.

Deliberately out of scope here: when replacement is called (Task 3), the `replaceDerivedRows` seam
(Task 2), and the surface (Task 4).

### Completion Notes List

### File List

**Added**

- `core/ports/extraction-repository.ts` — the port
- `adapters/db/extraction-repository-postgres.ts` — writer-role adapter, transactional set replacement
- `adapters/db/extraction-repository-postgres.test.ts` — 13 tests, requires a database

**Modified**

- `_bmad-output/implementation-artifacts/1-5-read-a-document-into-structured-records.md` — stripped two NUL bytes
- `_bmad-output/implementation-artifacts/1-2-board-member-sign-in.md` — stripped one NUL byte
- `core/extraction/csv.test.ts` — NUL written as the escape `\u0000` rather than embedded raw

### Change Log
