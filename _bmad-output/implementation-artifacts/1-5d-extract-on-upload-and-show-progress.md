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

- [x] **A durable extraction state on `document`** (AC: 1, 3) — *raised in review of 1.5c, MR !10*
  - [x] **The four states are not currently representable.** `document` has no state column, and
        `ExtractionRepository.replace` touches only extraction rows. Extraction rows alone cannot
        tell *held, not yet read* from *provider unavailable* from *could not be read* — all three
        are "no rows". AC3 says a document with no rows is never successful, and today nothing can
        express that
  - [x] A migration adding the state, with the same `check` discipline as migration 006 — a closed
        vocabulary the database enforces, not a free-text column
  - [x] **One transaction boundary** covering the state transition *and* the record replacement, so
        `read` is committed only with a complete validated set and neither failure path can leave a
        state that disagrees with the rows
  - [x] Do **not** reuse `failed`: its copy tells the treasurer the document was not saved, which is
        exactly the mistake 1.5b had to correct by adding `figures-not-stored`

- [ ] **Deferred extraction** (AC: 1, 3)
  - [x] 1.5c decided: store first, extract on a follow-up request the surface polls. No queue — that remains out of scope and is not to be added without asking
  - [x] The follow-up endpoint is authenticated and authorises the document against the caller. An endpoint that extracts any document by id is an access-control hole wearing a progress bar
  - [x] **Claim the document before calling the provider** — *raised in review of 1.5c, MR !10*.
        1.5b's parent-row lock is taken *inside* `replace`, which is the wrong side of the expensive
        call: two polls can both reach the provider, both get an answer, and then serialise their
        writes so that one silently overwrites the other. The claim must happen **before** extraction
        starts. A poll that loses the claim returns the current state rather than starting a second
        extraction
  - [x] Keep *held, not yet read* as the durable running state, or use a separate non-durable claim.
        **Do not add `extracting` as a fifth durable state** — a crash mid-extraction would strand
        documents in it with nothing to move them out
  - [x] **The claim needs a specification, not just a mention** — *raised in review of 1.5c, MR !10*.
        Acquisition must be atomic **across application instances**, not merely within one process,
        so it belongs in the database rather than in memory. It carries a **unique owner token**, so
        a claim can only be released by the holder that took it. It **expires**, because a process
        that dies mid-extraction must not hold a document forever, and an expired claim is
        **recoverable** by the next poll. Release is **explicit** on both the success and failure
        paths. A poll that loses the claim returns the current database state and **does not call the
        provider**
  - [x] **The token fences the write, not just the claim** — *raised in review of 1.5c, MR !10*.
        Expiry creates a second claimant by design, which means the first one is still running and
        may still return an answer. Holding a token at the start is therefore not enough: the owner
        token must be **re-checked inside the finalising transaction** — both the state transition
        and `ExtractionRepository.replace` — so a claimant whose claim expired underneath it is
        rejected without touching records or durable state. Without the fence, the slow claimant
        overwrites the fresh result and the system prefers the *staler* of two answers
  - [x] **`extracting` is a rendered state, not a stored one** — *raised in review of 1.5c, MR !10*,
        which caught this file using it both ways. AC3's four states are what the *database* holds;
        AC4's staged progress is what the *surface* shows while a claim is live. The surface derives
        "extracting" from `held` **plus an active claim**, so a crash leaves a document `held` and
        retryable rather than stranded in a state nothing clears
  - [x] Define the transitions over the four **durable** states: held → read *or* could not be read
        *or* provider unavailable; provider unavailable → held on retry. *Provider unavailable* must
        never collapse into *could not be read*

- [x] **Surface: staged extraction progress** (AC: 3, 4)
  - [x] UX-DR12's staged named extraction-progress state
  - [x] Live region for progress (UX-DR20)
  - [x] **Partial extraction is never displayed under any state** (UX-DR12, verbatim)
  - [x] Tokens only — `core/design/no-raw-values.test.ts` enforces this
  - [x] Copy for *provider unavailable* asks for nothing from the treasurer, as `figures-not-stored` does

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

## Task 2 — a durable extraction state

**Behaviour B — the four states exist in the database, and the state never disagrees with the rows**

*If it ran correctly, how would I know?* A document carries exactly one of four states, the database
refuses a fifth, and `read` is never visible while the records that justify it are absent. A document
with no extraction rows is never in a state that renders as success.

