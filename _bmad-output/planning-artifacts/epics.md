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

NFR-1a: No data credentials in the LLM runtime. The Python agent service holds exactly two secrets — the reasoning model API key and the gateway service token (AD-15) — and never a database credential, connection string, or storage key.

NFR-2: No external write tokens. No API key with write permission for a banking platform, payment processor, or external accounting system may exist in the environment variables, secret store, or CI configuration of any deploy unit.

NFR-3: Zero-LLM token arithmetic, enforced structurally. Every numeric token in a rendered answer must match a value present in that turn's tool result set; a pre-render validator rejects unreferenced numerals and forces a retry.

NFR-4: The reasoning model must support strict tool use and schema-validated structured outputs. Current binding is `gemini-3.6-flash`; the capability bar is the invariant, not the model id.

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
- Credential and deploy-unit boundary: extraction on `gemini-3.1-flash-lite`, reasoning on `gemini-3.6-flash`. Different keys, different deploy units. The vendor clause was withdrawn 2026-08-10 when reasoning moved to Google. (AD-10)
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
FR-4: Epic 3 — Intent routing to the parameterized query catalog; model never computes
FR-5: Epic 3 — Answer, always-visible evidence table, expandable query
FR-6: Epic 4 — Duplicate and billing-spike detection against vendor history
FR-7: Epic 4 — Dues triangulation of deposits against the assessment roll
FR-8: Epic 4 — Dashboard findings widget and structured email alerts

Non-FR requirements are carried as follows: NFR-1, NFR-1a, NFR-2 in Epic 1 (they constrain how
data enters and who holds credentials); NFR-3, NFR-4, NFR-5 in Epic 3 (they constrain how answers
are produced and recorded); CS-1 … CS-9 in Epic 5.

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
reliably and refuses to guess. Enables Epics 3 and 4; requires neither.

### Epic 2: The dues ledger — who owes what, and who paid

Units, who held them and when, what each owed for the year, and what actually arrived. No
detection and no questions answered — this is the data FR-7 triangulates and the data the
catalog needs before `dues_status` can mean anything. Added 2026-08-07 after Epic 1's
retrospective established that `UNIT`, `ASSESSMENT` and `PAYMENT` are named in the ERD and
exist nowhere.

**FRs covered:** none directly.
**Also carries:** AD-1 (uploads only), AD-13 (re-upload replaces), AD-4 (writer-only).

**Standalone:** yes. A treasurer can see the roll the system holds and what it believes was paid.

### Epic 3: The Oracle — ask a question, get an answer you can prove

A board member can ask about dues, payments, and vendors and get an answer with the records it
came from already on screen — and the board can later see who asked what and when. This is where
the product's central trust claim becomes visible to a user.

**FRs covered:** FR-4, FR-5
**Also carries:** parameterized query catalog with immutable versions (AD-5, AD-6, AD-14), tool
endpoints as the sole data path (AD-15), pre-render numeric validator (AD-7 / NFR-3), model
capability binding (NFR-4), provenance logging and the access-log surface (NFR-5, UX-DR16),
persistent ask field (UX-DR7), evidence table and query disclosure (UX-DR6, 11), the
no-catalog-match and service-unavailable states (UX-DR17, 18).

**Standalone:** yes, given Epic 1's data. Does not require Epic 4.

### Epic 4: The Watchdog — be told before you pay

The system flags probable duplicates, unusual vendor billing, and missed dues without being
asked, and every finding lands in a permanent register the board can hand to an auditor. This is
the epic that delivers the product's name.

**FRs covered:** FR-6, FR-7, FR-8
**Also carries:** finding lifecycle (unreviewed → reviewed register, never dismissed), dashboard
findings list (UX-DR2, 4, 10), finding detail including the already-reviewed state (UX-DR13),
reviewed register with search and board-packet export (UX-DR14, 8), print treatment (UX-DR22),
structured email alerting.

