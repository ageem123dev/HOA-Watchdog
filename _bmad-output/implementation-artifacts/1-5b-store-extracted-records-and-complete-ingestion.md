---
baseline_commit: c54185bdb0fcc3158e94caf74e2df12a2307338c
merge_request: 9
---

# Story 1.5b: Store extracted records and complete ingestion

Status: review

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

- [x] **Retire `replaceDerivedRows`** (AC: 3)
  - [x] 1.4 left it a called, tested no-op with a comment naming this moment. This is it — and the answer is that it should not exist
  - [x] **One order, stated once: parse → validate the complete set → replace.** Replacement is a single transactional delete-then-insert taking the whole validated set. It is **never** called on a parse or validation failure, and nothing is deleted until there is something to put back
  - [x] **Deleted the existing call site.** `ingest.ts` currently invokes `replaceDerivedRows` in the `alreadyHeld` branch, *before* anything is parsed. That call must be removed, not filled in — giving it a body where it stands would delete a document's good records and then fail to replace them
  - [x] `replaceDerivedRows(documentId)` is therefore the wrong shape: it carries no records. Either widen it to take the set, or drop it and let the repository own replacement outright — and record which

- [x] **Wire parsing into ingestion** `core/ingestion/ingest.ts` (AC: 1, 2, 4)
  - [x] Route by content type: CSV and Excel to the deterministic path; PDF and image are **not** handled until 1.5c and must not silently succeed
  - [x] Order: the `document` row and its bytes are durable **before** parsing begins, so a parse failure never loses the upload
  - [x] A new per-file outcome for unreadable, alongside 1.4's `accepted` / `already-held` / `rejected` / `failed`
  - [x] One document's failure cannot fail the batch — the property 1.4 established and this must not regress

- [x] **Surface** `app/upload/` (AC: 2)
  - [x] The unreadable-document state, rendering `UNREADABLE_MESSAGE` from `core/extraction/validate.ts`
  - [x] Distinct from 1.4's unreadable-**file** state: one is a file that would not open, the other a file that opened and could not be read
  - [x] **Partial extraction is never displayed under any state** (UX-DR12, verbatim)
  - [x] Tokens only — `core/design/no-raw-values.test.ts` enforces this

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

## Task 2 — retire `replaceDerivedRows`

**The decision, made rather than deferred.** The story left it open whether to widen
`replaceDerivedRows(documentId)` to take a record set or drop it. **Dropped.** Task 1's
`ExtractionRepository.replace(documentId, records)` already *is* the replacement operation, and it
lives in the repository that owns the table. Keeping a second, emptier one on `DocumentRepository`
would mean two ways to replace derived rows and a document repository that knows about extraction.

**Behaviour B — re-ingesting known bytes destroys nothing before anything is parsed**

*If it ran correctly, how would I know?* Handing `ingest` a document whose bytes are already held
leaves that document's existing extraction untouched at the point the already-held outcome is
returned. Nothing has been deleted, because nothing has been read yet.

*How am I going to test this?* The ports are already injected, so a fake repository records whether
a destructive call was made. The assertion is about a call that must **not** happen, which is worth
naming: a test that something is absent is only meaningful if the same test would notice it being
present. It would — the seam exists today and the test fails against it.

*Could this problem happen anywhere else?* This is the third appearance of *destroy-then-fail* in
this story alone: Task 1's split-transaction, Task 1's empty-set, and now this. Same shape each
time — a destructive step reached before the step that justifies it.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| B1 | **A failed re-parse deletes the previous good set.** The call sits in the `alreadyHeld` branch *before* parsing, so filling it in as 1.4 intended would delete a document's records and then fail to replace them | GUARD | Re-ingesting an already-held document performs no destructive call |
| B2 | The seam stays, empty and inviting, and a later implementer fills it in exactly where it is | Unrepresentable | Removed from the port, the adapter and the call site — there is nothing left to fill in |
| B3 | `DocumentRepository` keeps knowing about extraction rows it does not own | Unrepresentable | Removed by the same deletion |
| B4 | Removing it means re-ingest now replaces nothing at all | OUT-OF-SCOPE | True until Task 3, which calls `ExtractionRepository.replace` after validation for new and already-held documents alike. Recorded so the gap is deliberate rather than forgotten |
| B5 | The `already-held` outcome changes shape and the surface breaks | GUARD | The outcome is unchanged; existing tests for it must stay green |

**On removing a test.** The existing case *"replaces the derived rows rather than leaving them
stale"* asserts a call this task deletes. It is **re-specified, not weakened**: the replacement test
asserts the stronger property — that the destructive call does *not* happen before parsing — and it
fails against today's code, which is what makes it a real test rather than a deletion dressed up.