*How am I going to test this?* Against a real Postgres, as stories 1.5 and 1.5b did — a check
constraint asserted through a fake is a fake asserting itself. The atomicity claim needs the same
treatment: a transaction rolled back mid-flight, with the state read afterwards.

*What else can go wrong?* The state is a second statement of something the rows already partly say,
so the dominant risk is **disagreement**: `read` with nothing to show, or a full set of records under
`held`. Every path that changes one must change the other in the same transaction.

*Could this problem happen anywhere else?* This is the fourth appearance of the drift shape in this
epic — vocabulary versus SQL in 1.5, schema versus validator in 1.5c, and now state versus rows. Same
answer each time: one definition, and a test that fails when the copies disagree.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| B1 | **`read` is committed without the records that justify it** | GUARD | Replacement sets the state in the *same* transaction; a rollback mid-flight leaves the old state and the old rows |
| B2 | The column is free text and accepts anything | GUARD | A `check` over a closed vocabulary; an invalid value is refused with `23514` |
| B3 | **The TypeScript vocabulary drifts from the SQL** | GUARD | Parity test reading `007_*.sql` and comparing against the exported constant, as 1.5 does for document kinds |
| B4 | Documents that predate the migration have no state | GUARD | `not null default 'held'`, asserted against a row inserted without one |
| B5 | A failed replacement leaves the state advanced anyway | GUARD | The rollback test above, read from a second connection |
| B6 | The reader role cannot see the state, so the surface cannot render it | GUARD | `watchdog_reader` can select it; asserted, since AD-4 makes that grant deliberate |
| B7 | The reader role can *write* it | GUARD | An update as `watchdog_reader` is refused with `42501` |
| B8 | `failed` is reused, whose copy says the document was not saved | Unrepresentable | It is not in the vocabulary, and the `check` refuses it |
| B9 | A state moves backwards — `read` reverting to `held` on a later failure | OUT-OF-SCOPE | Task 3 owns transitions. Recorded so the schema is not mistaken for a state machine: it constrains values, not sequences |

**Inverse/cross-check.** The vocabulary is compared in both directions — every value the TypeScript
constant admits is accepted by the database, and a value it excludes is refused. Neither list is the
other's copy; the SQL is read from disk.

## Task 3 — the claim, and the fence

**Behaviour C — one extraction runs per document, and only the holder may finish it**

*If it ran correctly, how would I know?* Two polls arriving together produce **one** provider call.
The loser gets the current state back and does not call the provider. A claim that expires can be
taken by someone else, and when the original holder eventually returns, its write is **refused**
rather than allowed to overwrite the fresher result.

*How am I going to test this?* Against a real Postgres, with two connections. Acquisition has to be
atomic across processes, so it is a single statement whose `returning` says who won — and that is
only meaningful if two genuine connections race it. A fake cannot demonstrate this at all.

*What else can go wrong?* The expensive call sits between claiming and writing, and every failure
mode lives in that gap. Story 1.5b's parent-row lock is taken *inside* `replace`, which is the wrong
side of it: two polls can both reach the provider, both get an answer, and then serialise only their
writes — so the system pays twice and keeps whichever finished last.

*Could this problem happen anywhere else?* It is the same shape as 1.5b's zero-rows concurrency bug,
found in review: a lock that serialises the cheap part while the expensive part runs twice. The
answer there was to lock the parent row; the answer here is to claim before spending.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| C1 | **Two polls both call the provider.** The lock is taken after the expensive part | GUARD | Two real connections race the claim; exactly one wins, asserted from both sides |
| C2 | A claim is held in memory, so a second instance never sees it | GUARD | Acquisition is one SQL statement; the race test uses two separate connections |
| C3 | **A dead process holds a document forever** | GUARD | Claims expire; an expired claim is taken by the next caller |
| C4 | **The slow claimant overwrites the fresh result.** Expiry deliberately creates a second claimant, so the first is still running | GUARD | The finalising write is fenced on the owner token; a stale token is refused and changes nothing |
| C5 | Anyone can release anyone's claim | GUARD | Release requires the matching token; a wrong token releases nothing |
| C6 | A claim is never released, so a retry waits for expiry that need not happen | GUARD | Release on both the success and the failure path, asserted separately |
| C7 | `extracting` becomes a fifth durable state, stranding documents when a process dies | Unrepresentable | The vocabulary has four values and the check refuses a fifth; "extracting" is derived from `held` **plus a live claim** |
| C8 | A document already `read` is claimed and extracted again | GUARD | Only `held` documents are claimable |
| C9 | The loser calls the provider anyway | GUARD | The losing path is asserted to make **no** provider call and to return the current state |
| C10 | The fence is checked, then the write happens — with a gap between them | GUARD | The check is inside the same transaction as the write, asserted the way Task 2's state change was |
| C11 | Clock skew between instances makes expiry inconsistent | OUT-OF-SCOPE | Expiry is evaluated by the database with `now()`, so there is one clock. Recorded because the obvious implementation — comparing against an application timestamp — would have several |