**Standalone:** yes, given Epic 1's data — **provided** detection and alert copy are deterministic
rather than model-generated (see Open Question below). Does not require Epic 3.

### Epic 5: Connected document sources — later

Documents arrive from the association's existing Dropbox or Google Drive without a treasurer
uploading them by hand. Sequenced after the core pilot; direct upload remains and is not replaced.

**FRs covered:** none directly — extends FR-1's intake path.
**Also carries:** CS-1 … CS-9, including the AD-1 amendment as a prerequisite, connection health
with a stopped-watching alert, and the scope-disclosure redraft.

**Standalone:** yes, given Epic 1. Requires neither Epic 3 nor Epic 4.

---

### Domain detail: how dues actually work (recorded 2026-08-07)

Stated by the project lead during Epic 3 planning. It is not in the PRD, the architecture, or the
UX, and the ERD's `UNIT ||--o{ ASSESSMENT : owes` does not imply it. Recorded here because FR-7 is
unbuildable without it and it would be expensive to recover.

- **Dues are owed per member**, against their unit.
- **The billing cycle is per member, not per association** — monthly, six-monthly, or annual.
- **The amount differs per member**, driven by factors such as unit size or unit value.

**Why this matters to FR-7.** "Deposits compared against the expected assessment roll to identify
missed or partial payments" is only computable if both the expected amount *and* the cycle are
per-unit. A monthly payer and an annual payer look identical under a single global period for eleven
months of the year, and a naive comparison would report the annual payer delinquent every month
until their payment lands.

**Amount and cycle are different things.** The amount is set **annually, per unit**. The *cycle* on
which that annual amount is paid varies by member — monthly, six-monthly, or annual. A monthly payer
and an annual payer owe the same figure for the year and settle it on different cadences.

**Dues attach to the unit, not the member.** They are assigned by unit number. A member is tied to a
unit and **that member can change mid-year**, which makes membership a time-bounded relationship
rather than a column on the unit. It also means a missed payment must be attributed to whoever held
the unit *in that period*, not to whoever holds it now — attributing an arrears flag to the wrong
person is the kind of error a fiduciary tool cannot make.

**Two flags, not one.** FR-7's "missed or partial" resolves to: **paid late**, and **paid the wrong
amount**. They are distinct findings with distinct evidence.

**Consequence for the entity model.** `UNIT` is the durable entity and carries the unit number.
Membership is a dated relationship between a unit and a person. `ASSESSMENT` carries the annual
amount for a unit and year, plus the payment cycle. `PAYMENT` records what actually arrived, from an
uploaded deposit document. None of `UNIT`, `ASSESSMENT` or `PAYMENT` exists in the schema as of the
end of Epic 1, though all three are named in the ERD.

### Recorded assumptions (approved 2026-07-30 without amendment)

These were surfaced at approval and accepted as stated. They are recorded rather than buried
because either could change the epic ordering if revisited:

1. **Epic 4 detection and alert copy are deterministic** — SQL identifies the finding, templated
   prose describes it. No reasoning model is involved in FR-6, FR-7, or FR-8. This is what makes
   Epic 4 independent of Epic 3. If model-written alert prose is wanted in the pilot, Epic 4 gains
   a hard dependency on Epic 3 and the two stop being swappable.
2. **Epics 3 and 4 are interchangeable in sequence.** Numbering reflects document order, not a
   required build order. Epic 4 completes UJ-1 (Sarah, the duplicate invoice) and delivers the
   product's headline promise; Epic 3 completes UJ-2 (David, the meeting).
3. **NFR-1a moved from Epic 1 to Epic 3** during story breakdown. The Python agent service does
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

**Delivered as four stories** — 1.5 (the parts), 1.5b (persistence), 1.5c (the provider path), 1.5d
(deferred extraction and progress). That split was recorded only in `sprint-status.yaml` and the
story files, so this section read as one story for three of them; noted here retroactively.

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

**Delivered as four stories.** Split on 2026-08-05, before any implementation. The ACs above are
unchanged and remain the contract; each one is satisfied by exactly one story below, and none is
satisfied twice.

