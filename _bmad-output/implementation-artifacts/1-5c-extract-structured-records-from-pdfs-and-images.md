# Story 1.5c: Extract structured records from PDFs and images

Status: backlog

> **Third of three stories from epic story 1.5.**
> **1.5** built the deterministic path and the shared foundation — the `extraction` table, the record vocabulary, validation and the unreadable outcome. **1.5b** stores records and wires extraction into ingestion. **This story adds the provider path**: the extraction adapter, AD-9's schema enforcement at the API layer, and AD-10's vendor boundary.
> It redefines none of the above; it conforms to them and reuses the storage path 1.5b built.

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
**And** **every record in that collection** is stored against the document

A statement holds many figures and the `extraction` table is many-rows-per-document, so a singular
reading of this criterion would licence a single-record port that drops rows or aggregates them
without saying so.

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

- [ ] **Extraction port and adapter** `core/ports/extractor.ts`, `adapters/extraction/` (AC: 1, 3)
  - [ ] Narrow port — take bytes and a media type, return **a collection of candidate records** or a refusal. Nothing provider-shaped crosses it (AD-16's lesson)
  - [ ] **A collection, not one record.** A statement holds many figures, and 1.5's `extraction` table is many-rows-per-document. A single-record port either loses rows or forces an unstated aggregation. Validation is all-or-nothing across the set, as it is on the tabular path
  - [ ] The adapter is the only place the provider is constructed, and the only file that knows the request shape
  - [ ] `fetch` against the REST API — **no SDK dependency** (decided; see Dev Notes)
  - [ ] **A fixed HTTPS origin, and redirects refused** (`redirect: 'manual'`). The request carries a credential, and a redirect followed blindly can carry that credential somewhere else
  - [ ] Injected client for tests; lazy construction so `next build` needs no credential (1.4's `env.ts` and S3 notes)
  - [ ] Bounded timeouts — and note 1.4's lesson: `requestTimeout` without `throwOnRequestTimeout` only logs. Whatever the transport, prove the bound actually bounds

- [ ] **Schema enforcement at the API layer** (AC: 1, 2)
  - [ ] The request carries `responseMimeType: application/json` **and** `responseSchema` — AD-9 requires enforcement at the extractor, not only after the reply
  - [ ] The reply is validated again with 1.5's `core/extraction/validate.ts`. Both halves are required; either alone is half the rule
  - [ ] Schema sent and schema validated derive from **one** definition — assert it, do not maintain two

- [ ] **The AD-10 boundary guard** (AC: 3)
  - [ ] A guard test in `core/security/`, shaped like `nfr2-guard.test.ts` — it must fail the pipeline, not live in a convention
  - [ ] Extraction and reasoning credentials are distinct names; no module reads both
  - [ ] **Assert the providers differ, not only the credentials.** Distinct key names prove nothing about which endpoint is called — pin the extraction origin and the reasoning origin as separate values and fail if they converge. AC3 says different *providers*
  - [ ] No code path passes document bytes or raw extracted text toward the reasoning side
  - [ ] **Prove the guard detects a violation** by planting one, as `core/ports/boundary.test.ts` does. A guard tested only against a clean tree cannot distinguish "nothing wrong" from "nothing checked"

- [ ] **Connectivity probe** `scripts/verify-extraction.mjs` (AC: 4)
  - [ ] The counterpart of `scripts/verify-storage.mjs`, and held to its standard: report **SKIP** rather than PASS when it cannot actually prove something
  - [ ] Reach the provider; a schema-locked reply parses; a schema violation is refused
  - [ ] Keep its client configuration in step with the adapter's — a probe that connects differently can report a healthy provider the application cannot use (a real 1.4 finding)

- [ ] **Wire the provider path into ingestion** (AC: 1, 2)
  - [ ] PDF and image route to the provider; CSV and Excel keep 1.5's deterministic path with no model call
  - [ ] A test proves the model is not reachable for tabular types — the AC2 guarantee of 1.5 must survive this story

- [ ] **Surface: staged extraction progress** (AC: 1, 2)
  - [ ] UX-DR12's staged named extraction-progress state
  - [ ] Live region for progress (UX-DR20)
  - [ ] **Partial extraction is never displayed under any state** (UX-DR12, verbatim)
  - [ ] Tokens only — `core/design/no-raw-values.test.ts` enforces this

- [ ] **Configuration** (AC: 1, 4)
  - [ ] Add the credential and model variables to `.env.example` **by name only**
  - [ ] Check whether the new credential trips `core/security/forbidden-credentials.ts` before assuming it passes — see Dev Notes

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

### When extraction runs — decide this early

1.5 kept parsing synchronous because it is fast and local. **This story makes that question real**: a model call is seconds, not milliseconds, and UX-DR12 asks for staged named progress, implying the treasurer watches it happen.

Three options in increasing cost: keep it synchronous and accept a slow upload for small batches; return after storage and extract on a follow-up request the surface polls; or introduce a job queue. **There is no queue in this project and adding one is a significant architectural addition — out of scope here, and not to be introduced without asking.**

Two constraints hold whatever is chosen: the `document` row and its bytes must be durable before extraction begins, so a provider failure never loses the upload; and a document with no extraction yet must be distinguishable from one whose extraction failed.

### An open question this story must answer rather than inherit

AD-8 says prompts carry row identifiers and tools resolve values; AD-10 forbids raw extracted text in
the reasoning context. Neither says whether `/tools/*` returns **extracted field values**
(`vendorName`, `totalAmount`) to the model, or only bounded identifiers the model cannot read.

Those are different security postures, and the difference stays invisible until epic 2 wires the
agent. Decide it here — while the extraction side is being built and the answer is cheap — and write
it into the port's contract with a test. If values cross, say what bounds them; if only identifiers
cross, say what resolves them and where.

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
