---
stepsCompleted: [1, 2]
inputDocuments:
  - docs/prd/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-HOA-Treasurer-Assistant-2026-07-29/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/architecture/architecture-HOA-Treasurer-Assistant-2026-07-29/.memlog.md
  - _bmad-output/planning-artifacts/ux-designs/ux-HOA-Treasurer-Assistant-2026-07-30/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-HOA-Treasurer-Assistant-2026-07-30/EXPERIENCE.md
---

# AI Condo Treasury Bot (Fiduciary Watchdog) - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the AI Condo Treasury Bot
("Fiduciary Watchdog") pilot, decomposing the requirements from the PRD, the UX design contract,
and the architecture spine into implementable stories.

## Requirements Inventory

### Functional Requirements

FR-1: The Treasurer can upload financial documents and bulk data files (PDF, PNG, JPG, CSV, Excel) via the web dashboard. Unsupported types and oversized files are rejected with a clear message; password-protected, encrypted, or illegible files halt ingestion with the specified user-facing copy.

FR-2: Text and key-value pairs are extracted from uploaded documents by an isolated Document AI service, bypassing the reasoning model entirely. Raw document bytes and raw extracted text never enter the context window of the tool-calling or reasoning agents.

FR-3: Extraction output is forced into a strict pre-defined JSON schema before passing downstream. Schema-invalid output halts the pipeline and returns a structured "Document Unreadable" error rather than passing malformed data onward.

FR-4: On a user query, the system determines whether factual ledger retrieval or calculation is required and delegates to deterministic tooling. The reasoning model is blocked from predicting or calculating numerical answers from its context window.

FR-5: Answers produced via deterministic tooling expose their evidence: the UI renders a structured data table of retrieved records, and an expandable element reveals the exact query executed.

FR-6: Newly uploaded vendor invoices are automatically compared against historical payment data and vendor averages. Exact duplicates (matching amount and date) and fuzzy duplicates (similar invoice number, identical amount) are flagged, as are invoices exceeding a vendor's trailing 6-month average by a defined threshold.

FR-7: Uploaded bank deposit data is compared against the expected assessment roll to identify units with missed or partial payments, without manual reconciliation.

FR-8: Detected anomalies notify designated board members through two channels: a prioritised widget on the dashboard, and a structured automated email summarising the anomaly.

### NonFunctional Requirements

NFR-1: Role separation by pipeline stage. The ingestion pipeline authenticates with a writer role; the LLM-driven query path authenticates with a dedicated SELECT-only role and can never mutate data. Neither role may be granted the other's capability.

NFR-1a: No data credentials in the LLM runtime. The Python agent service holds exactly one secret — the reasoning model API key — and never a database credential, connection string, or storage key.

NFR-2: No external write tokens. No API key with write permission for a banking platform, payment processor, or external accounting system may exist in the environment variables, secret store, or CI configuration of any deploy unit.

NFR-3: Zero-LLM token arithmetic, enforced structurally. Every numeric token in a rendered answer must match a value present in that turn's tool result set; a pre-render validator rejects unreferenced numerals and forces a retry.

NFR-4: The reasoning model must support strict tool use and schema-validated structured outputs. Current binding is `claude-sonnet-5`; the capability bar is the invariant, not the model id.

NFR-5: Query provenance. Every catalog execution permanently logs user id, timestamp, catalog entry id and version, bound parameters, and the exact SQL — written before results return, in an append-only store.

### Additional Requirements

**No starter template is specified.** The repository is greenfield — no `package.json`, no source, no CI. The architecture names the stack but not a scaffold, so project initialisation is Epic 1 Story 1.

