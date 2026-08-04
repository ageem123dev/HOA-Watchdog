# Story 1.5: Read a document into structured records

Status: ready-for-dev

## Story

As a treasurer,
I want the system to read the figures out of an uploaded document,
so that I do not have to key them in, and so nothing is recorded that could not be read reliably.

## Acceptance Criteria

**AC1 — A PDF or image is extracted by the provider under a machine-enforced schema**

**Given** an uploaded PDF or image
**When** extraction runs
**Then** it is performed by the extraction provider with a machine-enforced output schema (`responseMimeType: application/json` plus `responseSchema`)
**And** the resulting structured record is stored against the document

**AC2 — A CSV or Excel file is parsed deterministically, with no model involved**

**Given** an uploaded CSV or Excel file
**When** it is processed
**Then** it is parsed deterministically with no model involved at any point

**AC3 — Schema-invalid output halts that document and stores nothing**

**Given** extraction output that fails schema validation
**When** the pipeline evaluates it
**Then** the pipeline halts for that document and returns a structured "Document Unreadable" error
**And** no partial or best-effort record is stored or displayed

**AC4 — The dual-LLM boundary is a vendor boundary, and raw content never crosses it**

**Given** any extracted content
**When** it moves downstream
**Then** raw document bytes and raw extracted text are never passed into the reasoning model's context
**And** extraction uses a different provider and credential from the reasoning model

**AC5 — Extracted fields carry constraints beyond type**

**Given** an extracted field
**When** it is stored
**Then** value-level constraints beyond type are enforced — length caps, format, and enums where applicable

## Tasks / Subtasks

- [x] **Decisions — all four settled, 2026-08-04** (see Dev Notes → *The four decisions, as decided*)
  - [x] Transport: **`fetch`** against the REST API. No SDK dependency.
  - [x] Excel: **SheetJS, pinned from its own registry** (`https://cdn.sheetjs.com/...`), not the stale npm `xlsx`. Full AC2 coverage.
  - [x] Live verification: **in scope.** `GEMINI_API_KEY` goes in `.env.example` by name and `scripts/verify-extraction.mjs` proves the real provider.
  - [x] Record shape: **typed columns with database constraints**, matching how 1.4 resolved the same question.

- [ ] **Migration `006_extraction.sql`** (AC: 1, 3, 5)
  - [ ] `extraction` table keyed to `document`, following the conventions in `004_document.sql`
  - [ ] Value-level constraints as **database** constraints — length caps, format regex, enums (AC5)
  - [ ] Exactly one live extraction per document, so a re-ingest replaces rather than accumulates (AD-13)
  - [ ] Explicit `grant` decision for `watchdog_reader` (migration 003 revoked defaults — see Dev Notes)

- [ ] **The extraction schema** `core/extraction/schema.ts` (AC: 1, 3, 5)
  - [ ] One definition, used both to instruct the provider and to validate its reply — two copies drift
  - [ ] Value constraints live here and are asserted to agree with the migration's constraints
  - [ ] No dependency on the provider's SDK types; this is domain, not vendor

- [ ] **Validation and the unreadable outcome** `core/extraction/validate.ts` (AC: 3)
  - [ ] Reject on any schema violation; return a structured result, never a thrown provider error
  - [ ] `Document Unreadable` as a closed outcome the surface renders, matching the shape of `core/ingestion/acceptance.ts`
  - [ ] **No verbatim copy exists for this case.** FR-1 dictated the unreadable-*file* sentence word for word; FR-3 specifies only a "structured Document Unreadable error" and gives no user-facing wording. Write it in `core/extraction/`, in EXPERIENCE.md's voice, and keep it distinct from FR-1's — a file that could not be *opened* and a document that could not be *read* are different events and a treasurer will act differently on each
  - [ ] No partial record survives a failure — asserted, not assumed

- [ ] **Deterministic parsing** `core/extraction/tabular.ts` (AC: 2)
  - [ ] CSV parsed to the same structured record shape, with no model call on any path
  - [ ] Excel per the decision above
  - [ ] A test proves the model path is not reachable for these types

