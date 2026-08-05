---
baseline_commit: b369034e84b7df7fd93f1d3a8f65d061447e1d5a
---

# Story 1.5d: Extract on upload and show progress

Status: in-progress

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

- [x] **Wire the provider path into ingestion** (AC: 1, 2)
  - [x] PDF and image route to the provider; CSV and Excel keep 1.5's deterministic path with no model call
  - [x] A test proves the model is not reachable for tabular types — the guarantee of 1.5 must survive this story
  - [x] Store through 1.5b's `ExtractionRepository.replace`, which is already transactional and refuses an empty set. Do not add a second way to write records
  - [x] **`provider unavailable` is not `unreadable`.** One is retryable and not the document's fault; the other says the scan is bad. 1.5b made exactly this mistake with `failed` and had to add `figures-not-stored` — do not repeat it

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
  - [ ] **The claim needs a specification, not just a mention** — *raised in review of 1.5c, MR !10*.
        Acquisition must be atomic **across application instances**, not merely within one process,
        so it belongs in the database rather than in memory. It carries a **unique owner token**, so
        a claim can only be released by the holder that took it. It **expires**, because a process
        that dies mid-extraction must not hold a document forever, and an expired claim is
        **recoverable** by the next poll. Release is **explicit** on both the success and failure
        paths. A poll that loses the claim returns the current database state and **does not call the
        provider**
  - [ ] **The token fences the write, not just the claim** — *raised in review of 1.5c, MR !10*.
        Expiry creates a second claimant by design, which means the first one is still running and
        may still return an answer. Holding a token at the start is therefore not enough: the owner
        token must be **re-checked inside the finalising transaction** — both the state transition
        and `ExtractionRepository.replace` — so a claimant whose claim expired underneath it is
        rejected without touching records or durable state. Without the fence, the slow claimant
        overwrites the fresh result and the system prefers the *staler* of two answers
  - [ ] **`extracting` is a rendered state, not a stored one** — *raised in review of 1.5c, MR !10*,
        which caught this file using it both ways. AC3's four states are what the *database* holds;
        AC4's staged progress is what the *surface* shows while a claim is live. The surface derives
        "extracting" from `held` **plus an active claim**, so a crash leaves a document `held` and
        retryable rather than stranded in a state nothing clears
  - [ ] Define the transitions over the four **durable** states: held → read *or* could not be read
        *or* provider unavailable; provider unavailable → held on retry. *Provider unavailable* must
        never collapse into *could not be read*

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

## Task 1 — the provider path, reachable from ingestion

**Behaviour A — a stored document is read through the provider, or refused in a way that says whose fault it is**

*If it ran correctly, how would I know?* Given a document already stored, the operation fetches its
bytes, sends them through `Extractor`, and either produces a validated collection stored against that
document, or a refusal that distinguishes *the provider could not answer* from *the answer could not
be trusted*. A CSV never reaches the provider at all.

*How am I going to test this?* Every port is injected, so the fake extractor records whether it was
called and with what. The most important assertion in this task is a **negative** one — that the
extractor is not called for tabular types — and a negative assertion is only worth anything if the
same test would notice a call. It would: the fake counts.

*What else can go wrong?* Two shapes dominate. **Misattribution** — fetching the wrong bytes and
storing records against a document they did not come from, which is silent and permanent. And
**blame** — telling a treasurer their scan is bad during a provider outage, which sends them to
re-scan a document that was fine.

