---
baseline_commit: 3422f01ea496f717e270a5b2c254e0e7001f27a4
---

# Story 1.5: Read a document into structured records

Status: in-progress

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

- [x] **Migration `006_extraction.sql`** (AC: 1, 3, 4)
  - [x] `extraction` table keyed to `document`, following the conventions in `004_document.sql`
  - [x] Value-level constraints as **database** constraints — length caps, format regex, enums (AC3)
  - [x] Exactly one live extraction per document as a **database** constraint, not an application check (AC4, AD-13)
  - [x] Explicit `grant` decision for `watchdog_reader` (migration 003 revoked defaults — see Dev Notes)

- [x] **The record shape** `core/extraction/record.ts` (AC: 1, 3)
  - [x] One definition of what a structured record is, shared by both halves of this story
  - [x] Value constraints live here and are asserted to agree with the migration, read from the SQL rather than restated
  - [x] Money is `numeric`/string, never a float — see Dev Notes

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

## Task 1 — migration `006_extraction.sql`

Three behaviours: which rows the table admits, the one-live-extraction invariant, and the role grants.

**Behaviour A — which extraction rows are representable**

*If it ran correctly, how would I know?* A fully-populated row for a real document is accepted and reads back with every value unchanged; anything violating a stated constraint is refused by the database, not by hope.

*How am I going to test this?* Against a real database, as `migrations/document.test.ts` does — skipping loudly without credentials. Constraint behaviour cannot be faked; a fake refuses whatever the fake was told to refuse.

*What else can go wrong?* Every value here arrives from a parser reading a file someone uploaded. The dangerous inputs are not gibberish — they are plausible-but-wrong: an empty vendor name that looks like data, an amount off by a rounding, a whole page of text landing in a 200-character field.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| A1 | `document_kind` outside the known set — a parser emitting a guess | GUARD | Enum check; each valid value accepted, an unknown one refused (`23514`) |
| A2 | `vendor_name` **present but empty** — a parse failure wearing the costume of data. Distinct from absent, which is legitimate | GUARD | `''` refused; `null` accepted |
| A3 | `vendor_name` over-long — a page of text, or an injection payload, in a name field | GUARD | 200 accepted, 201 refused |
| A4 | `document_number` empty or over-long | GUARD | 1 and 64 accepted; `''` and 65 refused |
| A5 | Money stored as a float, losing cents | GUARD | `numeric(14,2)`; `0.10` and `99999999999.99` round-trip **exactly**, compared as strings |
| A6 | **More than two decimals silently rounded.** `numeric(14,2)` *rounds* rather than errors, so `1.005` becomes `1.01` with no complaint — a cent invented by the schema | OUT-OF-SCOPE **here**, GUARD in Task 3 | Cannot be caught by a constraint: the column has already coerced the value before any check sees it. The validator must refuse >2 decimals **before** the insert. Recorded so it is not mistaken for handled |
| A7 | `currency` outside what the pilot supports | GUARD | Enum check |
| A8 | `document_id` absent, or pointing at no document | GUARD | `23502` and `23503` |
| A9 | Timestamps without a zone | GUARD | `timestamptz` asserted from `information_schema`, schema-scoped |
| A10 | Amount beyond the column's precision | PROPAGATE | `22003` escapes; not silently truncated |
| A11 | Sign of `total_amount` | **Decided** | Negatives permitted and mean a credit to the association — a statement genuinely shows one. The alternative needs a direction column that does not exist. Written into the migration so epic 2's anomaly detection reads a decision, not an accident |

**Behaviour B — exactly one live extraction per document**

*Could this problem happen anywhere else?* **It already did.** 1.4's `document_content_hash_unique` exists because a read-then-write lets two concurrent uploads both insert. This is the same shape one table over, and the same answer: the database decides, not the application.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| B1 | Two concurrent re-ingests both insert, so a document has two extractions and the catalog picks one arbitrarily | GUARD | `unique (document_id)`, proven by the deterministic interleaving technique from 1.4 — hold an uncommitted insert, poll `pg_stat_activity` until the second is genuinely blocked, then commit. **Not `Promise.all`**, which passed against a deliberately racy implementation last time |
| B2 | Replacement appends instead of replacing | GUARD | After replacing, exactly one row for that document |
| B3 | Replacing document X's extraction disturbs document Y's | GUARD | Y's row unchanged — scoping asserted, not assumed |
| B4 | Delete-then-insert fails between the two, leaving a document with no extraction where it had one | GUARD | Replacement is a **single** statement (`on conflict do update`), so there is no window; asserted by the interleaving test above |
| B5 | Deleting a document leaves orphaned extractions pointing at nothing | GUARD | `on delete cascade`; deleting the document removes the extraction |