- [ ] **Extraction adapter** `adapters/extraction/` (AC: 1, 4)
  - [ ] Port in `core/ports/`, adapter the only place the provider is constructed — as `adapters/storage` is for S3 (AD-16's narrow-port lesson)
  - [ ] Lazy client construction and bounded timeouts, per the `next build` and socket-timeout notes from 1.4
  - [ ] Reads **only** the extraction credential; a guard test asserts it can never read the reasoning key (AD-10)

- [ ] **Wire extraction into ingestion** (AC: 1, 2, 3)
  - [ ] Extraction runs after the `document` row exists — hashing still precedes everything (AC1 of 1.4)
  - [ ] `replaceDerivedRows` finally gets a body: re-ingest replaces this document's extraction (AD-13)
  - [ ] Per-file outcomes extended for unreadable; one document's failure cannot fail the batch

- [ ] **The AD-10 boundary guard** (AC: 4)
  - [ ] Extend the security guard tests: no code path passes document bytes or raw extracted text toward the reasoning side
  - [ ] Extraction and reasoning credentials are distinct names and never read by the same module
  - [ ] Follow the shape of `core/security/nfr2-guard.test.ts` — a guard that fails the pipeline, not a convention

- [ ] **Surface: staged extraction progress** (AC: 1, 3)
  - [ ] UX-DR12's extraction-progress state, and the unreadable rejection distinct from 1.4's four states
  - [ ] **Partial extraction is never displayed under any state** (UX-DR12, verbatim requirement)
  - [ ] Live region for progress (UX-DR20); tokens only — `core/design/no-raw-values.test.ts` enforces this

## Dev Notes

### The four decisions, as decided

Settled 2026-08-04. Recorded with the reasoning so a later reader sees a decision rather than an accident.

**1. Transport — `fetch`. Decided.**
The adapter needs `responseMimeType: application/json` and `responseSchema` on the request body. Both are plain REST fields, so `fetch` is sufficient and adds **zero dependencies**, which matches how this project has resolved every previous such choice (scrypt over argon2, a hand-rolled acceptance gate over a validation library). The `@google/genai` SDK buys retry handling and typed request construction at the cost of a dependency in the data plane. Retry and timeout handling are written by hand, as they were for S3.

**2. Excel — SheetJS from its own registry. Decided.**
CSV is parsed here: RFC 4180 quoting is fiddly but small and highly testable, and a hand-rolled parser keeps AC2's "no model involved" trivially true. **Excel is not hand-rolled** — `.xlsx` is a ZIP of XML and `.xls` is an OLE compound file.

Install SheetJS **from `https://cdn.sheetjs.com`, pinned to an exact version tarball**. Do *not* `npm i xlsx`: that package is the abandoned npm distribution and carries a prototype-pollution advisory, which matters especially here because this code parses untrusted uploaded files.

Two consequences to handle rather than discover: the exact tarball URL lands in `package-lock.json`, so **the GitLab runner must be able to reach that host** — confirm the pipeline still passes `npm ci` before calling the task done. And SheetJS's own guidance on untrusted input applies: parse with the options that disable formula evaluation and external references.

**3. Live provider verification — in scope. Decided.**
Build the adapter against an **injected client** and unit-test it with a fake, so the suite needs no key. Then add `GEMINI_API_KEY` to `.env.example` by name and write `scripts/verify-extraction.mjs`, the counterpart of `scripts/verify-storage.mjs`: reach the provider, get a schema-locked reply that parses, and confirm a schema violation is genuinely refused rather than silently coerced.

**The key is not yet in `.env.local`.** Everything except the probe can be built and proven without it. Run the probe once it is present; until then the story cannot claim a real document has been read, and must not imply otherwise.

**4. Where AC5's constraints live — typed columns. Decided.**
1.4 put every constraint it could into the database, and that decision repeatedly earned itself. Doing the same here means the `extraction` table has typed columns with `check` constraints rather than a single `jsonb` blob — length caps, a currency enum, an amount sign rule, a date format. The alternative (jsonb + validator-only constraints) is more flexible for a schema still in flux, but AC5 says fields are constrained "when stored", and a validator is not the store. The schema module asserts parity with the migration's constraints, in both directions, reading the SQL rather than restating it.

### What a "structured record" actually holds

The ACs never say, and the dev agent must not invent it silently. Minimum viable field set, chosen so 1.6 has a vendor to resolve and epic 2 has figures to cite:

| Field | Type | Constraint (AC5) |
| --- | --- | --- |
| `document_kind` | enum | `invoice`, `statement`, `assessment_roll`, `other` |
| `vendor_name` | text, nullable | 1–200 chars; nullable because 1.6 owns resolution, and an unread vendor is not an error here |
| `document_number` | text, nullable | 1–64 chars — invoice or statement number |
| `issued_on` | date, nullable | a real date, not a string |
| `total_amount` | numeric(14,2), nullable | see the sign rule below |
| `currency` | text | ISO-4217, enum of what the pilot supports (`USD` at minimum) |

**Money is `numeric`, never a float.** Postgres `numeric(14,2)` and a string in transit. A binary float cannot represent 0.10, and this is an association's ledger.

**Decide the sign rule and write it in the migration.** Either amounts are always positive and `document_kind` carries the direction, or negatives are permitted and mean a credit. Both are defensible; silence is not, because the anomaly detection in epic 2 depends on it.

Nullable is deliberate for most fields: a statement has no vendor, and AC3 already covers the case where the document could not be read at all. **A null is "this document does not have one"; it is never "extraction was unsure".** If a confidence signal is wanted, that is a separate column and a separate decision — do not smuggle uncertainty into a null.

### The provider, concretely

`gemini-3.1-flash-lite` (ARCHITECTURE-SPINE.md#Stack), reached over the REST API with `responseMimeType: application/json` and `responseSchema`. Credential name: **`GEMINI_API_KEY`**, added to `.env.example` by name only.

The reasoning side is `claude-sonnet-5` with its own key, in the Python service, and does not exist yet. AC4's guard is therefore mostly a **seam plus a test** — assert now that the two credentials are distinct names and that no module reads both, so epic 3 cannot quietly merge them.

### Already built — do not rebuild

| Thing | Where | Note |
| --- | --- | --- |
| Content hashing | `core/ingestion/content-hash.ts` | Hash precedes extraction and must keep doing so |
| Accept/reject gate | `core/ingestion/acceptance.ts` | Type allowlist, size limit, container checks, closed rejection reasons |
| The `document` table | `migrations/004_document.sql` | Metadata only; bytes are in object storage |
| Object storage | `adapters/storage/document-store-s3.ts` | The only AWS SDK importer; injected client, bounded timeouts |
| Document repository | `adapters/db/document-repository-postgres.ts` | Writer role; `on conflict do nothing` |
| **`replaceDerivedRows`** | `core/ports/document-repository.ts` | **A called, tested seam with an empty body. This story fills it.** |
| Per-file ingestion outcomes | `core/ingestion/ingest.ts` | `accepted` / `already-held` / `rejected` / `failed`, one per file, in order |
| Feedback copy | `core/ingestion/upload-feedback.ts` | Closed outcome set → words; derives lists from the gate and the PRD |
| Boundary enforcement | `core/ports/boundary.test.ts` | `core/` imports nothing outward; detector tested against planted violations |
| Credential guard | `core/security/nfr2-guard.test.ts` | The model for AC4's guard |

### The grant you must make on purpose

`003_reader_hardening.sql` revoked default `select` for `watchdog_reader`, so the new table inherits **nothing**. Migration 006 must decide explicitly and say why in a comment.

The likely answer is **grant SELECT** — epic 2's catalog has to return extracted figures with their source document, and that is the whole point of the table. But note the tension with AD-16 and AD-10: the reader is the role the LLM query path uses, so **whatever column holds free text is reachable by that path**. If the extraction record keeps a raw-text or notes column, granting SELECT on it puts raw extracted text one catalog entry away from the reasoning side, which AC4 forbids. Either omit such a column, or grant per-column rather than per-table.

### When extraction runs — decide this early

1.4's upload is a Server Action that ingests synchronously. Extraction adds a network call to a model provider per document, which is seconds not milliseconds, and UX-DR12 asks for **staged named progress**, implying the treasurer watches it happen.

Three options, in increasing cost: keep it synchronous and accept a slow upload for small batches; return after storage and extract on a follow-up request the surface polls; or introduce a job queue. There is no queue in this project and adding one is a significant architectural addition — **it is not in this story's scope and should not be introduced without asking.**

Whatever is chosen, two constraints hold: the `document` row and its bytes must be durable **before** extraction begins, so a provider failure never loses the upload; and a document with no extraction yet must be distinguishable from one whose extraction failed. Those are different states and the surface shows different things for each.

### AD-13's other half comes due

1.4 built `replaceDerivedRows(documentId)` as a called, tested no-op with a comment saying 1.5 fills it in. This is that. Re-ingesting known bytes must **replace** this document's extraction rather than append a second one — and the same reasoning as 1.4 applies: prefer a database constraint (one live extraction per document) over an application check, because two concurrent re-ingests both read before either writes.

### Scope boundary against story 1.6

| This story | Story 1.6 |
| --- | --- |
| Extract fields, validate them, store them with constraints | Resolve `vendor_name` against a known-vendor table |
| Record an unresolved vendor as an extracted **value** | The quarantine queue, its surface, and the human-confirm flow |
| The unreadable outcome and its copy | The quarantine-waiting upload state |

AD-8 covers both — value constraints here, vendor resolution and quarantine there. Do **not** create the quarantine tables in this story; do leave the vendor field extractable so 1.6 has something to resolve.

### Non-negotiables

- **AD-9:** schema conformance is enforced **at the extractor's API layer**, not only after the reply arrives. Sending the schema and validating the response are both required; either alone is half the rule.
- **AD-10:** different vendor, different credential, different deploy unit. Raw bytes and raw extracted text never enter the reasoning context on any code path.
- **AD-8:** extracted strings are never string-interpolated into any prompt. Prompts carry row identifiers; tools resolve values.
- **AD-1:** uploads remain the only data plane. Extraction reads what ingestion stored; it does not fetch from anywhere else.
- **NFR-2/AD-2:** no banking or payment-rail credential, ever. An extraction key is not one, but it is a new secret — it belongs in `.env.example` by name only, and `nfr2-guard.test.ts` will see it.

### Two regressions this story will trip

**`nfr2-guard.test.ts` reads `.env.example` on every run.** Adding `GEMINI_API_KEY` puts a new secret name in front of the forbidden-credential detector. An earlier key (`R2_WRITE_TOKEN`) tripped the write-token rule and needed a deliberate scope decision recorded in `core/security/forbidden-credentials.ts`. Check whether an extraction key trips it **before** assuming it passes — and if it does, that is an AD-2 scope decision to raise, not a test to loosen.

**`npm run test:db` covers `migrations/` and `adapters/db/` only.** A new database-backed test outside those directories will not run under that script, and will *skip* silently under `npm test` where no credentials exist — reporting green while proving nothing. Put DB tests in those directories or extend the script, as story 1.4 did.

### Testing standards

`bmad-dev-tdd` applies: failure-mode analysis per behaviour, then red → green → harden, with the Step 9 sensitivity check on each task's load-bearing assertion.

Story 1.4's Dev Agent Record is the reference for the expected shape, and its hardest-won lesson applies directly here: **a guard that reads as protective and proves nothing is the failure mode of this codebase.** Ten were found during 1.4 and the pipeline work. Extraction is fertile ground for more, because the provider is faked in every test — a fake that returns whatever the test wants proves nothing about schema enforcement. Prefer:

- an **independent oracle** where one exists (a fixture reply captured from the real provider, validated against the schema by a second implementation);
- **inverse tests** — a reply that violates each constraint must be rejected, one constraint at a time;
- **sensitivity checks** — remove a constraint, confirm exactly the test that covers it fails.

Cross-check to include: the schema module's constraints and the migration's constraints must be asserted equal, in both directions, reading the SQL rather than restating it. `core/ingestion/acceptance.test.ts` and `content-hash.test.ts` both do this and are the pattern to copy.

### Project Structure Notes

```text
core/extraction/schema.ts        # NEW — the one schema definition
core/extraction/validate.ts      # NEW — validation + the unreadable outcome
core/extraction/tabular.ts       # NEW — deterministic CSV/Excel parsing
core/ports/extractor.ts          # NEW — the port
adapters/extraction/             # NEW — the only place the provider is constructed
adapters/db/extraction-repository-postgres.ts   # NEW — writer role
migrations/006_extraction.sql    # NEW
scripts/verify-extraction.mjs    # NEW — connectivity probe, mirrors verify-storage.mjs
app/upload/                      # UPDATE — extraction progress + unreadable state
```

`core/` imports nothing outward — `core/ports/boundary.test.ts` enforces it and will fail on a provider SDK import in `core/`.

### A note on size

This story is larger than 1.4, which was already large: it spans a schema, a migration, a provider adapter, a deterministic parser, a validation layer, a boundary guard, and a surface change. If you would rather split it, the natural seam is **AC2** — deterministic tabular parsing shares the record shape and the storage path but touches no provider, no credential, and none of AD-9/AD-10. Splitting there would give two reviewable stories instead of one large one. Flagging it rather than deciding it.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5]
- [Source: docs/prd/prd.md#FR-2] and #FR-3 — extraction isolation and schema conformance
- [Source: ARCHITECTURE-SPINE.md#AD-9] — schema enforced at the extractor's API layer
- [Source: ARCHITECTURE-SPINE.md#AD-10] — the dual-LLM boundary is a vendor boundary
- [Source: ARCHITECTURE-SPINE.md#AD-8] — extracted values are data, never instructions
- [Source: ARCHITECTURE-SPINE.md#AD-13] — idempotency, and the replacement half
- [Source: ARCHITECTURE-SPINE.md#AD-16] — narrow storage port; the model for the extractor port
- [Source: ARCHITECTURE-SPINE.md#Stack] — `gemini-3.1-flash-lite`, `claude-sonnet-5`
- [Source: epics.md#UX-DR12] — extraction progress; partial extraction never displayed
- [Source: epics.md#UX-DR20] — live regions for extraction progress
- [Source: _bmad-output/implementation-artifacts/1-4-upload-a-document-and-see-it-accepted-or-rejected.md] — the seam this story fills, and the vacuous-guard record

## Dev Agent Record

### Agent Model Used

### Test Design

### Debug Log References

### Completion Notes List

### File List

### Change Log