*Could this problem happen anywhere else?* The blame shape is the third occurrence in this epic.
1.5b shipped `failed` saying "not saved" when the bytes were saved, and had to add
`figures-not-stored`. 1.5c split the port's refusal into `unavailable` and `invalid` precisely so
this story could tell them apart. This is where that distinction has to survive contact with a
surface.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| A1 | **A CSV or spreadsheet reaches the model.** 1.5's AC2 guarantee, and a per-document cost | GUARD | The fake extractor is asserted **not called** for every tabular content type; the fake counts calls, so the assertion can fail |
| A2 | **`unavailable` collapses into `unreadable`**, blaming the document for an outage | GUARD | A provider refusal of `unavailable` yields a distinct outcome from `invalid`; both are asserted, not just one |
| A3 | **The wrong bytes are fetched**, attaching records to a document they did not come from | GUARD | The key passed to the store is recomputed in the test from the document's own record, not read back from the call |
| A4 | Records are stored when extraction failed | GUARD | `replace` is asserted **not called** on both refusal paths |
| A5 | An empty collection reaches `replace`, which refuses it — surfacing a content problem as an outage | GUARD | Zero records yields `invalid`; `replace` never sees `[]` |
| A6 | The store cannot return the bytes, and this reads as an unreadable document | GUARD | A storage failure is `unavailable`, not `invalid` — the document is fine, the infrastructure is not |
| A7 | Raw bytes or raw text move toward the reasoning side | Unrepresentable | The port returns `ExtractionRecord[]`; there is no free-form field to carry them (1.5c) |
| A8 | A document whose type has a deterministic reader is extracted twice — once by each path | GUARD | Routing is exclusive: a type is tabular **or** provider-backed, never both, asserted over the whole accepted-type list |
| A9 | Two callers extract the same document at once | OUT-OF-SCOPE | Task 3 owns the claim. Recorded here so it is deliberate: this task's operation is not safe to call concurrently and does not pretend to be |
| A10 | Extraction runs at upload time and holds the request open | OUT-OF-SCOPE | 1.5c decided deferred. This task builds the operation; Task 3 decides when it runs |

**Inverse/cross-check.** The records handed to `replace` are compared against what the injected
extractor returned, and the storage key against one recomputed from the document record — both
derived independently in the test rather than read back from the code under test.

### Debug Log References

**Task 1 — red.** 24 failing against a stub whose `extractDocument` throws, so every red was an
assertion failure rather than a missing symbol.

**Task 1 — sensitivity, six mutations, all detected.**

| Mutation | Failures |
| --- | --- |
| Let tabular types reach the provider | **4** |
| Collapse `unavailable` into `unreadable` | 1 |
| Collapse `invalid` into `provider-unavailable` | 1 |
| Fetch a fixed storage key instead of the document's | 1 |
| Allow an empty collection through to `replace` | 1 |
| Treat missing bytes as present | 1 |

**Both directions of the refusal split are asserted**, which matters more than it looks: a test that
only checks `unavailable → provider-unavailable` passes for an implementation that returns
`provider-unavailable` always. Both mutations above are single-test failures precisely because the
opposite assertion exists.

**Two ports had to grow, and it is worth saying why they had not before.** `DocumentStore` was
write-only and `DocumentRepository` could only `record` — nothing had ever read a document back,
because until this story every read happened in the same request that wrote it. Deferred extraction
is the first caller that comes back later, and that is what turns "store it" into "store it and be
able to find it again".

Both return `null` rather than throwing for the absent case. A missing object and an unreachable
bucket are different situations — one means this document can never be extracted, the other means
try later — and a caller that cannot tell them apart tells the treasurer the wrong thing.

### Completion Notes List

**Task 1 — the operation, not yet the schedule.** `extractDocument` reads a held document through the
provider and stores what it says. When it runs is Task 3's decision; this task only had to make the
path exist and make it safe to call.

**The tabular guarantee is checked before the bytes are fetched**, so asking to extract a spreadsheet
costs nothing and — the part that matters — cannot reach the model. Story 1.5's AC2 is a promise that
costs money per document to break.

**Routing is proven exhaustive, not just correct.** A test asserts the tabular set and the
provider-backed set together are exactly `ACCEPTED_CONTENT_TYPES`. A type in neither would be
uploadable and never readable; a type in both could be read twice. Neither list can drift from what
upload accepts without failing that test.

**`provider-unavailable` is broader than its name**, and this is a deliberate consequence of AC3
fixing exactly four durable states. It covers a failed object-store read and a failed write as well
as a provider outage. What the treasurer needs to know is identical in all three: nothing is lost,
this is retryable, and it is not their document. Recorded rather than smoothed over, because the name
will read as narrower than the behaviour to the next person.

### File List

**Added**

- `core/ingestion/extract-document.ts` — deferred extraction: read a held document, store what it says
- `core/ingestion/extract-document.test.ts` — 25 tests, no network

**Modified**

- `core/ports/document-store.ts` — `get`, because nothing had ever read a document back
- `core/ports/document-repository.ts` — `findById` and the `HeldDocument` shape
- `adapters/storage/document-store-s3.ts` — `get`, mapping a missing key to `null` rather than a throw
- `adapters/db/document-repository-postgres.ts` — `findById`, selecting only what extraction needs
- `core/ingestion/ingest.test.ts`, `core/ingestion/reading.test.ts` — fakes widened to the ports

### Change Log

### Completion Notes List

### File List

### Change Log