## Task 3 — wire reading into ingestion

**Behaviour C — a stored document is read, and its records replace whatever it had**

*If it ran correctly, how would I know?* A CSV upload comes back `read` with its figures in the
database. A malformed one comes back `unreadable` with **nothing** stored for it and, on a re-ingest,
its previous set still intact. A PDF comes back `stored-not-read` — held, and honestly labelled.

*How am I going to test this?* Both ports are injected, so the fakes record what was called and in
what order. Ordering is the property under test as much as the outcomes.

*Could this problem happen anywhere else?* This is the fourth *destroy-then-fail* of the story, and
the one with the most surface: replacement must not run until a complete validated set exists.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| C1 | **A failed read wipes the previous set.** Replacement called before validation, or called with a partial set | GUARD | An unreadable re-ingest performs no `replace`; the previous set is untouched |
| C2 | A PDF reports `accepted` as if it had been read, so the treasurer believes figures exist | GUARD | PDF and image yield `stored-not-read` and **no** `replace` call |
| C3 | Parsing runs before the bytes are durable, so a parse failure loses the upload | GUARD, **narrowed after a failed sensitivity check** | What is proven is the *consequence*: an unreadable document still has its row and bytes (`order` ends at `put`, `record`). The literal position of the parse call is **not** proven — see the Debug Log |
| C4 | One unreadable file fails the batch | GUARD | A five-file batch with one bad file returns five outcomes, four of them stored |
| C5 | A repository failure during `replace` is reported as `unreadable`, blaming the file for an outage | GUARD | Distinguished: `failed` for infrastructure, `unreadable` for content |
| C6 | An already-held document is never re-read, so a corrected re-upload of *identical* bytes never refreshes | GUARD | Already-held documents are read and replaced like new ones |
| C7 | A CSV that parses to zero records calls `replace` with an empty set, which Task 1 refuses — surfacing as `failed` rather than `unreadable` | GUARD | Zero-record files report `unreadable`; `replace` is never called with `[]` |
| C8 | Extraction is attempted on a rejected file | Unrepresentable | Rejection returns before any of this |

**The outcome set grows from four to six**, and each new one says something the others cannot:

| Outcome | Means |
| --- | --- |
| `read` | figures stored (replaces `accepted` for files that are read) |
| `stored-not-read` | held, no reader for this type yet — not success, not failure |
| `unreadable` | opened and could not be read into figures; nothing stored, previous set intact |

`already-held`, `rejected` and `failed` are unchanged.

**Inverse/cross-check.** The records handed to `replace` must equal what `readTable` produced for the
same bytes, recomputed independently in the test rather than read back from the fake.

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

**Task 2 — red.** The two existing tests asserted a call this task removes, so they were
**re-specified rather than deleted**: the replacements assert the stronger property — that no
destructive call happens before parsing — and one of them failed against the code as it stood, which
is what makes it a test rather than a deletion dressed up. 1 failed, 21 passed.

**Task 2 — sensitivity.** Putting the destructive call back exactly where 1.4 left it fails
`destroys nothing when the same bytes arrive again`. An assertion that something is *absent* is only
worth anything if it notices the thing being present; this one does.

**Task 3 — sensitivity, and one mutation that exposed my own weak claim.**

| Mutation | Failures |
| --- | --- |
| Replace before reading, as 1.4 had it | **16** |
| Report a PDF as `read` | 2 |
| Store the records even when reading failed | 9 |
| **Parse before storing** | **0 — not detected** |

The last one matters. C3 claimed the tests guard "parsing runs after the bytes are durable", and they
do not: parsing is a pure call with no side effect a fake can observe, so moving it earlier changes
nothing any assertion can see. The `order` array proves `put` → `record` → `replace`, which is a
different claim.

Rather than inject a reader port purely to observe something with no user-visible consequence, C3 is
**narrowed to what is actually proven**: an unreadable document still holds its row and its bytes, so
a corrected export needs no re-upload. That is the requirement the ordering existed to serve, and it
is covered by `keeps the document, so a corrected export needs no re-upload`.

Worth naming plainly: this was a guard that proved less than its description claimed, found because
the mutation was run rather than assumed. Four of them in this story so far.

**Task 4 — a name collision that would have merged two different messages.** Importing
`UNREADABLE_MESSAGE` from `core/extraction/validate.ts` into a module that already had its own
constant of that name silently collapsed FR-1's sentence (a file that would not **open**) and the
extraction sentence (a file that opened and whose **figures** could not be read). Story 1.5
explicitly required they stay distinct. Two tests caught it. Renamed to `FILE_UNREADABLE_MESSAGE`
and `FIGURES_UNREADABLE_MESSAGE`, with a comment on each saying why the other exists.