**Behaviour C — role grants on the new table**

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| C1 | The reader gets nothing, because migration 003 revoked default SELECT — silent until epic 2's catalog cannot read a single figure | GUARD | Reader can SELECT `extraction` |
| C2 | The reader gets more than SELECT, re-opening AD-4 | GUARD | Reader INSERT/UPDATE/DELETE all refused (`42501`) |
| C3 | The writer was never granted, so ingestion fails at runtime rather than at migration time | GUARD | Writer INSERT/UPDATE/DELETE succeed |
| C4 | A later table silently inherits a grant | GUARD | The existing "granted nothing by default on tables added later" assertion in `roles.test.ts` must still pass |

**The grant, decided.** `watchdog_reader` gets **SELECT**, because epic 2's catalog must attribute a figure to its source document and that is this table's purpose.

The AD-10 tension is real and is resolved by what the table does *not* have: `vendor_name` and `document_number` are **bounded, typed fields** (200 and 64 characters), not raw extracted text. AD-8 already governs them — vendor identities resolve against a known-vendor table and extracted strings are never interpolated into prompts. **No column on this table may ever hold raw OCR text or a full document body.** Adding one would put raw extracted text one catalog entry from the reasoning side, which AD-10 forbids, and the grant would have to become per-column at that moment.

**Out of scope for this task:** the record type and its parsing (Task 2), the decimal-places rule (Task 3, per A6), the repository that performs the replacement (Task 5), and anything about vendors resolving to known records (story 1.6).

## Task 2 — the record shape (`core/extraction/record.ts`)

**Behaviour D — the constraint data, and membership tests over it**

*If it ran correctly, how would I know?* The kinds, currencies and limits this module publishes are
the same ones migration 006 enforces, and the membership tests answer truthfully for values that are
not members.

*How am I going to test this?* Pure data and pure predicates — no seams needed. The parity half is a
**cross-check against an independent source**: the migration SQL, read from the file rather than
restated in the test. A test that restates the list proves the test agrees with itself.

*Could this problem happen anywhere else?* **Yes, and it has.** `core/auth/sign-in-feedback.ts`
carries a comment explaining why its lookup is an explicit membership test over a frozen list rather
than an object index: `'toString' in MESSAGES` is true, so an object index returns a function where a
string was promised. The same trap is one line away here.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| D1 | The kind list drifts from `extraction_kind_known`, so a value passes here and is refused at INSERT — after the bytes are already stored | GUARD | Parity **both directions**, reading the `in (...)` list out of `006_extraction.sql` |
| D2 | The currency list drifts from `extraction_currency_supported` | GUARD | Same, same source |
| D3 | The length caps drift from the `char_length … between` clauses | GUARD | Numbers parsed out of the SQL, not restated |
| D4 | Precision or scale drifts from `numeric(14,2)`, so the module believes a range the column will refuse | GUARD | Parsed out of the column declaration |
| D5 | **The parity test's regex matches nothing and the comparison passes vacuously** — the failure shape that shipped twice in 1.4 (`0 % n === 0`, and a `for` loop over an empty list) | GUARD | Every extraction asserted non-empty and of expected size *before* it is compared |
| D6 | A membership test written as an object index, so `'toString'` and `'constructor'` are accepted as document kinds | GUARD | Both asserted false, alongside the real members |
| D7 | Money typed as `number` somewhere in the record | GUARD | Made unrepresentable by the type; a runtime test asserts the amount is a string when present, because a type is not a runtime guarantee at the database boundary |

**Out of scope for this task:** validating a candidate record (Task 3, including the decimal-places
rule carried forward from Task 1), parsing anything (Task 4), and persistence (Task 5). This task
publishes the vocabulary; it does not police it.

### Debug Log References

**Task 1 — red.** 34 failing, 0 passing. Verified the failures were for the right reason rather than
counted: a missing table raises `42P01`, and every negative assertion demands a specific SQLSTATE
(`23514`, `23502`, `23503`, `23505`, `22003`, `42501`), so none could pass vacuously. The observed
message was `expected error: relation "extraction" does not exist … to match object { code:
'23514' }` — the shape a real red should have.

**Task 1 — green.** `apply 006_extraction.sql`; database suite 92 passing (58 baseline + 34 new).

**Task 1 — sensitivity, and a false result caught before it was believed.** The first attempt
dropped the uniqueness constraint using the **writer** connection and reported all 92 still passing —
which would have read as "the tests do not detect its absence". They were not detecting anything:
the drop had failed with `must be owner of table extraction` (`42501`). The writer role has no DDL
rights, which is AD-4 working exactly as intended, and the constraint was never actually removed.

Re-run through the migration owner: dropping `extraction_document_id_key` failed **exactly three**
tests — the second-insert refusal, the upsert replacement, and the cross-document scoping test that
relies on `on conflict` — and nothing else. Restored, 92 green.

Worth keeping: a sensitivity check that reports "no test noticed" is itself a claim that needs
checking. Here the mutation silently did not happen.

**Task 2 — red, and a vacuous shape in my own tests.** 20 failed, 1 passed. The passer is correct:
it guards the parity tests by asserting the migration file actually contains the constraints, and
deliberately does not call the implementation.