- Two deploy units: a Next.js gateway (Vercel) and a Python agent service (container host). Node holds all database credentials; Python holds none. (AD-3)
- **Amended 2026-07-31.** Railway-hosted Postgres provides the database; Auth.js (NextAuth v5) provides sign-in with sessions in Postgres; an S3-compatible object store holds document bytes. Gateway, agent service and Postgres run on one Railway private network, so the database is not publicly reachable. Two DB roles required: `watchdog_writer` (ingestion only) and `watchdog_reader` (SELECT-only, catalog execution only), created as ordinary Postgres roles in a migration. (AD-3, AD-4, AD-16) *Supersedes the original Supabase binding, which was blocked for this project; Supabase had been carrying Postgres, auth and storage as one vendor, and only the first had a drop-in replacement.*
- Uploads-only data plane. No connection to any external accounting system, bank, or property-management API. (AD-1)
- The air-gap is enforced by absence of credentials, asserted by a CI check rather than by convention. (AD-2)
- A version-controlled parameterized query catalog. Tool definitions declare `strict: true` and `additionalProperties: false`. The model never authors SQL. (AD-5)
- Catalog entries must return all derived values (deltas, percentages, trailing averages, counts) — the model cannot compute them. (AD-6)
- Pre-render numeric validator with an explicit formatting-normalisation rule. (AD-7)
- Value-level constraints on extracted fields; vendor identity resolved against a known-vendor table with a human-confirm quarantine queue; extracted strings never interpolated into prompts. (AD-8)
- Extraction invoked with machine-enforced schema (`responseMimeType` + `responseSchema`). (AD-9)
- Vendor boundary: extraction on `gemini-3.1-flash-lite`, reasoning on `claude-sonnet-5`. Different keys, different deploy units. (AD-10)
- Ingestion idempotent on document content hash; alerts keyed on `(finding_type, subject_id, period)` so reprocessing is a no-op. (AD-13)
- Catalog entry versions immutable once used in production; changing SQL mints a new version. CI diff check required. (AD-14)
- Versioned `/tools/*` endpoints are the sole data path and must reject any non-agent caller. Auth mechanism undecided. (AD-15)
- Python service pins 3.13 — CrewAI `requires_python` is `<3.14,>=3.10`, and the ambient interpreter is 3.14.
- Test harnesses: Vitest (Node/Next) and pytest (Python 3.13). Both run in CI alongside lint and build.
- Deferred and explicitly out of scope: multi-tenancy, retention/deletion policy, backup and recovery posture.

**Cloud storage ingestion — later epic, sequenced after the core pilot.** Direct upload remains the
primary path and is not replaced. Built as a provider-agnostic port with Dropbox and Google Drive
adapters. Requirements:

- CS-1: Amend AD-1 before this epic starts — its "exclusively through user upload" rule becomes false. The intent (no connection to a bank or accounting system of record) survives; cloud storage is a document source, not a financial rail. AD-2 is unaffected.
- CS-2: Provider-agnostic connector port with two adapters, so neither provider's model leaks into the ingestion pipeline.
- CS-3: OAuth connect and disconnect, with token storage held by the Node gateway (AD-3 consistent) and refresh handling.
- CS-4: Folder selection, scoped as narrowly as the provider permits — Dropbox app-folder; Google `drive.file` unless the restricted-scope assessment is accepted.
- CS-5: Change detection (polling or provider webhooks) feeding the existing ingestion pipeline. AD-13's content-hash idempotency already makes repeated presentation a no-op.
- CS-6: **Connection health and a stopped-watching alert.** A connector that silently fails leaves the board believing they are covered while nothing is checked — this is a requirement, not an enhancement.
- CS-7: Revocation and permission-change handling, including what happens to already-extracted records when a source file is deleted upstream.
- CS-8: Scope disclosure in the UI, and redrafting the board explainer's claim that the system "sees the documents the board chooses to upload and nothing else," which stops being true.
- CS-9: Google `drive.readonly` is a restricted scope requiring an annually-revalidated third-party CASA assessment (~$500–$4,500/yr). Provider burden is asymmetric and affects sequencing within this epic.

### UX Design Requirements

UX-DR1: Implement the DESIGN.md token set as the single source of styling truth — colors, typography, spacing, rounded, components. Light theme only; no dark theme in the pilot.

UX-DR2: Margin tick severity component — 3px gutter bar (`flag` / `brass`), always paired with a plain-language text label ("Needs review" / "Worth checking"). Never the sole carrier of meaning; never "HIGH"/"MED".

UX-DR3: Figure block component — serif tabular figure with label above, non-interactive, carrying a mandatory "as of" date whenever underlying documents predate the current period.

UX-DR4: Finding row component — whole row is the click target; tick, title, evidence line, right-aligned amount. The amount is never a separate link.

UX-DR5: Evidence table component — real table semantics (`<table>`, `<th scope>`, caption naming the catalog entry), tabular right-aligned numerics, hairline rules, no truncation of amounts or unit identifiers at any viewport.

UX-DR6: Query disclosure component — collapsed by default, keyboard-operable with state announced, labelled with catalog entry and version, open state persisting for the session.

UX-DR7: Persistent ask field on the dashboard — submitting navigates to the Oracle with the question already sent, no intermediate empty state. Must not overlay focusable content; reserves scroll padding if sticky.