**Task 3 — the spreadsheet path was checked off before it was tested.** The subtask says "CSV and
Excel to the deterministic path", and the routing existed, but every test through ingestion used a
CSV. Reviewing the checkboxes rather than trusting the edit that set them found it. Four tests added
through the **real** SheetJS adapter — a fake decoder would only have proved the fake agrees with
itself — including a cross-check that the same table as `.xlsx` and as CSV yields identical records.

| Mutation | Failures |
| --- | --- |
| Never consult the decoder, so `.xlsx` falls through to `stored-not-read` | **3** |
| Report a decode failure as `no-reader` rather than `unreadable` | 1 |
| Drop `.xlsx` from the tabular content types | **3** |

Worth naming the shape: a checkbox is not evidence, and the check that caught this was reading the
claims back one at a time. Same lesson as the `Promise.all` concurrency test and C3's narrowed claim
above, in a third form.

### Completion Notes List

**Task 3 — reading wired into ingestion.** Route by content type: CSV in `core/`, spreadsheets
through a `WorkbookDecoder` **port**, since `core/` may not import the vendor library. `readRows` was
split out of `readTable` so both paths meet exactly the same header contract rather than growing a
second set of rules.

Order is the safety property: store, record, **then** read. A document that cannot be read is still
held, so a corrected export needs no re-upload — and replacement is reached only with a complete
validated set in hand, which is what makes a failed re-read leave the previous set untouched.

`already-held` takes precedence over `stored-not-read`, because 1.4's contract is that a treasurer
re-uploading a file is told it is already held rather than told something also true but less useful.

**Task 4 — three new outcomes, each saying what the others cannot.** `read` (figures stored),
`stored-not-read` (held, no reader for this type yet — not success, not failure), `unreadable`
(opened, figures unreadable, nothing stored). The unreadable copy is imported from the extraction
layer that owns it rather than restated, so the two cannot drift.

The 1.4 exhaustiveness guard earned its keep here: adding outcome variants produced a **compile
error** in the feedback switch rather than a blank row in front of a treasurer.

**Task 2 — `replaceDerivedRows` is gone.**

The story left the choice open: widen it to take a record set, or drop it. **Dropped.** Task 1's
`ExtractionRepository.replace(documentId, records)` already is the replacement operation, and it
lives in the repository that owns the table. Keeping a second, emptier one on `DocumentRepository`
would have meant two ways to replace derived rows and a document repository that knows about
extraction rows it does not own.

The call site mattered more than the method. It sat in the `alreadyHeld` branch **before anything is
parsed**, so filling it in as 1.4 intended would have deleted a document's records and then failed to
replace them on a bad re-read. Removed rather than filled — there is now nothing left to fill in,
which is a stronger guarantee than a comment warning against it.

**Re-ingest currently replaces nothing at all.** That is deliberate and temporary: Task 3 calls
`ExtractionRepository.replace` after validation, for new and already-held documents alike. Recorded
so the gap is a decision rather than an omission.

Third appearance of *destroy-then-fail* in this story: the split transaction, the empty set, and this
call site. Same shape each time — a destructive step reached before the step that justifies it.

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

### File List

**Added**

- `core/ports/extraction-repository.ts` — the port
- `adapters/db/extraction-repository-postgres.ts` — writer-role adapter, transactional set replacement
- `adapters/db/extraction-repository-postgres.test.ts` — 13 tests, requires a database
- `core/ports/workbook-decoder.ts` — the spreadsheet port, so `core/` never imports SheetJS
- `core/ingestion/reading.test.ts` — 26 tests covering reading during ingestion

**Modified (Task 2)**

- `core/ports/document-repository.ts` — `replaceDerivedRows` removed
- `adapters/db/document-repository-postgres.ts` — its no-op implementation removed
- `core/ingestion/ingest.ts` — the pre-parse destructive call removed
- `core/ingestion/ingest.test.ts` — two tests re-specified to assert nothing is destroyed
- `adapters/db/document-repository-postgres.test.ts` — the seam's own test removed with it

**Modified (Tasks 3 and 4)**

- `core/extraction/tabular.ts` — `readRows(rows)` split out of `readTable(text)` so the CSV and
  spreadsheet paths meet one header contract rather than two
- `core/ingestion/ingest.ts` — content-type routing, the three new outcomes, replacement after validation
- `core/ingestion/upload-feedback.ts` / `.test.ts` — copy for the new outcomes;
  `FILE_UNREADABLE_MESSAGE` vs `FIGURES_UNREADABLE_MESSAGE`