But the run reported **21 tests where the finished file has 27**. Six were silently absent:
`it.each([...DOCUMENT_KINDS])` over an **empty** array generates *zero* cases and reports nothing
missing. That is the same failure shape as 1.4's `for` loop over an empty list, wearing a different
costume — and it would have hidden every membership test. Added an explicit size assertion before
the parameterised cases so an empty vocabulary cannot make them disappear.

**Task 2 — sensitivity, four mutations, all detected:**

| Mutation | Failures |
| --- | --- |
| Drift a document kind from the migration | **1** — exactly the kind-parity test |
| Drift the vendor length cap (200 → 250) | **1** |
| Drift the numeric scale (2 → 3) | 2 — parity, plus the cents assertion |
| Membership by object index instead of list `includes` | 4 — every inherited-property case |

### Completion Notes List

**Task 1 — `migrations/006_extraction.sql`.** The `extraction` table: one row per document holding
what it was read to say.

**Constraints are database constraints, not validator etiquette.** `document_kind` is a known set,
`vendor_name` is 1–200 characters when present, `document_number` 1–64, `currency` a supported list.
The empty-string cases matter as much as the length caps: absent and present-but-empty are different
facts, and only the first is legitimate — a statement has no vendor, whereas `''` is a parser that
found nothing and said so in the wrong vocabulary. It would flow downstream as a real vendor named
"".

**Money is `numeric(14,2)`, and the tests compare it as a string.** Reading it into a JS number is
the exact conversion the column exists to prevent, and a test that did so would agree with the bug.
`0.10` and `99999999999.99` both round-trip byte-identical.

**Negative means a credit to the association** — decided and written into the migration, because a
statement genuinely shows one and the alternative needs a direction column this table does not have.
Epic 2's anomaly detection will read a decision rather than an accident.

**One live extraction per document is `unique (document_id)`**, which lets the writer replace with a
single upsert. Two concurrent re-ingests cannot both insert, and there is no window in which a
document has lost its extraction — the same reasoning, one table over, as 1.4's content-hash
uniqueness. `on delete cascade` because an extraction without its document is not a record of
anything.

**The reader is granted SELECT, deliberately**, and the AD-10 tension is resolved by what the table
does *not* have: `vendor_name` and `document_number` are bounded typed fields, not raw extracted
text. The migration states that no column here may ever hold raw OCR text or a document body, and
that adding one would force this grant to become per-column.

**Task 2 — `core/extraction/record.ts`.** The vocabulary both halves of extraction share: the
document kinds, the supported currencies, the length caps, and `numeric(14,2)`'s precision and scale.

Every constant has a counterpart in migration 006, and the tests **read that file** rather than
restating its lists. A restated list proves the test agrees with itself; the drift worth catching is
a value accepted here and refused at INSERT, after the bytes are already in object storage.

The lists are `Object.freeze`d, because a caller pushing onto one would widen what the application
accepts while the database constraint stayed where it was.

Membership is `includes` over the list, never an object index — `'toString' in someObject` is true,
so an object-keyed lookup accepts every inherited property name as a document kind. The same note
sits in `core/auth/sign-in-feedback.ts`; the sensitivity check confirms four tests fail if it is
written the wrong way.

`totalAmount` is a **decimal string** in the type, not a number. The value travels as text from
parser to `numeric` column without passing through a representation that would round it.

**Carried forward to Task 3 (not handled here, and not mistaken for handled):** `numeric(14,2)`
*rounds* rather than errors, so `1.005` becomes `1.01` with no complaint — a cent invented by the
schema. No check constraint can catch it, because the column has already coerced the value before
any constraint sees it. The validator must refuse more than two decimal places **before** the
insert.

**Task 2 — red, and a vacuous shape in my own tests.** 20 failed, 1 passed. The passer is correct:
it guards the parity tests by asserting the migration file actually contains the constraints, and
deliberately does not call the implementation.

But the run reported **21 tests where the finished file has 27**. Six were silently absent:
`it.each([...DOCUMENT_KINDS])` over an **empty** array generates *zero* cases and reports nothing
missing. That is the same failure shape as 1.4's `for` loop over an empty list, wearing a different
costume — and it would have hidden every membership test. Added an explicit size assertion before
the parameterised cases so an empty vocabulary cannot make them disappear.

**Task 2 — sensitivity, four mutations, all detected:**

| Mutation | Failures |
| --- | --- |
| Drift a document kind from the migration | **1** — exactly the kind-parity test |
| Drift the vendor length cap (200 → 250) | **1** |
| Drift the numeric scale (2 → 3) | 2 — parity, plus the cents assertion |
| Membership by object index instead of list `includes` | 4 — every inherited-property case |

### Completion Notes List

### File List

**Added**

- `migrations/006_extraction.sql` — the `extraction` table, its constraints, and the reader grant
- `migrations/extraction.test.ts` — 34 tests; requires a database, skips loudly without one
- `core/extraction/record.ts` — the record vocabulary and its membership tests
- `core/extraction/record.test.ts` — 27 tests, parity read from the migration

### Change Log