| Story | Scope | Epic ACs |
| --- | --- | --- |
| **1.6a — Recognise known vendors** | The `vendor` table and the matching rule. An extracted `vendor_name` resolves to a known vendor, or it does not. No pipeline change, no quarantine yet. | none directly — it is the mechanism the rest stand on, and its own ACs cover matching behaviour |
| **1.6b — Hold unknown vendors for a human** | Pipeline integration: an unresolved vendor puts the document in quarantine and creates no vendor record. One held document must not delay any other in the batch. | AC1, AC4 |
| **1.6c — See what is waiting** | The quarantine queue surface, read-only: each held item shown with its extracted vendor name and the source document, plus the empty state. | AC2, AC5 |
| **1.6d — Resolve a held document** | Confirm as a new vendor, or match to an existing one. The document then completes processing and leaves the queue. | AC3 |

**Why four.** Story 1.5d was 27 files and ~3,750 lines and drew four review rounds; smaller diffs are
the point of the one-story-one-MR pipeline. The split also isolates the two surface stories, which
are the first in the project to need component-rendering tests — `@testing-library/react` and `jsdom`
are not yet dependencies, and that decision belongs to 1.6c rather than being discovered mid-story.

**Matching is fuzzy, resolution is not.** Decided 2026-08-05. Similarity ranking (`pg_trgm` or
equivalent) drives *suggestions* so the treasurer sees "did you mean" ordering in the queue. The
**automatic** resolution threshold starts at normalised-exact — case-folded, trimmed, internal
whitespace collapsed — because an automatic near-match that is wrong writes a false vendor identity
into the comparison history silently, which is the exact harm this story exists to prevent. The
threshold is a recorded, tunable decision in 1.6a, not a constant buried in a query.

**Ordering note.** 1.6c is viewable before 1.6d exists: a queue you can read but not act on is a
smaller, honestly shippable step. 1.6d must not ship before 1.6c, since resolving from a queue
requires the queue.

---

## Epic 2: The dues ledger — who owes what, and who paid

*Added 2026-08-07 and **sequenced next, immediately after Epic 1**, ahead of Epics 2, 3 and 4.*

*On the number.* Renumbered 2026-08-07 from an earlier draft that placed this epic at 5 to avoid
disturbing the others. Nothing had been built against the Oracle's number, so taking 2 and shifting
the Oracle, the Watchdog and Connected sources to 3, 4 and 5 is cleaner than a number that reads out
of order. Completed story files still say "Epic 2" where they mean the Oracle; they are dated records
and were accurate when written.

The association's assessment roll and its deposits become typed records: units, who held them and
when, what each owed for the year, and what actually arrived. No detection, no questions answered —
this epic exists so that Epic 4's FR-7 has something to triangulate and Epic 3's catalog has
something to ask about beyond vendors.

**Why it is its own epic.** Epic 1 delivered `DOCUMENT`, `EXTRACTION`, `VENDOR` and
`QUARANTINE_ITEM`. The ERD also names `UNIT`, `ASSESSMENT` and `PAYMENT`, and none exist. FR-7
consumes all three. Folding them into Epic 3 would have the Oracle epic spend its first three
stories on data modelling before answering anything; folding them into Epic 4 would have the
detection epic build its own inputs. Neither is honest about what the work is.

**FRs covered:** none directly — it is the data FR-7 reasons over.
**Also carries:** AD-1 (the roll and the deposits arrive by upload, like everything else), AD-13
(re-uploading a roll replaces its rows rather than appending), AD-4 (writer-only, as with all
ingestion).

**Standalone:** yes. A treasurer can see the roll the system holds and what it believes was paid,
which is useful before anything flags anything.

### Story 2.1: Units and who holds them

As a treasurer,
I want the association's units recorded, with who held each one and when,
So that a payment or an arrears finding can be attributed to the right person even after a unit
changes hands.

**Acceptance Criteria:**

