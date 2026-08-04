# Story 1.5: Read a document into structured records

Status: ready-for-dev

> **First half of epic story 1.5, split at the AC2 seam.**
> This story owns the **deterministic path** — CSV and Excel — and the foundation both halves share: the record shape, the `extraction` table, validation, the unreadable outcome, and AD-13's replacement.
> **Story 1.5b** owns the **provider path** — PDF and image extraction, AD-9 schema enforcement, and the AD-10 vendor boundary.
> Deliberately in this order: the domain defines the record shape from data it fully controls, and the vendor then conforms to it. The reverse lets a provider's output shape the schema.

## Story

As a treasurer,
I want the system to read the figures out of the spreadsheets and exports I already have,
so that I do not have to key them in, and so nothing is recorded that could not be read reliably.

## Acceptance Criteria

Epic story 1.5's ACs 2, 3 and 5. AC1 and AC4 belong to 1.5b.

**AC1 — A CSV or Excel file is parsed deterministically, with no model involved**

**Given** an uploaded CSV or Excel file
**When** it is processed
**Then** it is parsed deterministically with no model involved at any point
**And** the resulting structured record is stored against the document

**AC2 — A file that cannot be read halts for that document and stores nothing**

**Given** a file whose contents cannot be parsed into a valid record
**When** the pipeline evaluates it
**Then** the pipeline halts for that document and returns a structured "Document Unreadable" error
**And** no partial or best-effort record is stored or displayed

**AC3 — Stored fields carry constraints beyond type**

**Given** an extracted field
**When** it is stored
**Then** value-level constraints beyond type are enforced — length caps, format, and enums where applicable

**AC4 — Re-ingesting a document replaces its records rather than accumulating them**

**Given** a document that already has an extraction
**When** the same bytes are ingested again
**Then** the existing extraction is replaced, not duplicated
**And** exactly one live extraction exists for that document

## Tasks / Subtasks

- [ ] **Migration `006_extraction.sql`** (AC: 1, 3, 4)
  - [ ] `extraction` table keyed to `document`, following the conventions in `004_document.sql`
  - [ ] Value-level constraints as **database** constraints — length caps, format regex, enums (AC3)
  - [ ] Exactly one live extraction per document as a **database** constraint, not an application check (AC4, AD-13)
  - [ ] Explicit `grant` decision for `watchdog_reader` (migration 003 revoked defaults — see Dev Notes)

- [ ] **The record shape** `core/extraction/record.ts` (AC: 1, 3)
  - [ ] One definition of what a structured record is, shared by both halves of this story
  - [ ] Value constraints live here and are asserted to agree with the migration, read from the SQL rather than restated
  - [ ] Money is `numeric`/string, never a float — see Dev Notes

- [ ] **Validation and the unreadable outcome** `core/extraction/validate.ts` (AC: 2)
  - [ ] Reject on any constraint violation; return a structured result, never a thrown parser error
  - [ ] `Document Unreadable` as a closed outcome the surface renders, matching `core/ingestion/acceptance.ts`
  - [ ] **No verbatim copy exists for this case.** FR-1 dictated the unreadable-*file* sentence word for word; FR-3 specifies only a "structured Document Unreadable error" with no wording. Write it in EXPERIENCE.md's voice and keep it distinct from FR-1's — a file that could not be *opened* and a document that could not be *read* are different events, and a treasurer acts differently on each
  - [ ] No partial record survives a failure — asserted, not assumed

- [ ] **Deterministic parsing** `core/extraction/tabular.ts` (AC: 1)
  - [ ] CSV parsed by a hand-rolled RFC 4180 parser — quoting, embedded commas, embedded newlines, CRLF
  - [ ] Excel via SheetJS, **pinned from `https://cdn.sheetjs.com`** — see Dev Notes for why not npm, and the untrusted-input options
  - [ ] A test proves no model path is reachable for these types
  - [ ] **Confirm `npm ci` still passes in the GitLab pipeline** once the SheetJS pin lands in `package-lock.json`

- [ ] **Extraction repository** `adapters/db/extraction-repository-postgres.ts` (AC: 1, 4)
  - [ ] Writer role, following `document-repository-postgres.ts`
  - [ ] Replacement is a single statement, so two concurrent re-ingests cannot both insert