**Inverse/cross-check.** The claim is asserted from both sides on every property: the winner sees a
row and the loser sees none; the matching token releases and a wrong one does not; the fresh token
writes and the stale token is refused. A guard checked in one direction only passes for an
implementation that always answers that way.

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

**Task 2 — sensitivity, and one mutation that escaped the first attempt.**

| Mutation | Failures |
| --- | --- |
| `replace` never moves the state | 3 |
| **Move the state update to after `commit`** | **0 → 1** |
| SQL vocabulary drifts from the exported constant | 1 |

**The post-commit mutation is the one worth recording.** My first two tests asserted that `replace`
marks a document `read`, and that a failed `replace` leaves it `held`. Both pass with the update
moved *after* the commit — because when `replace` throws it never reaches either statement, so the
state stays `held` either way.

What that arrangement actually breaks is narrower and worse: a crash between the commit and the
update leaves the records committed with the document still reading `held`. That is exactly the
disagreement AC3 forbids, and nothing would ever report it. Observing it from outside would need a
real crash; what *can* be observed deterministically is **where the statement is issued** — on the
transaction's own client, before its commit. The added test asserts that, and the post-commit
version now fails it while passing everything else.

Tenth instance of a guard proving less than its description claimed, and the first found by
mutating for a *crash window* rather than for a wrong value.

**A green that was not green.** `npm run test:db` reported `115 passed | 17 skipped` while a suite
had failed outright — vitest reports a suite whose `beforeAll` throws as skipped tests, and the
grep pattern used throughout this project (`Tests +[0-9]`) does not show the `Test Files … failed`
line that says so. The hook was inserting a board member with `password_hash: 'x'`, which
`board_member_password_hash_format` refuses. Every gate check in this story now greps `Test Files`
as well, because a pattern that cannot see a failed suite is a pattern that reports success for the
wrong reason — which is the story's own subject matter.

**Task 3 (claim mechanics) — sensitivity, five mutations, all detected.**

| Mutation | Failures |
| --- | --- |
| An expired claim is never reclaimable | 1 |
| Claimable regardless of state | 3 |
| Any token may release any claim | 1 |
| The fence is never enforced | 3 |
| The claim survives a successful write | 1 |

**The claim race is tested with two real connections through two repositories on two pools.** A fake
cannot demonstrate atomicity across instances at all — that is the whole property — and a single
connection would serialise the two attempts by accident and prove nothing.

**One thing caught while writing the migration rather than after.** The first draft of 008 added a
`document_claimable_idx` on `(uploaded_at) where extraction_state = 'held'` — byte-for-byte the
predicate migration 007 already indexes. A duplicate index costs a write on every insert and update
to that column and answers no query the first one cannot. Removed, with a comment saying why nothing
is indexed there, so the absence reads as a decision rather than an oversight.

**Task 3 (wiring) — sensitivity, four mutations, all detected.**

| Mutation | Failures |
| --- | --- |
| Claim after the provider call rather than before | 1 |
| Drop the fence on the record write | 1 |
| Drop the fence on the state write | 1 |
| Never release the claim on a failure | 1 |

**A hole found while writing the tests, not after.** The fence was on `replace` only. Marking a
failure state is also a write, and the sequence that breaks it is the same one in reverse: A's claim
expires, B claims and succeeds, then A returns with a *failure* and marks the document unreadable —
overwriting a success with a stale failure. `markExtractionState` now takes the same fence, and a
mutation removing it fails a test.

**One piece of tidying worth naming.** `StaleExtractionClaimError` was first declared in the
extraction adapter and imported by the document adapter — adapter reaching sideways into adapter for
what is really a domain rule. Moved to `core/ports/document-repository.ts`, which both import from.
"You no longer hold this" is a rule of the claim, not a detail of Postgres.