**Given** the association's units
**When** they are recorded
**Then** each is identified by its unit number, which is the durable identity dues attach to

**Given** a unit that changes hands mid-year
**When** the new member is recorded
**Then** the previous membership is closed with an end date rather than overwritten
**And** the unit's history states who held it for any date in the past

**Given** a query about who held a unit on a given date
**When** it is answered
**Then** exactly one membership is returned, or none — overlapping memberships for one unit are
rejected by the database, not by application code

### Story 2.2: What each unit owes this year

As a treasurer,
I want each unit's annual dues and its payment cycle recorded,
So that "paid the proper amount, on time" is a question with a defined answer.

**Acceptance Criteria:**

**Given** an assessment for a unit and a year
**When** it is recorded
**Then** it carries one annual amount and that unit's cycle — monthly, six-monthly, or annual

**Given** two units on different cycles with the same annual amount
**When** their assessments are compared
**Then** they owe the same total for the year and differ only in when it falls due

**Given** an assessment amount
**When** it is stored
**Then** it is held as an exact decimal — `numeric(p,s)` in the database and a decimal string across
every boundary — never a float and never a JS `number`

> **Amended 2026-08-07.** This criterion previously said "integer minor units, never a float — the
> money convention the architecture fixes for the whole system". The architecture did say that, and
> epic 1 shipped the opposite: `extraction.total_amount` is `numeric(14,2)` and
> `core/extraction/record.ts` crosses the boundary as a decimal string, pinned by a migration-text
> test. Story 2.4 compares an extracted payment against a stored assessment, so two representations
> would put a rounding conversion inside the comparison that produces arrears findings. Matt chose
> the shipped convention; ARCHITECTURE-SPINE's Money row was amended to match.

### Story 2.3: What is due, and by when

As a treasurer,
I want the annual amount turned into the instalments it is actually paid in,
So that lateness and shortfall are measurable rather than matters of opinion.

**Acceptance Criteria:**

**Given** an annual amount and a cycle
**When** the schedule is derived
**Then** the instalments sum to exactly the annual amount, with any remainder placed
deterministically rather than lost to rounding

**Given** a monthly cycle and an annual cycle for the same annual amount
**When** each is evaluated part-way through the year
**Then** each is expected to have paid exactly the instalments that have already fallen due, and the
two schedules still sum to the same annual total — the cycle changes *when* money is owed, never
*how much* is owed for the year

> **Amended 2026-08-07.** This criterion previously read: "the monthly unit is expected to have paid
> a proportion and the annual unit is not yet expected to have paid anything, and neither is
> delinquent for that reason alone". That only holds if instalments fall due at the **end** of the
> period they cover. Matt chose the real-world convention — dues are collected **in advance**, each
> instalment due on the first day of its period — so an annual payer is expected to have paid in full
> from 1 January, and the old wording would have made the schedule contradict the schedule.
>
> The surviving point is the one that mattered: a difference in cycle must never by itself produce an
> arrears finding. Under start-of-period that is expressed as "exactly the instalments already due",
> which is true for every cycle.

**Given** the derivation
**When** it runs
**Then** it is a pure function over the assessment, with no I/O and no clock of its own — the
evaluation date is a parameter

### Story 2.4: Deposits become payments

As a treasurer,
I want uploaded deposit records stored as payments against units,
So that what arrived can be compared with what was owed.

**Acceptance Criteria:**

**Given** an uploaded deposit document
**When** its records are extracted
**Then** each payment is stored against a unit, with its date and amount

**Given** a payment whose unit cannot be identified
**When** it is processed
**Then** it is held for a human in the same manner as an unrecognised vendor, and no unit is invented
**And** nothing is attributed to a unit on a guess

**Given** the same deposit document uploaded twice
**When** it is processed the second time
**Then** its payments replace rather than duplicate, as AD-13 requires of every derived row

