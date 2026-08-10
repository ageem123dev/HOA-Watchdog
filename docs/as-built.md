# The system as built

What exists, as of story 2.7. This describes the code; the planning artifacts in
[`_bmad-output/planning-artifacts/`](../_bmad-output/planning-artifacts/) describe the intent, and
where the two differ **this page is the one that was checked against the source**.

Written because the three planning artifacts describe an architecture in the present tense, and
roughly half of it is not built. A reader cannot tell which half from those documents. They can from
this one.

## The fork everything follows from

A spreadsheet is parsed in `core/`, deterministically, inside the request that uploaded it. A scan or
a photograph is stored, and read later by a model on a request the surface polls.

That single split explains most of the system's behaviour:

| | Spreadsheet | Scan or photograph |
| --- | --- | --- |
| Read by | `core/extraction/tabular.ts` | Gemini, via `adapters/extraction/extractor-gemini.ts` |
| When | At upload time, synchronously | On a later request |
| Cost | None | Per document |
| Fails how | A named column or row problem | A refusal, or an answer that cannot be trusted |
| Retryable | Re-export and upload again | Yes, and the claim's expiry paces it |

It is invisible in every planning artifact, and it is the first thing a maintainer needs.

## The path, step by step

### 1. The acceptance gate — `core/ingestion/acceptance.ts`

Type, then **signature bytes**, then size. The type is a claim the browser makes and the signature is
the file itself, so a `.pdf` that is really a ZIP is refused. Each file is judged alone: one refusal
in a batch of twenty does not cost the other nineteen.

`.xls` and `.xlsx` deliberately do not share a signature check — an *encrypted* `.xlsx` is also an OLE
compound file, so treating the two as one would accept a file the reader cannot open.

### 2. Storage — `adapters/storage/document-store-s3.ts`

The bytes go to R2 under a key derived from their content hash, and the database stores identity
only (AD-16). Because the key is a function of the bytes, writing the same document twice writes the
same object twice, so a failure between storing and recording leaves nothing to clean up.

Storing precedes recording. A row pointing at bytes that are not there is worse than an object with
no row: the object is self-healing, and a dangling row is a permanent lie about what the association
holds.

### 3. Reading

**Spreadsheets** go through `readWorkbook` (SheetJS, bounded at `MAX_WORKBOOK_CELLS`) and then the
same `readRows` a CSV uses. **One bad row refuses the whole document** — storing the other 199 is how
a ledger comes to be missing a line without saying so.

**Scans** are claimed first, before a byte is fetched or a token spent. The claim has a TTL, so a
crashed run frees the document; and every write that follows is fenced by the claim token, so a
runner whose claim lapsed cannot overwrite a fresher run's work.

### 4. Validation — `core/extraction/validate.ts`

Everything a model or a spreadsheet produced is untrusted. Amounts must match `AMOUNT_PATTERN`,
dates must be real calendar dates, text is bounded and trimmed, and a unit reference is refused on
any kind that cannot carry one.

### 5. What each kind becomes

| Kind | Becomes |
| --- | --- |
| `assessment_roll` | Units, holders, tenures and assessments — the only path that creates them |
| `deposit` | A payment against a unit, or a **held** line for a human |
| `invoice` | Extraction rows; an unfamiliar vendor is quarantined, never created |
| `statement`, `other` | Extraction rows |

Two of these hold rather than guess. An unknown vendor and an unknown unit both reach a person,
because attributing money to the wrong unit costs somebody their standing with the board, and a held
line costs a treasurer a question.

### 6. Ordering, and why it heals

Payments are written **before** the extraction write that settles the document. A settled document is
never re-read, so payments missing after it would be silent and permanent; payments missing before it
leave the document unsettled, re-read on the next poll, and healed. Replacement is set-replacement
(AD-13), so the retry writes the same set rather than a second copy.

## What is not built

The planning artifacts describe these in the present tense. None of them exist.

| Component | Where it is described | Status |
| --- | --- | --- |
| The catalogue / Oracle | `architecture-walkthrough.html` | **Not built** — epic 3 |
| The watchdog and anomaly detection | `architecture-walkthrough.html`, `board-explainer.html` | **Not built** — epic 4 |
| The CrewAI agent service | `architecture-walkthrough.html` | **Not built** |
| Duplicate-invoice and arrears findings | the PRD | **Not built** — epic 4 |

There is also **no CI**. The GitLab pipeline was removed on 2026-08-07 and AD-2's amendment records
it. Two controls in `security-posture.html` cite CI as their evidence; the controls still hold, and
their evidence is now a local habit rather than an automatic one.

## What holds it together

These are enforced by tests, not by convention. Each fails the gate rather than being noticed in
review.

| Invariant | Enforced by |
| --- | --- |
| No banking or payment-rail credential exists (NFR-2, AD-2) | `core/security/nfr2-guard.test.ts` |
| `core/` imports nothing outward | `core/ports/boundary.test.ts` |
| The reader database role is `SELECT`-only (AD-4) | `npm run test:db` |
| Re-ingesting a document replaces rather than appends (AD-13) | Database constraints and the repository suites |
| The two model providers stay separate (AD-10) | `core/security/dual-llm-boundary.test.ts` |
| A catalog query cannot run without first writing provenance (AD-12) | `adapters/db/catalog-executor-postgres.test.ts` |
| The provenance log is append-only, by grant (AD-12) | `migrations/query-log.test.ts` |
| A published catalog entry version cannot be edited (AD-14) | `catalog/published-versions.test.ts` |
| The written upload contract matches the code | `docs/upload-contract.test.ts` |
| The README matches this tree | `docs/readme.test.ts` |
