# The system as built

What exists, as of story 4.8 — the last story in epic 4. This describes the code; the planning artifacts in
[`_bmad-output/planning-artifacts/`](../_bmad-output/planning-artifacts/) describe the intent, and
where the two differ **this page is the one that was checked against the source**.

Written because the three planning artifacts describe an architecture in the present tense, and not
all of it is built. A reader cannot tell which parts from those documents. They can from this one —
and the table below is kept honest as each epic lands, rather than left to drift into describing a
system that has moved on.

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

### 7. Telling the board — `core/ingestion/notify-findings.ts`

Detection raises a finding; this is what makes somebody hear about it. FR-8 asks for two channels and
both now exist: the dashboard's unreviewed list, and **one email per finding** to every board member
whose `disabled_at` is null.

**Who gets it.** Every director who has not been disabled, and nobody else. There is no recipient
model, no per-member preference and **no unsubscribe** — so the volume of findings is the volume of
email. That was chosen rather than defaulted into; if it becomes unwelcome the answer is a recipient
model, not a quieter detector.

**Once, and only once.** `finding_alert` holds one row per finding with `finding_id` unique, which is
what makes AD-13's *"never emits a second alert for a finding already raised"* a rule of the database
rather than a habit of the mailer. Re-uploading the same statement re-runs detection, every detector
amends rather than appends, and no second email goes out.

**At least once, not exactly once.** An email cannot be un-sent and a write cannot be un-written, so
the two can only be ordered. The row carries both moments: `claimed_at` when a run took ownership,
`sent_at` when it succeeded. A send that succeeds and then fails to record its success **will be sent
again**. That is the right way round for a fiduciary warning — a duplicate is a nuisance and a miss is
what the product exists to prevent — and it is stated here rather than left to be discovered.

**Plain text, no HTML.** AD-8: extracted values are data, never instructions. A vendor name lifted off
a scanned invoice goes into a subject line, and the cheapest way to keep it data is to send a document
with no markup for it to become. Every interpolated value is stripped of anything a mail agent would
read as a line break.

**What it never says.** The system holds no payment credential and can stop nothing (NFR-2), so the
message may say what was noticed and where to look, and may not say a payment was blocked, held,
cancelled or flagged. It says *possible* duplicate, because two payments matching on amount and date
is a comparison rather than an accusation.

**When it fails.** Nothing here can fail an upload — the document really was read. A failed send is
recorded against the finding, the claim is left unsent, and a later run takes it over once the claim
goes stale. **A missed alert is recovered by nothing else**, which is why it is recorded rather than
only logged: unlike a missed detection, no later upload brings it back.

**Unconfigured means silent, deliberately.** With `MAIL_API_URL`, `MAIL_API_KEY`, `MAIL_FROM` or
`WATCHDOG_BASE_URL` unset, no mail is sent, no claim is taken and no delivery row is written. The
named error goes to the log once per ingestion.

## What is not built

The planning artifacts describe these in the present tense. With one partial exception, noted first,
none of them exist.

| Component | Where it is described | Status |
| --- | --- | --- |
| The query catalogue and its one door | `architecture-walkthrough.html` | **Built** — epic 3. One entry (`dues_status@1`), executed under the reader role, with its provenance record and its version freeze, reached only through `POST /tools/v1/catalog/execute`. Routing, the numeric validator and the ask surface all landed in stories 3.4–3.8 |
| The Oracle: intent routing, the numeric validator, the ask surface | `architecture-walkthrough.html` | **Built** — epic 3, stories 3.4–3.8. Never exercised outside its tests: no board member has asked it anything |
| The watchdog and anomaly detection | `architecture-walkthrough.html`, `board-explainer.html` | **Built** — epic 4. Duplicate invoices, vendor spikes and dues shortfalls, each a deterministic SQL comparison with no model in the path |
| The CrewAI agent service | `architecture-walkthrough.html` | **Built** — epic 3, story 3.3, on the pinned Python 3.13 AD-15 requires |
| Duplicate-invoice and arrears findings | the PRD | **Built** — epic 4, with the dashboard queue, the finding detail, the reviewed register and the alert email above |

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
| The tool endpoint rejects any caller that is not the agent service (AD-15) | `core/tools/service-token.test.ts`, `app/tools/v1/catalog/execute/route.test.ts` |
| The tool endpoint is the catalog's only door (AD-15) | `core/tools/sole-data-path.test.ts` |
| No model is in the alerting path (FR-8) | `core/security/no-model-in-alerts.test.ts` |
| One alert per finding, and no second one ever (AD-13) | `migrations/finding-alert.test.ts`, `adapters/db/finding-alert-postgres.test.ts` |
| An alert is never sent without something recording who it went to | `migrations/finding-alert.test.ts` |
| The written upload contract matches the code | `docs/upload-contract.test.ts` |
| The README matches this tree | `docs/readme.test.ts` |

**One known gap, and it is a deployment one.** AD-15 protects `/tools/v1/*` two ways: the endpoints
are bound to a private network, and the caller presents a shared token. Only the token exists. The
Railway private network was deferred on 2026-08-07 and is a deployment task, not a story — so until
it is done, `AGENT_SERVICE_TOKEN` is the only thing between the public internet and the catalog. The
endpoint fails closed when that variable is unset, which is the one mitigation available from inside
the code.
