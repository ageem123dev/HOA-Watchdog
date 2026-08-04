# Story 1.5b: Store extracted records and complete ingestion

Status: ready-for-dev

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

- [ ] **Extraction repository** `adapters/db/extraction-repository-postgres.ts` (AC: 1, 3)
  - [ ] Writer role, following `document-repository-postgres.ts`
  - [ ] `replace(documentId, records)` — delete the document's existing rows and insert the new set **in one transaction**, so AC3's "never partially replaced" is a property of the statement rather than of luck
  - [ ] A deterministic concurrency test using the `pg_stat_activity` interleaving technique from 1.4, **not `Promise.all`** — that passed against a deliberately racy implementation once already
  - [ ] Port in `core/ports/`, since `core/` may not import `pg`

- [ ] **Fill in `replaceDerivedRows`** (AC: 3)
  - [ ] 1.4 left it a called, tested no-op with a comment naming this moment. This is it
  - [ ] **Move the call.** `ingest.ts` invokes it in the `alreadyHeld` branch *before* anything is parsed. Give it a body there and a failed re-parse deletes the previous good records and stores nothing in their place
  - [ ] **One operation, after validation.** Replacement takes the complete validated set and does delete-then-insert in a single transaction. Nothing is removed until there is something to put back; on a parse failure the previous set survives untouched
  - [ ] That makes `replaceDerivedRows(documentId)` the wrong shape — it carries no records. Either widen it to take the set or drop it and let the repository own replacement outright, and record which

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