UX-DR8: Export control component — states what will be produced before producing it, with count. Never a filled button. Minimum 24×24 CSS px target.

UX-DR9: Focus ring — 2px ink with 2px offset on stone grounds; inverse ring using `on-ink` on ink grounds. Never removed, never colour-only.

UX-DR10: Dashboard surface — figure blocks, persistent ask field, unreviewed findings list, quarantine entry point, register link.

UX-DR11: Oracle surface — three-layer answer: prose, always-visible evidence table, collapsed query disclosure. The question remains visible while the answer resolves.

UX-DR12: Upload surface with five states — staged named extraction progress, added, unreadable-document rejection, password-protected rejection, and quarantine-waiting. Partial extraction is never displayed under any state.

UX-DR13: Finding detail surface, including the already-reviewed state reached from an old email link.

UX-DR14: Reviewed register surface — permanent record, search, board-packet export, empty state, export-in-progress state.

UX-DR15: Quarantine queue surface — unknown vendor shown alongside its source document; confirm as new or match to existing.

UX-DR16: Access log surface — who asked what and when, filterable, exportable, with empty and filtered-to-nothing states distinguished.

UX-DR17: Oracle no-catalog-match state — names what it cannot answer and offers the nearest supported question in one response. Never improvises, approximates, or silently answers a narrower question.

UX-DR18: Oracle service-unavailable state — distinct from no-catalog-match; question retained on screen, retry offered, no partial answer shown.

UX-DR19: Cold-load treatment on every surface — skeleton rules that fill, never a full-page spinner on a financial surface.

UX-DR20: WCAG 2.2 AA conformance — measured contrast per tokens, colour never the sole channel, full keyboard operation with no traps, visible focus, 24×24 (44×44 phone) targets, live regions for extraction progress and answer arrival, flexible row heights, currency announced as currency, accessible authentication.

UX-DR21: Responsive reflow below 48rem — evidence tables become stacked label/value groups, one record per group, retaining tabular figures. Never a horizontal scroll.

UX-DR22: Print treatment for the reviewed register and finding detail — the board packet is read on paper by some directors.

UX-DR23: Microcopy per Voice and Tone — plain language inside formal structure, never implying certainty the system lacks ("possible duplicate", not "duplicate"), never claiming an action the architecture forbids, errors stating what to do next without apology.

UX-DR24: Enforced anti-patterns — no confidence scores shown to board members, no chat-app conventions (bubbles, typing indicators, avatars), no affordance resembling a payment action, no reassurance without a count of what was checked.

### FR Coverage Map

FR-1: Epic 1 — Upload of PDF/image/CSV/Excel with rejection and unreadable states
FR-2: Epic 1 — Isolated extraction; raw bytes and raw text never reach the reasoning context
FR-3: Epic 1 — Schema conformance enforced at the extractor API; invalid output halts
FR-4: Epic 2 — Intent routing to the parameterized query catalog; model never computes
FR-5: Epic 2 — Answer, always-visible evidence table, expandable query
FR-6: Epic 3 — Duplicate and billing-spike detection against vendor history
FR-7: Epic 3 — Dues triangulation of deposits against the assessment roll
FR-8: Epic 3 — Dashboard findings widget and structured email alerts

Non-FR requirements are carried as follows: NFR-1, NFR-1a, NFR-2 in Epic 1 (they constrain how
data enters and who holds credentials); NFR-3, NFR-4, NFR-5 in Epic 2 (they constrain how answers
are produced and recorded); CS-1 … CS-9 in Epic 4.

## Epic List

### Epic 1: Trusted intake — get the records in, and see what was read

A treasurer can put the association's documents into the system and see exactly what was read
from each one, with anything ambiguous held for a human rather than guessed at. Delivers a
working document store with structured extraction, a quarantine queue for unknown vendors, and
the credential and role separation the whole product's safety claim rests on.

**FRs covered:** FR-1, FR-2, FR-3
**Also carries:** project scaffold (Story 1 — no starter template exists), both test harnesses in
CI, two database roles (NFR-1), no-write-credential CI assertion (NFR-2), agent service with no
data credentials (NFR-1a), content-hash idempotency (AD-13), quarantine queue (AD-8), design
tokens and core components (UX-DR1–5, 9), upload states (UX-DR12), quarantine surface (UX-DR15).

**Standalone:** yes. Even alone, a board has a document store that reads invoices and statements
reliably and refuses to guess. Enables Epics 2 and 3; requires neither.

### Epic 2: The Oracle — ask a question, get an answer you can prove

