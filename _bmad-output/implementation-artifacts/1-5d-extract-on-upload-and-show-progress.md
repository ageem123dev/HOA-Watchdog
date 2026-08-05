# Story 1.5d: Extract on upload and show progress

Status: backlog

> **Fourth of four stories from epic story 1.5.**
> **1.5** built the deterministic path and the shared foundation. **1.5b** stores records and wires
> extraction into ingestion. **1.5c** builds the provider path and proves it — the port, the adapter,
> AD-9's schema enforcement, the AD-10 guard and the connectivity probe.
> **This story makes an upload actually use it**, and shows the treasurer what is happening.
>
> Split out of 1.5c on 2026-08-04. 1.5c ends at a validated collection in memory; nothing an ordinary
> upload does reaches it yet. That gap is this story, and it is named rather than left implied.

**Depends on 1.5c.** Do not start until it is merged — this story calls the port that story defines.

## Story

As a treasurer,
I want a scanned invoice I upload to be read without me waiting on a frozen page,
so that I can see what the system is doing and know when my figures are actually recorded.

## Acceptance Criteria

**AC1 — A PDF or image uploaded through the ordinary path ends up with its records stored**

**Given** an uploaded PDF or image that the provider reads successfully
**When** extraction completes
**Then** **every record** in the validated collection is stored against that document, through the
repository 1.5b built
**And** the document moves from *held, not yet read* to *read*

**AC2 — The deterministic path never reaches the model**

**Given** an uploaded CSV or Excel file
**When** ingestion runs
**Then** its records come from 1.5's deterministic parser
**And** **no provider call is made for it** — 1.5's guarantee must survive this story, proven by a
test that fails if the model becomes reachable for a tabular type

**AC3 — The four durable states are distinguishable, and "no rows" is never success**

**Given** any uploaded document
**When** the surface renders it
**Then** it shows exactly one of *held, not yet read*, *read*, *could not be read*, or
*provider unavailable*
**And** *provider unavailable* is presented as retryable and not the document's fault, distinctly
from *could not be read*
**And** a document with no extraction rows is never presented as successful

**AC4 — Progress is staged and never partial**

**Given** extraction in progress
**When** the treasurer watches it
**Then** progress is a staged, named state (UX-DR12) announced in a live region (UX-DR20)
**And** **partial extraction is never displayed under any state** (UX-DR12, verbatim)

## Tasks / Subtasks

- [ ] **Wire the provider path into ingestion** (AC: 1, 2)
  - [ ] PDF and image route to the provider; CSV and Excel keep 1.5's deterministic path with no model call
  - [ ] A test proves the model is not reachable for tabular types — the guarantee of 1.5 must survive this story
  - [ ] Store through 1.5b's `ExtractionRepository.replace`, which is already transactional and refuses an empty set. Do not add a second way to write records
  - [ ] **`provider unavailable` is not `unreadable`.** One is retryable and not the document's fault; the other says the scan is bad. 1.5b made exactly this mistake with `failed` and had to add `figures-not-stored` — do not repeat it

- [ ] **A durable extraction state on `document`** (AC: 1, 3) — *raised in review of 1.5c, MR !10*
  - [ ] **The four states are not currently representable.** `document` has no state column, and
        `ExtractionRepository.replace` touches only extraction rows. Extraction rows alone cannot
        tell *held, not yet read* from *provider unavailable* from *could not be read* — all three
        are "no rows". AC3 says a document with no rows is never successful, and today nothing can
        express that
  - [ ] A migration adding the state, with the same `check` discipline as migration 006 — a closed
        vocabulary the database enforces, not a free-text column
  - [ ] **One transaction boundary** covering the state transition *and* the record replacement, so
        `read` is committed only with a complete validated set and neither failure path can leave a
        state that disagrees with the rows
  - [ ] Do **not** reuse `failed`: its copy tells the treasurer the document was not saved, which is
        exactly the mistake 1.5b had to correct by adding `figures-not-stored`