**Ordering note.** 2.1 precedes everything: an assessment without a unit and a payment without a
unit are both meaningless. 2.3 depends only on 2.2 and is pure logic, so it can be built and
tested before any deposit exists. 2.4 is last because it is the only story that needs a document.

### Story 2.5: A deposit becomes payments when it is uploaded

*Added 2026-08-08, after 2.4.*

As a treasurer,
I want an uploaded deposit to become payments without further action,
So that what arrived is in the ledger by the time I look at it.

**Why it exists.** 2.4 built the `payment` and `held_payment` tables, the resolve-or-hold decision,
and the repository that replaces both on re-ingest — and connected none of it to the upload path.
Verified by search: outside their own tests, nothing calls `createPaymentRepository`, `resolveLine`
or `createHeldPaymentQueue`. So 2.4's AC1 — "given an uploaded deposit document… each payment is
stored against a unit" — is not true end to end.

No review caught it, because every part is correct in itself and every test passes. **A set of green
units does not add up to a working path.**

**Acceptance Criteria:**

**Given** a deposit document is uploaded and extracted
**When** ingestion completes
**Then** each line naming a known unit is stored as a payment against it, and each line that does
not is held — without anyone invoking a second step

**Given** a deposit line naming a unit in a spelling the roll does not use exactly
**When** it is resolved
**Then** it matches through `unit_normalised_number()` and only through it, and a reference that
does not fold to a known unit is held rather than guessed at

**Given** a document that is not a deposit
**When** it is ingested
**Then** nothing is written to `payment` or `held_payment`, and the vendor path behaves exactly as
it did before

**Given** the same deposit uploaded twice
**When** it is ingested the second time
**Then** its payments and held lines are replaced, not duplicated — AD-13 proved through the real
ingestion path rather than through a repository called directly

**Three gaps it closes:** `extract-document.ts` takes no payment repository; the extractor was never
taught to emit `unitReference`, so the column is null in practice; and nothing resolves a reference
to a `unit_id` — `resolveLine` takes the lookup as a parameter and no adapter implements one.

### Story 2.6: The documentation says what the code does, and ships a sample of every format

*Added 2026-08-08, to close the epic.*

As someone installing this application,
I want documentation that matches the code and a sample of every format it accepts,
So that I can get from a clone to a document the system has actually read, without reading source.

**Why it exists.** Epic 2 is finished as code and is not installable by anyone who was not in the
room. The README's Environment section still instructs a reader to take "the two values from the
Supabase project's API settings" and to provision directors "in the Supabase dashboard" — Supabase
was dropped on 2026-07-31 for Railway Postgres, Auth.js and Cloudflare R2, and `.env.example` names
ten variables. It still claims a CI pipeline that AD-2's amendment withdrew on 2026-08-07. It never
mentions `npm run migrate`, so a reader who follows it exactly ends with no tables.

And **nothing in the repository states what may be uploaded.** The contract is precise and enforced —
`REQUIRED_HEADERS`, `AMOUNT_PATTERN`, `DOCUMENT_KINDS`, `MAX_DOCUMENT_BYTES` — and lives only as
constants in five source files. Epic 1 built the gate, Epic 2 built the ledger behind it, and neither
can be used by a stranger.

**Acceptance Criteria:**

**Given** a clean clone and the README alone
**When** a reader follows it from the top
**Then** they reach a running application with a migrated database and a signed-in board member, and
every instruction is true of the code at HEAD — no step requires opening a source file, and no step
names a vendor this project does not use

**Given** the six content types the acceptance gate admits — PDF, PNG, JPG, CSV, `.xls`, `.xlsx`
**When** the README is read
**Then** there is a committed sample for each, and the README states what it contains, what the
system does with it, and what appears afterwards

**Given** a change to the upload contract — a required header, the amount pattern, a limit, a
document kind
**When** the gate runs
**Then** a test fails, naming the sample and the document that now disagree with the code. Silent
drift between the prose and the constants is the whole failure mode this story guards