A board member can ask about dues, payments, and vendors and get an answer with the records it
came from already on screen — and the board can later see who asked what and when. This is where
the product's central trust claim becomes visible to a user.

**FRs covered:** FR-4, FR-5
**Also carries:** parameterized query catalog with immutable versions (AD-5, AD-6, AD-14), tool
endpoints as the sole data path (AD-15), pre-render numeric validator (AD-7 / NFR-3), model
capability binding (NFR-4), provenance logging and the access-log surface (NFR-5, UX-DR16),
persistent ask field (UX-DR7), evidence table and query disclosure (UX-DR6, 11), the
no-catalog-match and service-unavailable states (UX-DR17, 18).

**Standalone:** yes, given Epic 1's data. Does not require Epic 3.

### Epic 3: The Watchdog — be told before you pay

The system flags probable duplicates, unusual vendor billing, and missed dues without being
asked, and every finding lands in a permanent register the board can hand to an auditor. This is
the epic that delivers the product's name.

**FRs covered:** FR-6, FR-7, FR-8
**Also carries:** finding lifecycle (unreviewed → reviewed register, never dismissed), dashboard
findings list (UX-DR2, 4, 10), finding detail including the already-reviewed state (UX-DR13),
reviewed register with search and board-packet export (UX-DR14, 8), print treatment (UX-DR22),
structured email alerting.

**Standalone:** yes, given Epic 1's data — **provided** detection and alert copy are deterministic
rather than model-generated (see Open Question below). Does not require Epic 2.

### Epic 4: Connected document sources — later

Documents arrive from the association's existing Dropbox or Google Drive without a treasurer
uploading them by hand. Sequenced after the core pilot; direct upload remains and is not replaced.

**FRs covered:** none directly — extends FR-1's intake path.
**Also carries:** CS-1 … CS-9, including the AD-1 amendment as a prerequisite, connection health
with a stopped-watching alert, and the scope-disclosure redraft.

**Standalone:** yes, given Epic 1. Requires neither Epic 2 nor Epic 3.

---

### Recorded assumptions (approved 2026-07-30 without amendment)

These were surfaced at approval and accepted as stated. They are recorded rather than buried
because either could change the epic ordering if revisited:

1. **Epic 3 detection and alert copy are deterministic** — SQL identifies the finding, templated
   prose describes it. No reasoning model is involved in FR-6, FR-7, or FR-8. This is what makes
   Epic 3 independent of Epic 2. If model-written alert prose is wanted in the pilot, Epic 3 gains
   a hard dependency on Epic 2 and the two stop being swappable.
2. **Epics 2 and 3 are interchangeable in sequence.** Numbering reflects document order, not a
   required build order. Epic 3 completes UJ-1 (Sarah, the duplicate invoice) and delivers the
   product's headline promise; Epic 2 completes UJ-2 (David, the meeting).
3. **NFR-1a moved from Epic 1 to Epic 2** during story breakdown. The Python agent service does
   not exist until the Oracle needs it, and the principle is to create things only when a story
   requires them. The constraint is unchanged; only its location moved.

---

## Epic 1: Trusted intake — get the records in, and see what was read

A treasurer can put the association's documents into the system and see exactly what was read from
each one, with anything ambiguous held for a human rather than guessed at.

### Story 1.1: Project scaffold with a verified build

As a developer on this project,
I want a scaffolded application with lint, build, and tests running in CI from the first commit,
So that every later change is verified before it ships rather than after something breaks.

**Acceptance Criteria:**

**Given** an empty repository
**When** the scaffold story is complete
**Then** a Next.js 16.2.x application with TypeScript builds successfully
**And** Vitest is installed with at least one passing test
**And** `npm run lint`, `npm run build`, and `npm test` all run in CI on every push
**And** a failing test fails the pipeline

**Given** the CI pipeline
**When** it runs
**Then** it asserts that no environment variable, secret, or configuration value matching a banking, payment-processor, or external-accounting credential pattern exists in any deploy unit
**And** the pipeline fails if one is introduced
**And** this assertion is documented as enforcing NFR-2, so a future contributor understands why removing it is not a cleanup

### Story 1.2: Board member sign-in

As a board member,
I want to sign in to the Watchdog,
So that the association's financial records are not open to anyone with the link, and every later action is attributable to me.

**Acceptance Criteria:**

**Given** an unauthenticated visitor
**When** they request any surface other than sign-in
**Then** they are redirected to sign-in and no association data is returned

