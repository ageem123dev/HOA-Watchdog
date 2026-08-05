---
baseline_commit: c894c032a67f3bbf5830a575f549f395c98bd25c
---

# Story 1.5c: Extract structured records from PDFs and images

Status: review

> **Third of four stories from epic story 1.5.**
> **1.5** built the deterministic path and the shared foundation — the `extraction` table, the record vocabulary, validation and the unreadable outcome. **1.5b** stores records and wires extraction into ingestion. **This story adds the provider path**: the extraction adapter, AD-9's schema enforcement at the API layer, and AD-10's vendor boundary.
> **1.5d** then wires this story's provider path into ingestion and builds the staged-progress surface.
> It redefines none of the above; it conforms to them and reuses the storage path 1.5b built.
>
> **Split from a seven-group story on 2026-08-04**, for the same reason 1.5 was split: the diff was
> heading for the size that produced 17 findings on story 1.4. This story proves the provider works
> and is properly bounded; 1.5d makes an upload use it. The acceptance criteria below were narrowed
> to match — **none of them claims work that moved to 1.5d.**

**Depends on 1.5 and 1.5b.** Do not start until both are merged — the record vocabulary and validator come from 1.5, and the repository this story's output is written through comes from 1.5b.

## Story

As a treasurer,
I want the system to read the figures out of scanned invoices and statements,
so that I do not have to key them in, and so nothing is recorded that could not be read reliably.

## Acceptance Criteria

Epic story 1.5's ACs 1 and 4, plus the provider half of AC3.

**AC1 — A PDF or image is extracted by the provider under a machine-enforced schema**

**Given** an uploaded PDF or image
**When** extraction runs
**Then** it is performed by the extraction provider with a machine-enforced output schema (`responseMimeType: application/json` plus `responseSchema`)
**And** it returns a **validated collection** of structured records

A statement holds many figures and the `extraction` table is many-rows-per-document, so a singular
reading of this criterion would licence a single-record port that drops rows or aggregates them
without saying so.

**Storing that collection is 1.5d's**, through the repository 1.5b already built. This story ends at
a validated collection in memory, and says so rather than implying an upload produces rows.

**AC2 — Schema-invalid provider output halts that document and stores nothing**

**Given** extraction output that fails schema validation
**When** the pipeline evaluates it
**Then** the pipeline halts for that document and returns a structured "Document Unreadable" error
**And** no partial or best-effort record is stored or displayed

**AC3 — The dual-LLM boundary is a vendor boundary, and raw content never crosses it**

**Given** any extracted content
**When** it moves downstream
**Then** raw document bytes and raw extracted text are never passed into the reasoning model's context
**And** extraction uses a different provider and credential from the reasoning model

**AC4 — The provider is proven, not assumed**

**Given** a real credential
**When** the connectivity probe runs
**Then** it reaches the provider, gets a schema-locked reply that parses, and confirms a schema violation is genuinely refused rather than silently coerced

## Tasks / Subtasks