**Given** the system diagram
**When** it is read
**Then** it shows the path as built — the acceptance gate, the fork between the deterministic tabular
path and the provider path, the vendor hold, and the payment write — and nothing only planned appears
unmarked

**Given** the board explainer, the walkthrough deck and the security posture
**When** a claim in one is no longer true
**Then** it is amended in place with a dated note, in the manner AD-2's own amendment uses.
Withdrawn claims are not deleted — a control register that quietly loses a row reads as one that
never had it

**The trap it has to name.** Units are not created by upload: `unit`, `unit_holder`,
`unit_membership` and `assessment` have no ingestion path and no admin surface. Upload a deposit to
a fresh install and every line is held `unknown-unit`. The system is behaving correctly and looks
broken, so a sample deposit shipped without that warning is worse than no sample.

**Sequencing note (2026-08-09).** Story 2.7 removes that trap. If 2.7 ships first — the better
order — this story's warning becomes an instruction instead: upload the roll, then the deposits.

### Story 2.7: An uploaded assessment roll becomes units, holders and assessments

*Added 2026-08-09, after 2.6 surfaced the gap.*

As a treasurer,
I want to upload the association's assessment roll and have it become the units, the people who hold
them and what each owes,
So that the deposits I upload afterwards are attributed instead of held.

**Why it exists.** This epic opens by promising that *"the association's assessment roll and its
deposits become typed records"*, and AD-1 names the roll explicitly among the things that arrive by
upload. The deposits half is built. **The roll half does not exist.** `unit`, `unit_holder`,
`unit_membership` and `assessment` have no ingestion path and no admin surface — verified by search:
outside `migrations/`, only `*.test.ts` files insert into any of the four. Uploading an
`assessment_roll` writes extraction rows and creates nothing.

So every deposit on a real installation is held `unknown-unit`, and stories 2.1, 2.2, 2.3 and 2.5
are each correct and collectively produce nothing. **This is the third time in this epic**: 2.4 built
the payment ledger and connected none of it, 2.5 existed to fix that, and 2.1/2.2 have been sitting
in the same state the whole while.

**Acceptance Criteria:**

**Given** an assessment roll is uploaded
**When** ingestion completes
**Then** each row has created or updated a unit, its holder, their membership and that unit's
assessment for the year — without anyone invoking a second step

**Given** a roll has been uploaded, and then a deposit naming those units
**When** the deposit is ingested
**Then** its lines become payments against those units rather than being held `unknown-unit`. This is
the criterion the story exists for; the others constrain how it is met

**Given** the same roll uploaded twice, or a corrected roll over an earlier one
**When** it is ingested again
**Then** nothing is duplicated, **and nothing already recorded against a unit is destroyed** — a
payment written before the re-upload is still there afterwards, against the same unit

**Given** a roll row that is defective
**When** the document is read
**Then** nothing from that document is written at all. A half-loaded roll is a set of units that look
complete and are not

**Given** `UnitDirectory` and `AssessmentDirectory`
**When** the story is finished
**Then** both are still read-only and their exhaustive port tests still pass unmodified. The
capability to create a unit lives in exactly one new place, and a deposit still cannot reach it

**The hazard it must not walk into.** `unit_membership.unit_id`, `assessment.unit_id` and
`payment.unit_id` all reference `unit (id)` with **no `on delete` action**, so all three are
`RESTRICT`. AD-13's "a re-uploaded roll replaces its rows", read literally, therefore fails the
moment a unit has a payment — and the fix a developer reaches for, `on delete cascade` on
`payment.unit_id`, makes re-uploading a corrected roll erase the ledger it exists to check. Units are
upserted on `normalised_number` and never deleted; assessments are upserted at the
`(unit_id, assessment_year)` grain the schema already names.

---

## Epic 3: The Oracle — ask a question, get an answer you can prove

A board member asks about the association's records and gets an answer with the rows it came from
already on screen, and the board can later see who asked what and when.