**Task 3 (endpoint) — sensitivity, five mutations, all detected.**

| Mutation | Failures |
| --- | --- |
| No authentication at all | **7** |
| Loose session check (`!== undefined`) | 3 |
| No uuid validation | 5 |
| 503 for a provider outage | 2 |
| 404 becomes 200 | 1 |

**A gap in my own earlier work, found by writing the endpoint.** Task 3's first half made only `held`
documents claimable, which quietly made `provider_unavailable` **terminal** — a document could be
lost permanently to one bad afternoon at the provider, and the story's required transition
(*provider unavailable → held on retry*) was impossible. Claiming now accepts it and returns the
document to `held`, so there is one running state rather than two. The test that asserted
`provider_unavailable` was unclaimable was **wrong**, not the code, and it is replaced by two that
assert the retry works.

**A parse error worth recording**, because it is a variant of a hazard this project keeps meeting: an
SQL comment written inside a template literal contained backticks, which terminated the literal.
Same family as the NUL and backspace bytes — content that means one thing to a reader and another to
a parser. Swept the adapters for the pattern; this was the only instance.

**Task 4 — sensitivity, five mutations, all detected.**

| Mutation | Failures |
| --- | --- |
| Show a record count on success | 2 |
| Outage copy blames the document | 2 |
| Outage copy asks for an action | 1 |
| `in-progress` reported as settled | 1 |
| Outage and unreadable share a status | 1 |

**Two design tokens invented and caught before they shipped.** The first draft of
`extraction-status.tsx` styled itself with `--space-tight`, `--weight-medium`, `--size-detail` and
`--color-text` — none of which exist. `core/design/no-raw-values.test.ts` would not have caught it:
it fails on raw colour and type *values*, and a `var(--invented)` is neither. What catches it is
reading the token file, which is the check that should have come first. Replaced with the two tokens
the results table already uses for exactly this pair, so one surface does not end up with two
vocabularies for the same distinction.

### Completion Notes List

**Task 4 — "partial extraction is never displayed" is a property of what the surface can see.** The
endpoint returns a state and never a record, so `ExtractionStatus` has no figure, vendor name or
running count available to render even by mistake. A test asserts no rendered string contains a digit
for any outcome — including the successful one, where "3 figures recorded" would read as a result the
treasurer can check and there is nowhere to check it.

**The outage copy asks for nothing.** `provider-unavailable` says the document could not be read just
now and will be read shortly. It does not say "try again": that would make our outage the
treasurer's errand, and it is the mistake story 1.5b shipped in `failed` and had to undo. Tests
assert it neither blames the document nor requests an action, and that it reads differently from
`unreadable` — if those two render alike, the distinction this whole story is built around never
reaches the person it is for.

**Polling stops.** The component stops when the outcome settles, caps its attempts so a tab left open
on a stuck document stops asking, and checks for unmount *after* the await rather than before it. A
failed request leaves the last known state on screen rather than replacing it with an error about our
own connectivity.

**Not covered, and deliberately.** There are no component-rendering tests: the live region, the
polling lifecycle and the unmount behaviour are asserted only by reading the code, because a
rendering test needs `@testing-library/react` and `jsdom`, and adding dependencies is a decision for
the repository owner rather than something to slip into a story. The decision logic those tests would
exercise lives in `core/ingestion/extraction-feedback.ts` and is fully covered there; what is not
covered is the wiring between it and the DOM.

### File List

**Task 3 (in progress) — the claim is taken before the money is spent.** Story 1.5b's parent-row lock
sits *inside* `replace`, which serialises the cheap part and lets the expensive part run twice: two
pollers both call the provider, both get an answer, then queue politely to overwrite each other. The
claim closes that by being acquired before the call, in one atomic statement whose `returning` says
who won.

**It lives in the database because two instances share no memory.** An in-memory claim is invisible
to the instance that matters. Expiry is evaluated with the database's `now()` for the same reason:
comparing against an application timestamp would give every instance its own clock, and skew would
decide who owns a document.

**Expiry deliberately creates a second claimant** — that is what stops a dead process holding a
document forever — which is precisely why the write is fenced. The token is re-checked *inside* the
finalising transaction, in the same statement that takes the row lock, so there is no window between
checking and writing. A stale holder is refused with `StaleExtractionClaimError` and changes nothing:
tested by claiming twice and having the first holder return late.