- `app/upload/actions.ts` — wires the extraction repository and the workbook decoder

**Modified**

- `_bmad-output/implementation-artifacts/1-5-read-a-document-into-structured-records.md` — stripped two NUL bytes
- `_bmad-output/implementation-artifacts/1-2-board-member-sign-in.md` — stripped one NUL byte
- `core/extraction/csv.test.ts` — NUL written as the escape `\u0000` rather than embedded raw

### Review Findings

**F1 — 22 type errors this story introduced, invisible to every configured gate. Fixed.**

`IngestDependencies.extractions` is required, but `ingest.test.ts` never supplied it. Nothing caught
this: ESLint does not type-check, Vitest does not type-check, and `next build` type-checks only the
graph it compiles — **test files are in `tsconfig.json`'s `include` but never checked by any gate**.
Running `npx tsc --noEmit` directly surfaced 30 errors against 8 at the story baseline, so 22 were
mine. The tests still passed because every file in that suite is a PDF or a rejection and so never
reaches extraction — the fake was missing and the gap could not show.

Fixed by giving the suite an `extractions` fake that **throws** rather than one that records. That
turns "no PDF reaches extraction" from an untested assumption into a proven one: mutating `read()` so
PDFs route down the reading path produces **9 failures**. A passive fake would have absorbed the
mutation silently — the same guards-that-prove-nothing shape this project keeps finding.

`npx tsc --noEmit` is now back to the baseline 8 with the identical per-file distribution.

**F2 — 8 pre-existing type errors, reported not fixed.** `core/ports/boundary.test.ts` (7) and
`core/ingestion/upload-limits.test.ts` (1, `TS2532` at line 39). They predate this story and are
outside its scope. **The gap itself is the finding**: type errors in test files are currently
unobservable, and closing it means adding a `tsc --noEmit` gate to `.gitlab-ci.yml` — which cannot go
in this story, because the gate would fail on those 8 the moment it was added. Worth its own story.

**F3 — `.xls` routing verified rather than assumed.** `application/vnd.ms-excel` is accepted at
upload and routed to the decoder, while story 1.5 described the adapter as an xlsx importer — if that
were accurate, a valid legacy `.xls` would be reported unreadable. Probed with a real BIFF workbook
written by SheetJS and read back through `readWorkbook`: it decodes. No defect, and the claim now
rests on having run it.

### Definition of Done

**PASS, with one deviation recorded rather than papered over.**

| AC | Satisfied by |
| --- | --- |
| AC1 — records stored against the document, through `watchdog_writer` | `adapters/db/extraction-repository-postgres.test.ts`; role separation proven in `migrations/extraction.test.ts` (reader may select, may not insert or update) |
| AC2 — unreadable stores nothing new and destroys nothing old | `reading.test.ts` "stores nothing for it", "keeps the document…", "destroys nothing when the re-read fails"; the outcome reaches the treasurer via `upload-feedback.test.ts` |
| AC3 — re-ingest replaces the whole set, never partially | Single-transaction delete-then-insert; "keeps the previous set when the whole call is rolled back mid-flight", "serialises two replacements rather than interleaving them" |
| AC4 — one document's failure does not affect the batch | `reading.test.ts` "carries on past an unreadable file" — five files, one bad, five outcomes |

**Deviation — Retrofitted tests (one task).** The DoD asks that no test be written after the code it
covers. The four spreadsheet tests through ingestion were: Task 3's routing was written and checked
off, and the tests came later, when re-reading the subtask claims found that every ingestion test
used a CSV. They were sensitivity-checked against three mutations (3, 1, 3 failures) so they are
real tests, but they were not red-first, and calling that clean would be the same kind of unearned
claim the story spent four rounds removing from the code.

Gates on this head: lint clean, `next build` compiled, **764 unit passed / 109 skipped**, **109
database passed**. Baseline had no pre-existing failures; none introduced. The 109 skipped are the
database tests under the unit runner, which is by design — they run under `npm run test:db`.

**Not proven by CI.** `verify:database` runs only when `WATCHDOG_WRITER_DATABASE_URL` and
`WATCHDOG_READER_DATABASE_URL` are set as protected masked CI variables. They are not, so the
pipeline can be green having executed **none** of AC1's or AC3's proving tests. They pass locally,
which is where that evidence currently lives.

### Change Log

- 2026-08-04 — Tasks 1-4 implemented test-first. Extraction repository with transactional set
  replacement; `replaceDerivedRows` retired; reading wired into ingestion behind a workbook decoder
  port; the surface given distinct file-unreadable and figures-unreadable copy. Status -> review.