- [ ] **Deferred extraction** (AC: 1, 3)
  - [ ] 1.5c decided: store first, extract on a follow-up request the surface polls. No queue — that remains out of scope and is not to be added without asking
  - [ ] The follow-up endpoint is authenticated and authorises the document against the caller. An endpoint that extracts any document by id is an access-control hole wearing a progress bar
  - [ ] **Claim the document before calling the provider** — *raised in review of 1.5c, MR !10*.
        1.5b's parent-row lock is taken *inside* `replace`, which is the wrong side of the expensive
        call: two polls can both reach the provider, both get an answer, and then serialise their
        writes so that one silently overwrites the other. The claim must happen **before** extraction
        starts. A poll that loses the claim returns the current state rather than starting a second
        extraction
  - [ ] Keep *held, not yet read* as the durable running state, or use a separate non-durable claim.
        **Do not add `extracting` as a fifth durable state** — a crash mid-extraction would strand
        documents in it with nothing to move them out
  - [ ] Define the transitions between the four states explicitly: held → extracting → read *or*
        could not be read; held/provider unavailable → extracting on retry; and *provider
        unavailable* must never collapse into *could not be read*

- [ ] **Surface: staged extraction progress** (AC: 3, 4)
  - [ ] UX-DR12's staged named extraction-progress state
  - [ ] Live region for progress (UX-DR20)
  - [ ] **Partial extraction is never displayed under any state** (UX-DR12, verbatim)
  - [ ] Tokens only — `core/design/no-raw-values.test.ts` enforces this
  - [ ] Copy for *provider unavailable* asks for nothing from the treasurer, as `figures-not-stored` does

## Dev Notes

### What 1.5c hands over

| Thing | Where | Note |
| --- | --- | --- |
| The extractor port | `core/ports/extractor.ts` | Bytes + media type → a collection of records, or a refusal |
| The adapter | `adapters/extraction/` | The only place the provider is constructed |
| Schema enforcement | the adapter | `responseMimeType` + `responseSchema`, revalidated by `core/extraction/validate.ts` |
| The AD-10 guard | `core/security/` | Distinct credentials, distinct origins, distinct deploy units |
| The probe | `scripts/verify-extraction.mjs` | The only thing proving AD-9 end to end |

The port distinguishes **"the provider was unreachable"** from **"the provider answered and the
answer was invalid"** as different return values. This story is why that distinction exists.

### What 1.5b hands over

`ExtractionRepository.replace(documentId, records)` — a single transactional delete-then-insert that
locks the parent `document` row, refuses an empty set, and leaves a previous set untouched when
anything fails. It is the only way records are written. The outcome vocabulary already carries
`stored-not-read`, `read`, `unreadable`, `already-held`, `figures-not-stored` and `failed`.

**`upload-feedback.ts` has an exhaustive `never` guard.** A new outcome becomes a compile error rather
than a blank row beside a filename — the one gate in this project that reliably catches a missing
case, since neither ESLint nor Vitest type-checks.

### Testing standards

`bmad-dev-tdd` applies, with the Step 9 sensitivity check on each task's load-bearing assertion.

**This story's exposure is the same one 1.5c names**: the provider is faked in every unit test, and a
fake returns whatever the test asks for. A test that stubs the provider and asserts the record was
stored proves the plumbing and nothing else. Use 1.5c's captured real reply as the fixture where the
question is *what the provider produces*, and keep fakes for *what this code does with it*.

**Known gap, inherited and worth restating:** `verify:database` runs in CI only when
`WATCHDOG_WRITER_DATABASE_URL` and `WATCHDOG_READER_DATABASE_URL` are set as protected masked
variables. They are not, so a green pipeline may have executed none of the persistence tests. Say so
in the MR rather than implying coverage.

### Project Structure Notes

```text
core/ingestion/ingest.ts             # UPDATE — route PDF and image to the port
core/ports/extractor.ts              # READ ONLY — defined by 1.5c
app/upload/                          # UPDATE — staged progress, the four states
app/api/                             # NEW — the follow-up extraction endpoint
```

`core/` imports nothing outward — `core/ports/boundary.test.ts` enforces it.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5] — ACs 1, 4
- [Source: epics.md#UX-DR12] and #UX-DR20 — extraction progress, live regions
- [Source: ARCHITECTURE-SPINE.md#AD-13] — content-hash idempotency and replacement
- [Source: 1-5c-extract-structured-records-from-pdfs-and-images.md] — the port and the state table
- [Source: 1-5b-store-extracted-records-and-complete-ingestion.md] — the repository, the outcome vocabulary, and the `failed` mistake not to repeat

## Dev Agent Record

### Agent Model Used

### Test Design

### Debug Log References

### Completion Notes List

### File List

### Change Log