- [ ] **Wire into ingestion** (AC: 1, 2, 4)
  - [ ] Parsing runs after the `document` row exists — hashing still precedes everything (1.4's AC1)
  - [ ] **`replaceDerivedRows` finally gets a body** — 1.4 left it a called, tested no-op for exactly this
  - [ ] Per-file outcomes extended for unreadable; one document's failure cannot fail the batch

- [ ] **Surface** (AC: 1, 2)
  - [ ] The unreadable-document state, distinct from 1.4's four outcomes
  - [ ] **Partial extraction is never displayed under any state** (UX-DR12, verbatim requirement)
  - [ ] Tokens only — `core/design/no-raw-values.test.ts` enforces this

## Dev Notes

### What a structured record holds

The ACs never say, and this must not be invented silently. This story defines it; 1.5b conforms to it.

| Field | Type | Constraint (AC3) |
| --- | --- | --- |
| `document_kind` | enum | `invoice`, `statement`, `assessment_roll`, `other` |
| `vendor_name` | text, nullable | 1–200 chars; nullable because 1.6 owns resolution, and an unresolved vendor is not an error here |
| `document_number` | text, nullable | 1–64 chars — invoice or statement number |
| `issued_on` | date, nullable | a real date, not a string |
| `total_amount` | numeric(14,2), nullable | see the sign rule below |
| `currency` | text | ISO-4217, enum of what the pilot supports (`USD` at minimum) |

**Money is `numeric`, never a float** — `numeric(14,2)` in Postgres, a string in transit. A binary float cannot represent 0.10, and this is an association's ledger.

**Decide the sign rule and write it into the migration.** Either amounts are always positive with `document_kind` carrying direction, or negatives are permitted and mean a credit. Both defensible; silence is not, because epic 2's anomaly detection depends on it.

Nullable is deliberate for most fields: a statement has no vendor. **A null means "this document does not have one" — never "the parser was unsure".** Uncertainty is not a null; if a confidence signal is wanted it is a separate column and a separate decision.

### Excel: SheetJS, and not from npm

`.xlsx` is a ZIP of XML and `.xls` is an OLE compound file — neither is reasonably hand-rolled, unlike CSV.

Install SheetJS **from `https://cdn.sheetjs.com`, pinned to an exact version tarball**. Do **not** `npm i xlsx`: that is the abandoned npm distribution and carries a prototype-pollution advisory, which matters acutely here because this code parses files uploaded by anyone with an account.

Two consequences to handle rather than discover:

- The exact tarball URL lands in `package-lock.json`, so **the GitLab runner must reach that host for `npm ci`**. Verify the pipeline passes before calling the task done — an install that works locally and fails in CI is the failure this note exists to prevent.
- SheetJS's untrusted-input guidance applies. Parse with formula evaluation and external references disabled.

### The grant you must make on purpose

`003_reader_hardening.sql` revoked default `select` for `watchdog_reader`, so `extraction` inherits **nothing**. Migration 006 must decide explicitly and say why in a comment.

The likely answer is **grant SELECT** — epic 2's catalog must return extracted figures with their source document. But note the tension with AD-10: the reader is the role the LLM query path uses, so **any column holding free text is reachable from that path**. If the record ever gains a raw-text or notes column, granting SELECT on it puts raw extracted text one catalog entry from the reasoning side, which AD-10 forbids. Omit such a column, or grant per-column rather than per-table.

### AD-13's other half comes due

1.4 built `replaceDerivedRows(documentId)` as a called, tested no-op with a comment saying 1.5 fills it in. This is that.

The same reasoning as 1.4's uniqueness constraint applies: prefer a **database** guarantee of one live extraction per document over an application check, because two concurrent re-ingests both read before either writes. 1.4's `document-repository-postgres.test.ts` contains a deterministic interleaving test — hold an uncommitted insert, poll `pg_stat_activity` until the second is genuinely blocked, then commit. Copy that technique; a `Promise.all` test proved nothing there and will prove nothing here.

### When parsing runs

1.4's upload is a Server Action that ingests synchronously. Deterministic parsing is fast and local, so **synchronous is fine for this story** — the queue question belongs to 1.5b, where a model call makes it real.

Two constraints hold regardless: the `document` row and its bytes must be durable **before** parsing begins, so a parse failure never loses the upload; and a document with no extraction yet must be distinguishable from one whose extraction failed. Different states, different things shown.

### Already built — do not rebuild

| Thing | Where | Note |
| --- | --- | --- |
| Content hashing | `core/ingestion/content-hash.ts` | Hash precedes parsing and must keep doing so |
| Accept/reject gate | `core/ingestion/acceptance.ts` | Type allowlist, size limit, container checks, closed rejection reasons |
| `document` table | `migrations/004_document.sql` | Metadata only; bytes in object storage |
| Document repository | `adapters/db/document-repository-postgres.ts` | Writer role; `on conflict do nothing`; the interleaving test to copy |
| **`replaceDerivedRows`** | `core/ports/document-repository.ts` | **A called, tested seam with an empty body. This story fills it.** |
| Per-file outcomes | `core/ingestion/ingest.ts` | `accepted` / `already-held` / `rejected` / `failed`, one per file, in order |
| Feedback copy | `core/ingestion/upload-feedback.ts` | Closed outcome set → words, derived from the gate and the PRD |
| Boundary enforcement | `core/ports/boundary.test.ts` | `core/` imports nothing outward |

### One regression this story will trip

**`npm run test:db` covers `migrations/` and `adapters/db/` only.** A database-backed test placed elsewhere will not run under that script, and will *skip silently* under `npm test` where no credentials exist — reporting green while proving nothing. Put DB tests in those directories or extend the script, as 1.4 did.

### Scope boundaries

| This story | 1.5b | 1.6 |
| --- | --- | --- |
| CSV/Excel parsed deterministically | PDF/image via the provider | — |
| The record shape, table, constraints | Conforms to them | — |
| Validation + the unreadable outcome | Reuses them for provider output | — |
| `replaceDerivedRows` | — | — |
| — | AD-9, AD-10, the credential guard, the live probe | — |
| Records `vendor_name` as a value | Same | Resolves it; quarantine queue |

Do **not** create quarantine tables, call any model, or add an extraction credential in this story. Do leave `vendor_name` populated so 1.6 has something to resolve.

### Testing standards

`bmad-dev-tdd` applies: failure-mode analysis per behaviour, red → green → harden, with the Step 9 sensitivity check on each task's load-bearing assertion.

**A guard that reads as protective and proves nothing is this codebase's characteristic failure** — ten were found during 1.4 and the pipeline work, including a `Promise.all` concurrency test that passed against a deliberately racy implementation. CSV parsing is fertile ground for more: a parser test whose fixture never exercises quoting proves nothing about quoting. Prefer independent oracles (published RFC 4180 examples), inverse tests (one constraint violated at a time), and the parity cross-check between `record.ts` and the migration, read from the SQL rather than restated. `core/ingestion/acceptance.test.ts` and `content-hash.test.ts` are the patterns to copy.

### Project Structure Notes

```text
core/extraction/record.ts        # NEW — the record shape and its constraints
core/extraction/validate.ts      # NEW — validation + the unreadable outcome
core/extraction/tabular.ts       # NEW — deterministic parsing over decoded rows
adapters/db/extraction-repository-postgres.ts   # NEW — writer role
migrations/006_extraction.sql    # NEW
app/upload/                      # UPDATE — the unreadable state
```

`core/` imports nothing outward — `core/ports/boundary.test.ts` enforces it. **SheetJS is a vendor library and must not be imported from `core/`.** Put the SheetJS call behind an adapter (or a port) and keep `core/extraction/tabular.ts` operating on already-decoded rows, the same shape of boundary the AWS SDK sits behind. Add SheetJS to the boundary test's forbidden list when it is installed.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5] — ACs 2, 3, 5
- [Source: docs/prd/prd.md#FR-3] — schema conformance and the Document Unreadable error
- [Source: ARCHITECTURE-SPINE.md#AD-13] — idempotency and the replacement half
- [Source: ARCHITECTURE-SPINE.md#AD-8] — value-level constraints
- [Source: ARCHITECTURE-SPINE.md#AD-16] — narrow ports; the model for keeping vendors at the edge
- [Source: epics.md#UX-DR12] — partial extraction is never displayed
- [Source: 1-4-upload-a-document-and-see-it-accepted-or-rejected.md] — the seam this story fills, and the vacuous-guard record

## Dev Agent Record

### Agent Model Used

### Test Design

### Debug Log References

### Completion Notes List

### File List

### Change Log