**FRs covered:** FR-4, FR-5
**Also carries:** AD-5, AD-6, AD-14 (the query catalog and its immutability), AD-15 and AD-3 (two
runtimes, one wire contract, and the agent holding no data credential), AD-7/NFR-3 (the pre-render
numeric validator), AD-11/NFR-4 (model capability binding), AD-12/NFR-5 (provenance logging),
UX-DR6, 7, 11, 16, 17, 18.

**Standalone:** yes, given Epics 1 and 2.

**Two constraints fix the story order, both from the architecture:**

- **AD-12**: *"A query path that can execute without writing this record is a defect."* Provenance
  cannot be a later story. It lands with the first execution path or it becomes a retrofit that logs
  only some paths.
- **AD-7**: every numeric token in a rendered answer must match a value in that turn's tool result.
  The validator must exist **before** the first answer is rendered, or the first surface story ships
  precisely the failure the product exists to prevent.

**Deployment note (decided 2026-08-07).** The Railway private network AD-15 assumes does not exist
yet. Stories 3.2 and 3.3 build against localhost with the service-token check enforced in code; the
private-network binding is a deployment task, and AD-15's network half stays untested until then.
That is a known gap, recorded rather than glossed.

### Story spine

| # | Story | Carries | Proves on its own |
| --- | --- | --- | --- |
| 3.1 | The catalog, executed and logged | AD-5, AD-6, AD-14, AD-12 | A named entry with typed parameters runs, and cannot run without writing provenance |
| 3.2 | Tool endpoints as the only way in | AD-15, AD-3 | The endpoints are the sole data path and reject an unauthenticated caller |
| 3.3 | The Python service exists | AD-3, **pytest in CI** | A second runtime holding only the model key, obtaining facts by calling Node |
| 3.4 | The model picks an entry | AD-5, AD-11, NFR-4 | Intent routing with strict tool use; no model-authored SQL is possible |
| 3.5 | The numeric validator | AD-7, NFR-3 | An unreferenced numeral is rejected and forces a retry, invisibly |
| 3.6a | The chat turn crosses the wire | AD-17 | A question reaches the agent service and an answer comes back, with nothing rendered yet |
| 3.6b | Ask and answer | UX-DR6, 7, 11 | The first user-visible Oracle, evidence table beside the answer |
| 3.7 | When it cannot answer | UX-DR17, 18 | No-catalog-match and service-unavailable as distinct, honest states |
| 3.8 | The access log | NFR-5, UX-DR16 | Who asked what, when — the provenance record given a reader |

**Story 3.6 split, 2026-08-11.** As written it meant three things: an HTTP server in the Python
service, a Node client for it, and the three UX requirements. The agent service is a *library* —
`agent/watchdog_agent/` has no entrypoint and no server — and no Node→agent call path exists
anywhere, so the spine's `NEXT -->|chat turn| PY` edge is undrawn. AD-15 governs the other direction
only. That is a wire and a surface, not one story, and the wire needs an architecture decision
(**AD-17**) before either can start.

**Why eight and not four.** Epic 1's evidence. Story 1.5 was split into four mid-flight and 1.6 into
four before implementation; the pre-split epic went materially better. Story 1.5d at 27 files drew
five review rounds, while the four 1.6 stories averaged closer to one.

**Critical path item, revised 2026-08-07.** Story 3.3 introduces Python and **must add `pytest` to
the local gate in the same story** — a `package.json` script *and* the "Tested =" line in
`bmad-ship-story`'s Project facts, so the next run inherits it. The original wording said
`.gitlab-ci.yml`; there is no CI any more (see AD-2's amendment), so a second language arrives with
no automated check of any kind behind it. That makes the local gate list the only place it can be
registered, and makes forgetting it the most likely way Epic 3 ships untested Python.

**First catalog entry.** Not `dues_status` before Epic 2 exists — that needs its tables. The
architecture uses `dues_status@2` as a *naming* example for versioning, not as a statement that the
data exists. With Epic 2 built, `dues_status` becomes the natural first entry and exercises AD-6's
derived-values rule.