- [x] **Extraction port and adapter** `core/ports/extractor.ts`, `adapters/extraction/` (AC: 1, 3)
  - [x] Narrow port — take bytes and a media type, return **a collection of candidate records** or a refusal. Nothing provider-shaped crosses it (AD-16's lesson)
  - [x] **A collection, not one record.** A statement holds many figures, and 1.5's `extraction` table is many-rows-per-document. A single-record port either loses rows or forces an unstated aggregation. Validation is all-or-nothing across the set, as it is on the tabular path
  - [x] The adapter is the only place the provider is constructed, and the only file that knows the request shape
  - [x] `fetch` against the REST API — **no SDK dependency** (decided; see Dev Notes)
  - [x] **A fixed HTTPS origin, and redirects refused** (`redirect: 'manual'`). The request carries a credential, and a redirect followed blindly can carry that credential somewhere else
  - [x] Injected client for tests; lazy construction so `next build` needs no credential (1.4's `env.ts` and S3 notes)
  - [x] Bounded timeouts — and note 1.4's lesson: `requestTimeout` without `throwOnRequestTimeout` only logs. Whatever the transport, prove the bound actually bounds

- [x] **Schema enforcement at the API layer** (AC: 1, 2)
  - [x] The request carries `responseMimeType: application/json` **and** `responseSchema` — AD-9 requires enforcement at the extractor, not only after the reply
  - [x] The reply is validated again with 1.5's `core/extraction/validate.ts`. Both halves are required; either alone is half the rule
  - [x] Schema sent and schema validated derive from **one** definition — assert it, do not maintain two

- [x] **The AD-10 boundary guard** (AC: 3)
  - [x] A guard test in `core/security/`, shaped like `nfr2-guard.test.ts` — it must fail the pipeline, not live in a convention
  - [x] Extraction and reasoning credentials are distinct names; no module reads both
  - [x] **Assert the providers differ, not only the credentials.** Distinct key names prove nothing about which endpoint is called — pin the extraction origin and the reasoning origin as separate values and fail if they converge. AC3 says different *providers*
  - [x] **And different deploy units**, which is AD-10's third clause and the one nothing yet checks. Credentials, origins and content flow can all be correct while both run in the same unit, which is the arrangement AD-10 exists to prevent. Add a configuration check that fails on a planted same-unit deployment — the extraction adapter belongs to the Node gateway and the reasoning agent to the Python service, and a deploy config placing them together must break the pipeline, not a code review
  - [x] No code path passes document bytes or raw extracted text toward the reasoning side
  - [x] **Prove the guard detects a violation** by planting one, as `core/ports/boundary.test.ts` does. A guard tested only against a clean tree cannot distinguish "nothing wrong" from "nothing checked"

- [x] **Connectivity probe** `scripts/verify-extraction.mjs` (AC: 4)
  - [x] The counterpart of `scripts/verify-storage.mjs`, and held to its standard: report **SKIP** rather than PASS when it cannot actually prove something
  - [x] Reach the provider; a schema-locked reply parses; a schema violation is refused
  - [x] Keep its client configuration in step with the adapter's — a probe that connects differently can report a healthy provider the application cannot use (a real 1.4 finding)

- [x] **Configuration** (AC: 1, 4)
  - [x] Add the credential and model variables to `.env.example` **by name only**
  - [x] Check whether the new credential trips `core/security/forbidden-credentials.ts` before assuming it passes — see Dev Notes

## Dev Notes

### Decisions already made in 1.5's planning

- **Transport: `fetch`, no SDK.** `responseMimeType` and `responseSchema` are plain REST body fields, so the SDK buys only retry and typed construction at the cost of a data-plane dependency. Retry and timeouts are written by hand, as they were for S3.
- **Record shape: typed columns with database constraints**, defined by 1.5. This story conforms; it does not redefine.
- **Live verification is in scope** — hence AC4.

### The provider, concretely

`gemini-3.1-flash-lite` is the model named in ARCHITECTURE-SPINE.md#Stack, but **the model is configurable** — a variable selects it, so a change is configuration rather than a code edit. Confirm the exact variable names against `.env.local` before writing the adapter; the intended pair is a credential and a model selector.

The reasoning side is `claude-sonnet-5` with its own key, in the Python service, and **does not exist yet**. AC3's guard is therefore mostly a seam plus a test: assert now that the credentials are distinct names and that no module reads both, so epic 3 cannot quietly merge them. That is the whole point of writing the guard before the thing it guards exists.

### The credential meets an existing guard

`core/security/nfr2-guard.test.ts` reads `.env.example` on every test run, and `core/security/forbidden-credentials.ts` decides what counts as a forbidden credential. An earlier key (`R2_WRITE_TOKEN`) tripped the write-token rule and needed a deliberate scope decision recorded in that file.

Check whether an extraction key trips it **before** assuming it passes. If it does, that is an AD-2 scope decision to raise — not a test to loosen.

### When extraction runs — DECIDED

**Decided: store first, extract on a follow-up request the surface polls.** Not synchronous, and no
queue (a queue was out of scope and not to be added without asking).

Why: a model call is seconds. A treasurer uploading twenty scanned invoices would hold one request
open for minutes, which is also where serverless request limits bite. UX-DR12 asks for *staged named
progress*, which presumes the treasurer watches it happen rather than staring at a stalled upload.

The deciding evidence is that **1.5b already built the state this needs**. Its outcome vocabulary has
`stored-not-read` — "held, no reader for this type yet" — which is exactly "held, not yet extracted".
The deferred design costs a follow-up endpoint and reuses the rest.

The durable states, named so the surface can render each and so "no rows" is never mistaken for
success:

| State | Means |
| --- | --- |
| **held, not yet read** | bytes stored, extraction not started or still running (1.5b's `stored-not-read`) |
| **read** | a validated set is stored (1.5b's `read`) |
| **could not be read** | extraction ran, output failed validation; any previous set untouched (1.5b's `unreadable`) |
| **provider unavailable** | extraction could not run at all — **retryable, and not the document's fault** |

The last is the only genuinely new one, and it must not collapse into "could not be read": one tells
the treasurer their scan is bad, the other tells them to wait. 1.5b made exactly this mistake with
`failed` and had to add `figures-not-stored` to fix it.

**Transitions and the retry path are 1.5d's**, which owns ingestion and the surface. This story only
has to leave the port able to express "the provider was unreachable" distinctly from "the provider
answered and the answer was invalid" — those are different return values, not one error.

### The AD-8 question, answered rather than inherited

**Decided (owner's call, 2026-08-04): tools may return validated field values.** A tool may hand the
reasoning model typed, schema-validated, length-capped columns — `vendorName`, `documentNumber`,
`issuedOn`, `totalAmount`, `currency`. It may **never** hand over raw document bytes or raw extracted
text.

This is the reading AD-8 already implies — *"prompts carry row identifiers and tools resolve values"*
— and it is what lets the watchdog explain a finding to a board in its own words rather than citing
row ids at volunteers.

What bounds the values, which is the part that has to be true for this to be safe:

- Every field crossing is one the `extraction` table constrains: a known `document_kind`, a
  `numeric(14,2)` amount, a `date`, a currency from a closed set, and text columns capped at 200 and
  64 characters (`core/extraction/record.ts`, enforced again by the database).
- Nothing free-form crosses. There is no notes or description column in the record vocabulary, which
  is what keeps a poisoned document from smuggling a paragraph of instructions through a value.
- AD-8 still holds regardless: values are **data**, never string-interpolated into a prompt.

**Write this into the port's contract with a test** — the port returns the record vocabulary and
nothing else, so "raw text cannot cross" is a property of the type rather than of anyone's care.

### Non-negotiables

- **AD-9:** schema conformance enforced **at the extractor's API layer**. Sending the schema and validating the reply are both required.
- **AD-10:** different vendor, different credential, different deploy unit. Raw bytes and raw extracted text never enter the reasoning context on any code path.
- **AD-8:** extracted strings are never string-interpolated into any prompt. Prompts carry row identifiers; tools resolve values.
- **AD-1:** uploads remain the only data plane. Extraction reads what ingestion stored.

### Testing standards

`bmad-dev-tdd` applies, with the Step 9 sensitivity check on each task's load-bearing assertion.

**This story is unusually exposed to guards that prove nothing**, because the provider is faked in every unit test and a fake returns whatever the test asks for. A test that stubs the provider and then asserts the record was stored proves the plumbing, not the schema enforcement. Mitigations, in order of value:

1. **Capture a real reply** from the probe and keep it as a fixture, so validation runs against something the provider actually produced.
2. **Inverse tests** — one schema violation at a time, each refused.
3. **The probe itself** (AC4) is the only thing that proves AD-9 end to end. Treat it as a deliverable, not a convenience.
4. **Sensitivity checks** — remove `responseSchema` from the request and confirm a test fails. If none does, the schema is not actually being enforced by anything you have written.

### Project Structure Notes

```text
core/ports/extractor.ts              # NEW — the port
adapters/extraction/                 # NEW — the only place the provider is constructed
core/security/                       # UPDATE — the AD-10 guard
scripts/verify-extraction.mjs        # NEW — the probe
app/upload/                          # UPDATE — staged extraction progress
.env.example                         # UPDATE — names only
```

`core/` imports nothing outward — `core/ports/boundary.test.ts` enforces it.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5] — ACs 1, 4
- [Source: docs/prd/prd.md#FR-2] and #FR-3 — extraction isolation, schema conformance
- [Source: ARCHITECTURE-SPINE.md#AD-9] — schema enforced at the extractor's API layer
- [Source: ARCHITECTURE-SPINE.md#AD-10] — the dual-LLM boundary is a vendor boundary
- [Source: ARCHITECTURE-SPINE.md#AD-8] — extracted values are data, never instructions
- [Source: ARCHITECTURE-SPINE.md#Stack] — `gemini-3.1-flash-lite`, `claude-sonnet-5`
- [Source: epics.md#UX-DR12] and #UX-DR20 — extraction progress, live regions
- [Source: 1-5-read-a-document-into-structured-records.md] — the record vocabulary and validator this story conforms to
- [Source: 1-5b-store-extracted-records-and-complete-ingestion.md] — the repository and ingestion path this story writes through
- [Source: 1-4-upload-a-document-and-see-it-accepted-or-rejected.md] — adapter patterns, probe standard, the vacuous-guard record

## Dev Agent Record

### Agent Model Used

### Test Design

## Task 1 — the extractor port and adapter

**Behaviour A — bytes and a media type go to the provider; a validated collection or a refusal comes back**

*If it ran correctly, how would I know?* A PDF's bytes reach a pinned HTTPS origin carrying the
credential, and the reply becomes either a collection of records in this project's own vocabulary or
a refusal that says which kind of failure it was. Nothing provider-shaped is visible above the
adapter.

*How am I going to test this?* `fetch` is injected, so every test supplies its own and inspects the
request it was handed — URL, method, headers, body — without a network. That also makes the
credential observable, which matters because one of the failure modes below is leaking it.

*What else can go wrong?* Below. The two that worry me most are the ones this project has already
been bitten by: a bound that reports a breach and then proceeds (1.4's `requestTimeout`), and a guard
asserted against a clean tree so it cannot distinguish "nothing wrong" from "nothing checked".

*Could this problem happen anywhere else?* The S3 adapter is the sibling — same shape of lazy
construction, same credential handling. Any finding here should be checked against it.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| A1 | Missing credential crashes `next build`, which has no secrets | GUARD | Construction with no env does not throw; the first *call* throws a named error listing every missing variable |
| A2 | **A redirect carries the credential to another host.** The request is authenticated, and `fetch` follows 3xx by default | GUARD | `redirect: 'manual'`; a 3xx reply is a refusal, and the adapter never issues a second request to the `Location` |
| A3 | The origin is configurable and something points it at an attacker | GUARD | Origin is pinned in code; the request URL starts with the fixed HTTPS origin, and no env var can move it |
| A4 | **A timeout that does not bound.** 1.4's `requestTimeout` logged a warning and let the request continue | GUARD | A `fetch` that never settles causes the call to reject within the bound, and the abort signal is observed as actually aborted |
| A5 | The provider is unreachable and this reads as "your document is bad" | GUARD | A network rejection yields `unavailable`, never `invalid` — the distinction 1.5d's retry path depends on |
| A6 | A 429 or 5xx is treated as a permanent content failure | GUARD | 429 and 503 yield `unavailable`; a 400 is a request bug and yields `invalid` with no retry advice |
| A7 | Reply is not JSON, or is truncated JSON | GUARD | Both yield `invalid`; the parse never throws out of the adapter |
| A8 | Reply is well-formed JSON that is not the record shape | GUARD | Revalidated through 1.5's `validate.ts`; one bad record refuses the **whole set**, as the tabular path does |
| A9 | **The credential appears in an error, a log, or a thrown message** | GUARD | Every rejection path is asserted not to contain the key, including the one that stringifies a failed response |
| A10 | A single record is returned where a statement holds many | Unrepresentable | The port's return type is a collection; there is no single-record shape to accidentally use |
| A11 | Provider-shaped data leaks above the port (AD-16's lesson) | Unrepresentable | The port returns `ExtractionRecord[]` from 1.5's vocabulary — no candidate, no confidence, no vendor envelope |
| A12 | An enormous reply is materialised before anything checks it | GUARD | The response body is bounded, and the bound is proven on both sides as `MAX_WORKBOOK_CELLS` is |
| A13 | Retry storms the provider on a failure that will not succeed | OUT-OF-SCOPE | No retry in this story. 1.5d owns the retry path, and it retries from a stored document rather than in-adapter |
| A14 | Schema is sent but never checked, or checked but never sent | GUARD | Task 2's subject; listed here so it is not assumed handled by this task |

**Inverse/cross-check.** The request body is decoded back from what the injected `fetch` received and
asserted to carry the same media type and byte length that went in — recomputed in the test rather
than read from the adapter's own view of what it sent.

**On the fake-provider exposure the story warns about.** Every test here fakes `fetch`, so none of
them proves the provider actually honours `responseSchema` — only that this code sends it and
revalidates the reply. That is what AC4's probe is for, and it is why the probe is a deliverable
rather than a convenience. Saying so here so the coverage is not mistaken for more than it is.

## Task 2 — schema enforcement at the API layer

**Behaviour B — the provider is constrained before it answers, and disbelieved after**

*If it ran correctly, how would I know?* The outgoing request carries both `responseMimeType:
application/json` and a `responseSchema` whose vocabulary is this project's own, and the reply is
still put through `core/extraction/validate.ts` before anything is believed. AD-9 asks for
enforcement **at the extractor's API layer**; validating afterwards is a different control and does
not satisfy it. Either half alone is half the rule.

*How am I going to test this?* The injected `fetch` already exposes the request body, so the schema
is directly inspectable. The interesting assertions compare it against `core/extraction/record.ts`
**by importing those constants**, so the test cannot pass by agreeing with a copy of the vocabulary
that has drifted.

*What else can go wrong?* Drift is the whole risk. A schema is a second statement of a shape that is
already stated in `record.ts` and again in migration 006, and the failure is silent in both
directions — a schema that permits more than the validator makes every document unreadable, and one
that permits less throws away valid figures without saying so.

*Could this problem happen anywhere else?* Yes, and it already did: story 1.5 found the vocabulary
and the migration could drift, and answered it by parity-testing the constants against the SQL. Same
technique here, third copy.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| B1 | **`responseSchema` is never sent**, so the provider free-forms and only post-hoc validation catches it — which is not AD-9 | GUARD | The request body carries `responseSchema`; removing it fails a test |
| B2 | `responseMimeType` is missing, so a schema-conformant answer arrives wrapped in prose | GUARD | Asserted on the request body |
| B3 | **The schema is a hand-written copy that drifts from `record.ts`** | GUARD | Every enum and length in the schema is compared against the imported constant, not a literal |
| B4 | The reply is trusted because a schema was sent | GUARD | Revalidation is still applied; a schema-shaped but invalid reply is refused |
| B5 | The schema permits what the validator refuses — every document then fails, blamed on the scan | GUARD | Cross-check: each value the schema admits is accepted by `validate` |
| B6 | The schema refuses what the validator permits — valid figures silently lost | GUARD | Cross-check in the other direction, over the vocabulary |
| B7 | Nullability disagrees with the record type, so an absent vendor is either rejected or invented | GUARD | The nullable set is asserted against the four fields the table allows null |
| B8 | `required` lists the wrong fields | GUARD | Asserted against the two fields that are `not null` in migration 006 |
| B9 | The schema constrains a single record, not the collection | GUARD | The schema's root is an object with a `records` array |
| B10 | A future kind or currency is added to `record.ts` and the schema silently keeps the old set | GUARD | This is B3's parity test; called out separately because it is the one that will actually happen |

**Inverse/cross-check.** B5 and B6 together are the cross-check: the schema and the validator are two
independent statements of one shape, so each is used as the other's oracle over the whole vocabulary
rather than on one example.

## Task 3 — the AD-10 boundary guard

**Behaviour C — the dual-LLM boundary is enforced by a failing test, not by a convention**

*If it ran correctly, how would I know?* A planted violation breaks the suite. That is the only
signal that means anything here, because **the reasoning side does not exist yet** — every check
would otherwise pass by describing an empty world, and keep passing right up until epic 2 merges the
two sides.

*How am I going to test this?* Two surfaces. A declared **deploy manifest** the guard reads, and the
repository's own source, scanned for a module that reaches for both credentials. Violations are
planted into a copy of the manifest rather than into the repo, so the negative case is real without
committing a broken tree.

*What else can go wrong?* The dominant risk is not a missed violation — it is a guard that cannot
fail. AD-10 has three clauses (vendor, credential, deploy unit) and the third had nothing to read:
there is **no deploy configuration in this repository at all**. A check over an absent file is the
purest form of the vacuous guard, and this project has now found nine of those.

*Could this problem happen anywhere else?* It is the same shape as `nfr2-guard.test.ts`, which
enforces an *absence*. That file solves it by naming exactly which surfaces it can and cannot see.
This one has to do the same, and additionally prove its own inputs are non-empty.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| C1 | **The whole guard passes vacuously** because the reasoning side does not exist yet | GUARD | The manifest must declare *both* an extraction and a reasoning credential; if either set is empty the guard **fails**, rather than finding no conflict among nothing |
| C2 | The deploy manifest is deleted or renamed and the check quietly reads nothing | GUARD | A missing or unparsable manifest is a failure, never a skip |
| C3 | **Both roles land in one deploy unit** — AD-10's third clause, and the arrangement it exists to prevent | GUARD | A unit declaring both responsibilities fails; proven by planting one |
| C4 | One unit holds both credentials, even with the roles nominally separate | GUARD | A unit whose credential list spans both sides fails; proven by planting one |
| C5 | **Distinct credentials, same vendor.** Two keys pointing at one provider satisfies "different credential" and violates "different vendor" | GUARD | The declared origins must differ by host; planting a converged origin fails |
| C6 | A single module reads both credentials, so the boundary is one import away from gone | GUARD | Source scan across `core/`, `adapters/`, `app/`, `scripts/`; a planted module that reads both fails it |
| C7 | Raw bytes or raw extracted text reach the reasoning side | Unrepresentable **and** GUARD | The port returns only the constrained record vocabulary (Task 1), and C6's scan covers the import path. Recorded as partly structural because the reasoning side cannot yet be inspected |
| C8 | The guard is narrowed later to make a failure go away | OUT-OF-SCOPE for code, addressed in prose | Same standing as `nfr2-guard.test.ts`: narrowing it is an architecture change needing a new AD, and the file says so |
| C9 | The manifest describes units that do not match reality | OUT-OF-SCOPE | Nothing in the repo deploys anything today. Recorded as a real limit: this guard binds the *declared* topology, and its value is that epic 2 must change a tracked file to break it |

**Inverse/cross-check.** Every clause is checked in both directions: the real manifest must pass, and
a planted violation of that same clause must fail. A guard exercised only against a clean tree cannot
distinguish "nothing wrong" from "nothing checked" — `core/ports/boundary.test.ts` established that
technique here and this follows it.

## Task 4 — the connectivity probe

**Behaviour D — the only thing in this story that proves AD-9 end to end**

*If it ran correctly, how would I know?* It reaches the real provider with a real credential, gets a
schema-locked reply that parses into this project's records, and shows that a **schema violation is
genuinely refused rather than silently coerced**. Every other test in this story fakes `fetch`, so
none of them can tell a provider that honours `responseSchema` from one that ignores it.

*How am I going to test this?* By running it against the live provider. Its own correctness — the
SKIP paths, the parity with the adapter — is covered by a unit test that reads the script.

*What else can go wrong?* The failure that matters is a probe that reports health the application
cannot actually use. Story 1.4 hit exactly that: a probe connecting differently from the adapter.

*Could this problem happen anywhere else?* `verify-storage.mjs` is the sibling and states the rule
this one inherits: **a check that cannot run must not print PASS.**

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| D1 | **The probe connects differently from the adapter**, so it reports a healthy provider the app cannot reach | GUARD | A unit test reads both files and asserts the origin and the auth header match. `verify-storage.mjs` has only a comment saying "kept in step"; this is that comment made mechanical |
| D2 | A check that could not run prints PASS | GUARD | Anything unprovable reports **SKIP**, inherited from the storage probe |
| D3 | **A schema violation is silently coerced and the probe calls it a pass** | GUARD | The probe asks for an out-of-vocabulary `documentKind` and fails if that value comes back |
| D4 | The credential appears in probe output | GUARD | Nothing prints the key; the header is set, never echoed |
| D5 | The probe hangs and a pipeline waits forever | GUARD | Same abort-based bound as the adapter |
| D6 | The probe writes something | Unrepresentable | It calls the model and touches no database, bucket or file |
| D7 | Missing credentials produce a stack trace rather than an instruction | GUARD | Names what is missing and exits non-zero, as the storage probe does |
| D8 | A 200 carrying valid JSON that is not records reads as success | GUARD | The reply is put through the same validator the adapter uses |
| D9 | The probe runs in CI without credentials and reports a broken build | OUT-OF-SCOPE by design | Gated on the credential being a protected masked variable, exactly as `verify:database` is — an honest "not run" rather than a false red |

**On what the probe can and cannot establish.** It proves the provider honours a schema *for the
prompt it sends*. It is not a guarantee about every future document. That is the strongest claim
available and it is worth more than the whole faked suite, which is why the story calls it a
deliverable rather than a convenience.

### Debug Log References

**Task 1 — red.** 33 failing against a stub whose `extract` throws, so every red was an assertion
failure rather than a missing symbol. 811 unit tests green overall on completion.

**Task 1 — sensitivity, nine mutations. Seven detected on the first pass; two were not, and both
were my own tests proving less than they claimed.**

| Mutation | Failures | Reading |
| --- | --- | --- |
| Drop `redirect: 'manual'` | 1 | |
| Move the key into the query string | 1 | |
| Map every failure to `invalid` | **5** | The unavailable/invalid split is load-bearing, as 1.5d needs |
| Skip invalid records instead of refusing the set | 1 | All-or-nothing holds |
| Allow the empty set through | 1 | |
| Never abort on timeout | 1 | The bound genuinely bounds — 1.4's lesson |
| Keep only the first record | 1 | The collection is real |
| **Read the origin from `process.env`** | **0 → 1** | See below |
| **Remove the reply byte bound** | **0 → 1** | See below |

**The origin test proved less than it claimed, twice over.** It planted `GEMINI_ORIGIN` in the
*injected* env only, so an adapter reading the real `process.env` sailed past it. Planting in
`process.env` too still did not catch it, because the mutation binds `ORIGIN` at **module scope** —
already evaluated by the time any test body runs. Only `vi.resetModules()` plus a fresh dynamic
import catches that, and now does.

**The reply-bound test was refusing for the wrong reason.** It sent one record with a 6 MB
`vendorName`, which the 200-character cap refuses on its own — so it passed with the byte bound
removed entirely. Replaced with 25,000 individually **valid** records, where the only thing that can
refuse the reply is the bound, plus an assertion that `MAX_REPLY_BYTES` is not merely zero.

Both are the same shape this project keeps meeting: a guard that passes whether or not the thing it
guards against is present. Eighth and ninth instances, and the first found by running a mutation on a
security control rather than on business logic.

**Task 2 — red.** 8 failing on schema assertions against an adapter that sent `responseMimeType`
alone. **Sensitivity: eight mutations, all detected.**

| Mutation | Failures |
| --- | --- |
| Drop `responseSchema` | **12** |
| Drop `responseMimeType` | 1 |
| Hand-write the kind enum so it drifts | 1 |
| Hand-write the vendor cap as 255 | 2 |
| Trust the reply and skip revalidation | 2 |
| Make `vendorName` non-nullable | 1 |
| Add a nullable column to `required` | 1 |
| Constrain a record instead of the collection | 1 |

The two hand-written mutations are the ones worth having: both are *plausible* schemas, wrong only
because they disagree with `record.ts`. They fail because the tests compare against the imported
constants rather than against literals — a test asserting `maxLength === 255` would have passed the
drifted version happily.

**Task 3 — sensitivity, eight mutations, all detected.**

| Mutation | Failures |
| --- | --- |
| Drop the vacuity check | 1 |
| Drop the empty-units check | 1 |
| Drop shared-unit (AD-10's third clause) | 2 |
| Drop shared-credential | 1 |
| Drop converged-origin | 2 |
| Accept an unparsable origin | 1 |
| Make the source scan find nothing ever | 2 |
| Revert the scan to matching bare mentions | 2 |

The last one matters as much as the others: it pins the narrowing described below in **both**
directions, so the scan cannot quietly go back to flagging documentation.

**A real false positive, found by running the guard rather than by reasoning about it.** The first
version matched a credential name anywhere in a file and immediately flagged
`core/security/forbidden-credentials.test.ts` — which lists both names in a fixture of credentials
NFR-2 must *permit*, and reads neither. Narrowed to actual environment access
(`process.env.NAME`, `env['NAME']`). That is not narrowing a guard to make a failure go away; it is
the difference between the property meant and the property written, and `forbidden-credentials.ts`
warns in its own header that a detector flagging legitimate names "gets deleted by the first
developer it inconveniences". Two tests now pin the distinction.

**Two self-inflicted defects worth recording.**

*A control byte in source, for the third time in this epic.* Building the regex through a shell
heredoc into Python produced a literal `0x08` where `` was intended — the same class of corruption
as the NUL bytes in stories 1.2 and 1.5, and again invisible in an editor. Fixed by writing the
repair script to disk with a raw string rather than piping escapes through two interpreters. A
repo-wide sweep of every tracked file now reports **zero** NUL, backspace, vertical-tab or form-feed
bytes.

*Three type errors that only `tsc` could see.* The `planted` helper mutated `draft.units[0]` on a
`readonly` array. Every test passed — Vitest does not type-check, and `next build` only checks the
graph it compiles — and `npx tsc --noEmit` went from the baseline 8 to 11. Rewritten functionally,
back to 8. This is the second time in two stories that the untyped-tests gap has caught something
real, which strengthens the case for the follow-up story F2 asks for.

**Task 4 — the probe, run live on 2026-08-04.** Output verbatim:

```
provider: https://generativelanguage.googleapis.com
model:    gemini-3.1-flash-lite

  PASS  a schema-locked reply parses -- 1 record(s)
  PASS  the reply conforms to the record vocabulary -- 1 record(s) inside the vocabulary
  PASS  a schema violation is refused rather than coerced -- asked for "receipt", got "other"
```

**The third line is the story's strongest claim.** The model was *instructed* to set `documentKind`
to exactly `"receipt"` — a value the vocabulary does not contain — and the reply came back `"other"`.
The schema is enforced at the provider's API layer rather than merely sent. No faked test in this
story could establish that, and until this ran, AD-9 was an assumption.

**Parity is mechanical now, not aspirational.** `verify-storage.mjs` says it is "kept in step with"
its adapter in a comment, which holds exactly until someone edits one file.
`scripts/verify-extraction.test.ts` reads both files and compares the origin, the auth header, the
environment names, the response format, the redirect policy and the vocabulary. 13 tests.

### Completion Notes List

**Task 4 — the probe is the only thing here that proves AD-9.** Every unit test in this story injects
`fetch`, so all of them together show that this code *sends* a schema and revalidates the reply.
Whether the provider honours the schema is a different claim, and only a live call can settle it. It
now has: asked for a `documentKind` outside the vocabulary, the provider returned one inside it.

**It cannot import the adapter**, being plain `.mjs` against TypeScript, so the request shape is
written twice. That duplication is the risk story 1.4 already got caught by — a probe that connects
differently reports a provider the application cannot use — so the parity is a test rather than a
comment.

**CI gate added**, on the same terms as `verify:database`: gated on `GEMINI_API_KEY` **and**
`GEMINI_OCR_MODEL` being protected masked variables, so an unset credential produces an honest
"not run" rather than a false red. Neither is set today, so this job will not run in the MR
pipeline — the evidence above is local, and the MR says so rather than implying coverage.

**Task 3 — the guard's hardest requirement was being able to fail at all.** The reasoning side does
not exist; epic 2 builds it. So every clause would pass by describing an empty world and keep passing
until the exact commit it was written to catch. `deploy-units.json` exists because AD-10's third
clause — *different deploy unit* — had **nothing in this repository to read**: there is no deploy
configuration at all. A check over an absent file is the purest vacuous guard, so the manifest is
tracked config, and a `vacuous` violation fires if either side stops declaring a credential or the
unit list empties.

**Three clauses, checked as three things.** Distinct credentials prove nothing about which endpoint
they authenticate against, so the origins are compared by host; distinct origins prove nothing about
where the code runs, so responsibilities and credential holdings are compared per unit. Every clause
is exercised against the real manifest *and* a planted violation of that same clause.

**What this cannot see, stated rather than implied.** It reads the tracked manifest and this
repository's source. It cannot see the runtime topology of a hosting account, and nothing here
deploys anything today. Its value is narrower and real: for epic 2 to put both models in one unit it
must edit a tracked file, in a commit someone reviews, and this test fails until it does.

**The bytes-never-cross clause is structural, not scanned.** The port returns only the constrained
record vocabulary (Task 1), so there is no type through which raw text could pass. The source scan
covers the credential path. Neither can inspect a reasoning service that does not exist, and the
story says as much.

**Task 2 — the schema is derived, not restated.** Every enum and bound in `responseSchema()` reads
from `core/extraction/record.ts`. Writing them out again would have made it a third statement of a
shape already in that file and in migration 006, and drift is silent in **both** directions: a schema
permitting more than the validator makes every document unreadable and blames the scan; one
permitting less discards valid figures without a word. Story 1.5 met this between the vocabulary and
the SQL and answered it the same way.

**Both halves of AD-9, and neither substitutes for the other.** The schema stops the provider
inventing a shape; the revalidation survives a provider that ignores the schema. Removing either
fails tests — 12 and 2 respectively.

**The schema lives in the adapter, not `core/`.** The *shape* is ours and comes from the vocabulary;
the *notation* is the provider's OpenAPI subset. Putting that notation in `core/` would be the
provider leaking upward, which is the thing the port exists to prevent.

**The cross-check runs over the vocabulary, not an example.** Each kind and currency the schema
admits is fed to `validate` and must be accepted, and one it excludes must be refused. The schema and
the validator are two independent statements of one shape, so each is used as the other's oracle.

**Task 1 — the port is where AD-8 stops being a matter of care.** `Extractor` returns
`ExtractionRecord[]` from 1.5's vocabulary: a known kind, a `numeric(14,2)` amount, a date, a
currency from a closed set, and two text columns capped at 200 and 64 characters. There is no
free-form field, so there is nowhere for a poisoned document to smuggle a paragraph of instructions
through a value. "Raw extracted text never crosses" is a property of the type rather than of anyone
remembering it.

**Two refusals, not one.** `unavailable` means the provider could not answer — the document is fine
and 1.5d's retry applies. `invalid` means it answered and the answer could not be trusted — retrying
changes nothing. 1.5b collapsed exactly this pair into `failed` and had to add `figures-not-stored`
to separate them again; two names from the start here.

**The origin is pinned in code and the model is not.** An environment-configurable origin plus an
attached credential is an exfiltration primitive, not a configuration option. Changing the model
stays configuration.

**Nothing is inspected on the transport-error path.** A `fetch` error can carry the request, headers
included, so that branch returns a refusal without touching the error — the one place a credential
would otherwise escape into a log or a result.

**Deliberately not done here:** `responseSchema` on the request (Task 2, which must derive the sent
schema and the validated schema from one definition), the AD-10 guard (Task 3), and the probe
(Task 4) — which remains the only thing that can prove AD-9 end to end, since every test in this task
fakes the provider.

### File List

**Added**

- `core/ports/extractor.ts` — the port: bytes and a media type in, a record collection or a typed refusal out
- `core/security/dual-llm-boundary.ts` — AD-10's decision procedure
- `core/security/dual-llm-boundary.test.ts` — 19 tests; every clause checked against a planted violation
- `deploy-units.json` — the tracked deployment topology AD-10's third clause had nothing to read
- `scripts/verify-extraction.mjs` — the live probe; the only end-to-end proof of AD-9
- `scripts/verify-extraction.test.ts` — 13 tests keeping the probe in step with the adapter
- `adapters/extraction/extractor-gemini.ts` — the only place the provider is constructed
- `adapters/extraction/extractor-gemini.test.ts` — 36 tests, no network

**Modified**

- `.env.example` — `GEMINI_API_KEY` and `GEMINI_OCR_MODEL`, names only; the NFR-2 guard was run against them
- `.gitlab-ci.yml` — the `verify:extraction` job, gated on both credentials
- `package.json` — the `verify:extraction` script
- `_bmad-output/implementation-artifacts/1-5c-...md` — split, decisions, Test Design
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 1.5c in-progress, 1.5d added

### Definition of Done

**PASS.**

| AC | Satisfied by |
| --- | --- |
| AC1 — extracted by the provider under a machine-enforced schema, returning a validated collection | `responseSchema` + `responseMimeType` on the request, revalidated through `core/extraction/validate.ts`; the port returns a collection and the "many records" case is tested. **Proven end to end by the probe**, not only by faked tests |
| AC2 — schema-invalid output halts and stores nothing | Every malformed shape yields `invalid`; one bad record refuses the whole set, as the tabular path does. Nothing is stored because storing is 1.5d's |
| AC3 — the dual-LLM boundary is a vendor boundary | `core/security/dual-llm-boundary.test.ts`, every clause checked against a planted violation; raw text cannot cross because the port's return type has no free-form field |
| AC4 — the provider is proven, not assumed | `scripts/verify-extraction.mjs`, run live: asked for `"receipt"`, got `"other"` |

**Test-first discipline held.** Task 1 went red against a stub whose `extract` throws, so all 33 reds
were assertion failures rather than missing symbols. Tasks 2–4 were red before green likewise.

**Sensitivity: 25 mutations run across the four tasks, 25 detected — but only after fixing three of
my own tests that were not detecting theirs.** The origin test, the reply-bound test and, in the
boundary guard, a scan that flagged a legitimate fixture. Recorded in the Debug Log rather than
quietly corrected, because all three passed against broken code first.

**Gates on this head:** lint clean, `next build` compiled, **857 unit passed / 111 skipped**,
`npx tsc --noEmit` at the pre-existing **8** (unchanged from baseline; 3 of my own were introduced
and fixed), repo-wide control-byte sweep clean.

**Not proven by CI, stated rather than implied.** `verify:extraction` is gated on `GEMINI_API_KEY`
and `GEMINI_OCR_MODEL` being protected masked variables, and they are not set — so **the MR pipeline
will not run the one check that proves AD-9**. The evidence is the local run quoted in the Debug Log.
`verify:database` remains gated the same way and equally unrun.

### Change Log

- 2026-08-04 — Split from a seven-group story; 1.5d takes ingestion wiring and the staged-progress
  surface. Two deferred decisions settled: tools may return validated field values, and extraction
  runs after storage on a polled follow-up. Tasks 1-5 implemented test-first: the extractor port and
  adapter, schema enforcement derived from the record vocabulary, the AD-10 boundary guard with a
  tracked deploy manifest, and the connectivity probe that proves AD-9 against the live provider.
  Status -> review.