**Given** a board member with valid credentials
**When** they sign in
**Then** they reach the dashboard and their identity is available to every subsequent request

**Given** the sign-in surface
**When** it is assessed against WCAG 2.2
**Then** it satisfies 3.3.8 Accessible Authentication — no cognitive-function test without an alternative
**And** it is fully keyboard operable with a visible focus indicator

### Story 1.3: Visual foundation

As a board member,
I want every screen to be legible, consistent, and operable without a mouse,
So that I can use this during a meeting, on a laptop, without fighting the interface.

**Acceptance Criteria:**

**Given** the DESIGN.md token set
**When** the visual foundation is implemented
**Then** colors, typography, spacing, radii, and component tokens exist in code as the single source of styling truth
**And** no component defines a color or type value outside the token set

**Given** any interactive element
**When** it receives keyboard focus
**Then** a visible focus ring is shown using the ink ring on stone grounds
**And** the inverse ring is used on ink grounds, so focus is never invisible against its own background

**Given** every token pairing used for text
**When** contrast is measured
**Then** each meets or exceeds 4.5:1
**And** an automated check fails the build if a new pairing falls below it

**Given** the pilot scope
**When** themes are considered
**Then** only the light theme exists, as an explicit decision recorded in DESIGN.md

### Story 1.4: Upload a document and see it accepted or rejected

As a treasurer,
I want to upload the association's invoices, statements, and rolls,
So that the system has the records it needs, and I know immediately if a file could not be used.

**Acceptance Criteria:**

**Given** a supported file (PDF, PNG, JPG, CSV, or Excel) within the size limit
**When** the treasurer uploads it
**Then** it is stored, and a document record is created with a content hash computed before any extraction

**Given** a file whose content hash matches an already-ingested document
**When** it is uploaded again
**Then** the existing document's derived records are replaced rather than duplicated
**And** no second copy is created

**Given** an unsupported file type or a file exceeding the size limit
**When** it is uploaded
**Then** it is rejected with a message stating the accepted formats and the limit as facts
**And** the rest of the batch continues processing

**Given** a password-protected, encrypted, or illegible file
**When** it is uploaded
**Then** ingestion halts for that file with the user-facing copy specified in FR-1
**And** the treasurer is offered a path to replace it

**Given** the database
**When** this story is complete
**Then** two roles exist: `watchdog_writer`, used only by the ingestion path, and `watchdog_reader`, which holds SELECT only
**And** an automated test confirms that an INSERT attempted with the reader role fails

### Story 1.5: Read a document into structured records

As a treasurer,
I want the system to read the figures out of an uploaded document,
So that I do not have to key them in, and so nothing is recorded that could not be read reliably.

**Acceptance Criteria:**

**Given** an uploaded PDF or image
**When** extraction runs
**Then** it is performed by the extraction provider with a machine-enforced output schema
**And** the resulting structured record is stored against the document

**Given** an uploaded CSV or Excel file
**When** it is processed
**Then** it is parsed deterministically with no model involved at any point

**Given** extraction output that fails schema validation
**When** the pipeline evaluates it
**Then** the pipeline halts for that document and returns a structured "Document Unreadable" error
**And** no partial or best-effort record is stored or displayed

**Given** any extracted content
**When** it moves downstream
**Then** raw document bytes and raw extracted text are never passed into the reasoning model's context
**And** extraction uses a different provider and credential from the reasoning model

**Given** an extracted field
**When** it is stored
**Then** value-level constraints beyond type are enforced — length caps, format, and enums where applicable

### Story 1.6: Hold unknown vendors for a human

As a treasurer,
I want the system to ask me who an unrecognised vendor is rather than guessing,
So that a misread name never silently becomes a new vendor and corrupts the comparison history.

**Acceptance Criteria:**

**Given** an extracted invoice whose vendor does not resolve to a known vendor
**When** extraction completes
**Then** the document is placed in the quarantine queue and no vendor record is created automatically

**Given** a document in quarantine
**When** the treasurer views the queue
**Then** the extracted vendor name is shown alongside the source document it came from

**Given** a quarantined item
**When** the treasurer confirms it as a new vendor or matches it to an existing one
**Then** the vendor is resolved, the document completes processing, and it leaves the queue

**Given** a batch containing one unresolved vendor
**When** the batch is processed
**Then** only that document waits, and every other document in the batch completes normally

**Given** an empty quarantine queue
**When** it is viewed
**Then** it states plainly that all vendors on uploaded invoices resolved to known records