**`extracting` is still not a durable state.** The document stays `held` for the whole run, and the
surface derives "extracting" from `held` plus a live claim. A crash therefore leaves a claim that
expires and a document that is still, accurately, held and waiting — rather than one stranded in a
state with nothing to move it out.

**Still open in this task:** the follow-up endpoint and its authorisation, wiring `extractDocument`
to take and release the claim, and the transition definitions.

**Task 3 (endpoint) — the access-control surface that looks like a progress bar.** It takes a
document id and does expensive, chargeable work against the bytes behind it, so an unguarded version
would let anyone spend the association's money reading documents they cannot otherwise see. Deny by
default, and the session is checked for substance rather than for `undefined` — a callback supplying
`null` or an empty string would pass a loose check and leave it open. A malformed id is refused
before the database sees it, because letting Postgres reject it would surface as a 500 where the
honest answer is 400.

**Nothing but a missing document is an error.** `provider-unavailable`, `unreadable` and
`in-progress` all answer 200 with the state. A poller receiving a 5xx for "we could not reach the
provider just now" would report a broken server for a condition the server is handling correctly.

**A decision, and the point at which it becomes wrong.** Any signed-in board member may trigger
extraction, not only the uploader. Documents belong to the association rather than to whoever
happened to upload them, there is exactly one association in this pilot (`board_member` has no
organisation column), and restricting to the uploader would stop a colleague retrying a stuck
extraction — a real workflow. **This becomes wrong the moment a second association exists**, and the
test that records it says so, so it should fail rather than quietly widen.

### File List

**Task 2 — the four states now exist where they can be trusted.** Before this migration, "has this
been read?" was answered by looking for extraction rows, which distinguishes exactly one of the four
outcomes AC3 requires. *Held*, *provider unavailable* and *could not be read* are all "no rows", and
a treasurer needs a different sentence for each.

**The state moves in the same transaction as the rows it describes.** `ExtractionRepository.replace`
sets `extraction_state = 'read'` between its inserts and its commit, so `read` is never visible
without the records that justify it, and a rollback leaves both the old state and the old rows.

**`read` is not settable through the other path.** `DocumentRepository.markExtractionState` accepts
`Exclude<ExtractionState, 'read'>` — a compile-time refusal, so there is no way to claim figures
exist without writing them.

**The check constraint constrains values, not sequences.** Which transitions are legal is Task 3's
business; a state machine hidden in a check constraint is one nobody would find. The migration says
so in a comment rather than leaving the omission to be read as an oversight.

**`failed` is absent from the vocabulary deliberately**, and a test asserts its absence. Story 1.5b
shipped an outcome by that name whose copy told the treasurer their document was not saved when it
had been.

### File List

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

- `core/ingestion/extraction-feedback.ts` — the words the treasurer reads while a document is read
- `core/ingestion/extraction-feedback.test.ts` — 29 tests, most of them about what must *not* appear
- `app/upload/extraction-status.tsx` — the polling surface, live region, staged name
- `app/api/documents/[id]/extract/route.ts` — the deferred-extraction endpoint
- `app/api/documents/[id]/extract/route.test.ts` — 21 tests, most of them about who may call it
- `migrations/008_document_extraction_claim.sql` — the claim, its expiry, and why no index is added
- `migrations/007_document_extraction_state.sql` — the four states, a closed vocabulary, a partial index for the held query
- `migrations/document-extraction-state.test.ts` — 20 tests: vocabulary parity, defaults, grants, and the state/rows agreement
- `core/ingestion/extract-document.ts` — deferred extraction: read a held document, store what it says
- `core/ingestion/extract-document.test.ts` — 25 tests, no network

**Modified**

- `core/ports/document-store.ts` — `get`, because nothing had ever read a document back
- `core/ports/document-repository.ts` — `findById` and the `HeldDocument` shape
- `adapters/storage/document-store-s3.ts` — `get`, mapping a missing key to `null` rather than a throw
- `adapters/db/document-repository-postgres.ts` — `findById`, selecting only what extraction needs
- `adapters/db/extraction-repository-postgres.ts` — `replace` moves the state in the same transaction
- `adapters/db/extraction-repository-postgres.test.ts` — 4 tests for the state, including where the statement is issued
- `core/ingestion/ingest.test.ts`, `core/ingestion/reading.test.ts` — fakes widened to the ports
- `app/upload/upload-form.tsx` — renders extraction progress for documents stored but not read

### Change Log

### Completion Notes List

### File List

### Change Log
