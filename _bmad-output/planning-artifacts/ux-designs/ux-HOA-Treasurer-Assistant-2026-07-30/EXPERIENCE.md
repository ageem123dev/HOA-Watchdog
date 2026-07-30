---
name: 'AI Condo Treasury Bot — Fiduciary Watchdog'
type: experience-spine
status: final
created: '2026-07-30'
updated: '2026-07-30'
stakes: regulated
form-factor: responsive-web-desktop-primary
sources:
  - docs/prd/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-HOA-Treasurer-Assistant-2026-07-29/ARCHITECTURE-SPINE.md
companions:
  - DESIGN.md
---

# Experience — Fiduciary Watchdog

## Foundation

**Form factor:** responsive web, desktop-primary. Built for a laptop; usable on a phone
chiefly so a board member can open a finding from an alert email on the device in hand.

**No UI system.** Components are built to this spine and DESIGN.md directly. If one is
adopted later, DESIGN.md tokens become the theme and this document specifies only the
behavioural delta.

**Users.** Volunteer board members — a Treasurer and a President — who are not finance
professionals and did not choose this software as a career tool. One of them will at some
point be operating it live, in front of an unhappy resident.

**Visual identity** is DESIGN.md. Tokens are referenced here by name and never redefined.

## Information Architecture

Eight surfaces. The dashboard is the front door; every other surface is reachable from it.

| Surface | Delivers | Entered from |
| --- | --- | --- |
| Dashboard | Cash position, unreviewed findings, the ask field | Sign-in |
| Oracle | Ask, answer, evidence table, query disclosure | Ask field (question already underway) |
| Upload | Document submission and its rejection states | Dashboard |
| Finding detail | One finding, its evidence, its route to the register | Dashboard row, or an email link on a phone |
| Reviewed register | Permanent record; search; board-packet export | Dashboard |
| Quarantine queue | Unknown-vendor human confirmation | Dashboard, when non-empty |
| Access log | Who asked what, when; export | Dashboard |
| Sign-in | Authentication | — |

**Closure.** Every requirement in the PRD lands on a surface, and every surface is reached by
a journey. The access log exists because NFR-5 writes a permanent provenance record that had
no reader — an audit trail nobody can open is not evidence of anything.

## Voice and Tone

**Plain language inside formal structure.** The frame is institutional; the sentences are not.
This pairing is deliberate and is the mitigation for the visual direction's austerity.

| Write | Not |
| --- | --- |
| "You already paid this amount three weeks ago." | "Probable duplicate disbursement identified." |
| "Three months have no matching deposit." | "Reconciliation variance detected across 3 periods." |
| "We couldn't read this file." | "Document ingestion failed." |

**Declared glossary mapping.** The user-facing term is **finding**. The PRD calls the same thing
an *alert* (FR-8, "Watchdog Alerts") and the architecture models it as the `ALERT` entity with
alert keying in AD-13. These are the same object at three altitudes:

| Layer | Term |
| --- | --- |
| Interface, and anything a board member reads | **finding** |
| PRD requirements | alert |
| Architecture / data model / code | `ALERT` |

A story author implementing FR-8 is building the finding surface. Do not introduce a fourth term.

Rules:

- **Name things as a board member would.** A *finding*, not an anomaly record. The *register*,
  not the archive. *Dues*, not assessments — except where the roll itself says assessments.
- **State what happened, then what it means.** Never the inference alone.
- **Never imply certainty the system does not have.** "Possible duplicate", not "duplicate".
  The system compares records; the board decides.
- **Errors say what to do next** and never apologise. "This file is password-protected. Upload
  an unlocked copy."
- **Never claim an action the architecture forbids.** No copy may suggest the system can pay,
  approve, correct a balance, or advise. AD-2 is a language constraint as much as a technical one.

## Evidence Presentation

*Product-specific. This is the mechanism by which the architecture's numeric guarantee (AD-7)
becomes visible to a human, and it is the product's central trust surface.*

Every Oracle answer renders in three layers, top to bottom:

1. **The answer** — prose, plain language, containing figures.
2. **The evidence table** — always present, never collapsed. The rows the answer came from.
3. **The query disclosure** — collapsed, labelled with catalog entry and version, opening to
   the exact SQL.

**The table is not optional.** A treasurer never has to know to ask for evidence; it is
already on screen. Only the query — which most users will never open — is behind a disclosure.

**Visual reference:** `mockups/key-screens.html` → *Oracle*, showing the three layers with a
six-month dues history. **These spines win over anything visible in any mockup.**

Every figure in the answer must be locatable in the table. If a number appears in prose that a
reader cannot find in the rows beneath it, that is a defect, not a display choice.

**In a dispute, the table is what gets read aloud** — not the prose. Design it to be read from
a laptop screen by someone under pressure: generous row height, tabular figures, no truncation
of amounts or unit identifiers at any viewport.

## Alert Lifecycle

*Product-specific. Findings cannot be dismissed by opinion.*

```
detected → unreviewed → reviewed (in register, permanent)
```

- **Nothing is ever deleted or cleared by disagreement.** A board member cannot make a finding
  go away because they believe it is wrong.
- **Reviewed moves, it does not close.** Marking a finding reviewed relocates it from the
  dashboard into the register, where it remains searchable and exportable forever.
- **The dashboard shows only unreviewed findings.** It is a queue of what nobody has looked at,
  not a list of everything ever found.
- **The register is the fiduciary artifact.** It answers "what did the board know, and when."
  Export from here feeds the board packet.

This resolves a collision the architecture creates: under uploads-only (AD-1) there is no bank
feed, so a duplicate-invoice finding the board correctly acted on by *not paying* has no event
to detect. Without the register it would sit on the dashboard forever, having succeeded.

## Component Patterns

*Behavioural. Visual specifications live in DESIGN.md → Components.*

**Margin tick.** Encodes severity positionally. Always accompanied by a text severity label —
never the sole carrier of meaning.

**Finding row.** Whole row is the click target to Finding detail. The amount is never itself a
separate link; a mis-click near money must not do something different from a mis-click near text.

**Ask field.** Persistent on the dashboard. Typing and submitting navigates to the Oracle with
the question already sent — no intermediate empty state, no second submit. Placeholder text must
not imply capabilities the catalog cannot serve.

**Query disclosure.** Keyboard-operable, state announced. Collapsed default; open state persists
for the session once a user has opened one, on the assumption that a user who wants queries wants
them consistently.

**Export control.** Present on the register and the access log. States what will be produced
before producing it ("Export 17 reviewed findings as PDF"), never a bare "Export".

**Figure block.** Non-interactive. A balance is a statement, not a link — clicking a figure must
do nothing rather than navigate somewhere unexpected on a screen about money. When the underlying
documents are older than the current period, the block carries an "as of" date; it never shows a
figure whose age is unstated.

## State Patterns

| State | Treatment |
| --- | --- |
| **Empty — nothing found** | Affirmative, not blank: "Nothing needs your attention. 14 documents reviewed." The absence of findings is a *result*, and the count is what makes it trustworthy. |
| **Empty — nothing uploaded yet** | Single clear action. The dashboard is not useful until something is uploaded, and should say so plainly. |
| **Loading — extraction** | Named stages, because it is slow and a silent spinner on a financial document invites a reload. "Reading document… checking against your records…" |
| **Loading — Oracle answer** | The question stays visible. Never replace it with a spinner. |
| **Error — unreadable document** | The PRD's FR-1 copy verbatim; offer the unlocked-copy path. |
| **Error — unsupported or oversized file** | State the limit and the accepted formats as facts, before retry. |
| **Rejected — schema failure (AD-9)** | "We couldn't read this reliably enough to use." Never show partially extracted data — a half-read invoice presented as a record is exactly the failure mode this product exists to prevent. |
| **Validator retry (AD-7)** | Invisible to the user. The user must never see a rejected draft answer. |
| **Quarantine — unknown vendor** | Blocking for that document only. The rest of the upload proceeds; the unresolved vendor waits for a human. |
| **Stale** | Findings show their detection date. Any figure older than the most recent upload is labelled as of that date. |
| **Oracle — no catalog match** | **The most likely daily failure.** AD-5 fixes the query catalog, so questions outside it are guaranteed, not hypothetical. Say plainly what can be asked instead — never imply the data is missing when it is the question that isn't supported: *"I can't answer that one. I can look up dues status, payment history, vendor totals, and invoice comparisons."* Offer the nearest supported question as a single action. Never guess, never approximate, never answer a different question than the one asked. |
| **Oracle — service unavailable** | Distinct from the above: the question was answerable but the system failed (timeout, tool endpoint down). Say so, keep the question on screen, offer retry. Never present a partial answer. |
| **Finding detail — already reviewed** | Reached from an old email link. Show the finding with its register status and the date it was reviewed, not as an actionable item. |
| **Register — empty** | "Nothing has been reviewed yet." Explain that findings arrive here after review rather than presenting it as an error. |
| **Register — export in progress** | Named progress, count stated, control disabled during. |
| **Access log — empty** | Only occurs before first use; state that questions will appear here once asked. |
| **Access log — filtered to nothing** | Distinguish from empty: "No questions match this filter" with a clear reset. |
| **Any surface — cold load** | Skeleton rules, not spinners: the ruled structure appears first and fills. Never a full-page spinner on a financial surface. |

**Visual reference:** `mockups/key-screens.html` → *Upload*, showing five states together —
including the schema-failure row, which shows nothing extracted. `mockups/directions-4.html`
holds the rejected directions.

## Interaction Primitives

- **Destructive and irreversible actions do not exist** in the pilot beyond marking a finding
  reviewed, which is itself non-destructive. Nothing needs a confirmation dialogue.
- **Marking reviewed is undoable** for the session — it moves a record, and a misclick must not
  require database access to correct.
- **Every action states its outcome in the past tense afterwards.** "Moved to register."
- **No autosave of anything financial.** Uploads are explicit; nothing is inferred from
  navigation.
- **Motion is functional only.** Disclosure open/close and row transitions. No entrance
  animation, no parallax, no ambient movement. Respect `prefers-reduced-motion` throughout.

## Accessibility Floor

**WCAG 2.2 AA is a floor, not a target.** Regulated surface.

- **Contrast** per DESIGN.md → Colors. Every token measured against its ground; the direction's
  original brass was rejected at 2.9:1.
- **Colour is never the sole channel.** Severity is tick + text label. Reconciled state is
  affirm + word.
- **Evidence tables carry real semantics** — `<table>`, `<th scope>`, a caption naming the
  catalog entry. A screen-reader user must be able to navigate a dues history by column, because
  that is the artifact under dispute.
- **Full keyboard operation**, no traps. The ask field is reachable by keyboard from the top of
  the dashboard without traversing every finding.
- **Visible focus** per `{components.focus-ring}` — never removed, never relying on colour alone.
- **Figures are announced correctly.** Currency reads as currency, not digit strings.
- **Live regions** for extraction progress and answer arrival, so a screen-reader user learns
  when a long operation completes.
- **Severity vocabulary is plain, not systemic.** The text accompanying each tick reads
  **"Needs review"** (flag) and **"Worth checking"** (brass). Never "HIGH"/"MED" — that is a
  system register and this document forbids it.
- **Focus is never obscured** (2.4.11). The persistent ask field must not overlay focusable
  content; if implemented as sticky it reserves scroll padding equal to its height.
- **Minimum target size** (2.5.8): 24×24 CSS px throughout, 44×44 on the phone surface. Applies
  to the query disclosure toggle and export controls, which are otherwise small by nature.
- **Accessible authentication** (3.3.8) binds whoever designs sign-in: no cognitive-function test
  without an alternative. Inheriting Supabase auth does not discharge this.
- **Row heights flex** to accommodate user text spacing (1.4.12). Ruled rows must not be fixed-height.
- **Print is a supported output.** Some directors read the board packet on paper; the register and
  finding detail carry a print treatment.

## Responsive & Platform

Desktop-primary; the phone surface serves one job well rather than the whole product badly.

- **Above 48rem:** full layout as designed.
- **Below 48rem:** evidence tables reflow to stacked label/value groups, one record per group,
  figures still tabular. **They do not scroll horizontally** — a table that scrolls sideways in
  a meeting is a table nobody reads.
- **Phone priority surfaces:** Finding detail and its evidence, reached from an FR-8 alert email.
  Upload and the register are desktop tasks and may be reduced to a "continue on a computer" state.

## Key Flows

Protagonist names are taken verbatim from the PRD's user journeys.

### Sarah catches a duplicate before a payment run

*Sarah is the Treasurer. It is the end of the month and she has a stack of vendor invoices to
authorise in the bank shortly.*

1. Signs in; the dashboard shows the operating and reserve figures and **one unreviewed finding**.
2. Uploads the month's invoices. Staged progress names what is happening; one PDF from a new
   vendor lands in the quarantine queue for confirmation.
3. The new finding appears with a high-severity tick: *Possible duplicate — Coastal Landscaping.*
4. Opens it. The evidence line states what was compared: same amount, same service period, invoice
   number differing by one character, cleared 21 days ago.
5. **Climax —** she opens the evidence table and sees both invoices side by side, and it is
   immediately obvious this is the same bill twice. She does not have to trust the software's
   conclusion; she is looking at the two records.
6. She declines to pay it in the bank — an action the Watchdog has no part in — then marks the
   finding **reviewed**. It moves to the register.
7. Later, exports it into the board packet from the register.

**Failure branch at step 2.** One invoice is a phone photo at an angle and fails schema
validation (AD-9). It is rejected individually — the rest of the batch completes — and Sarah is
told plainly what to do: upload a clearer copy. **No partial extraction is ever shown.** A
half-read invoice presented as a record is precisely the failure this product exists to catch,
and the pipeline producing one would be indefensible.

### David defends a dues action in a contentious meeting

*David is the Board President. A resident is disputing their overdue balance, loudly, in front of
the room.*

1. Opens his laptop, already signed in, dashboard on screen.
2. Types into the **ask field** without navigating anywhere: *"What is the dues status and payment
   history for Unit 304 over the last 6 months?"*
3. The Oracle opens with the question already sent and visible. His question stays on screen while
   the answer resolves.
4. The answer states the position in plain language, with the evidence table beneath it — six
   months, one row each, amounts tabular and aligned.
5. **Climax —** he reads the table aloud, month by month. Two paid, three missed, one partial.
   The room has nothing to argue with, because he is reading records rather than asserting a
   conclusion.
6. He does not open the query disclosure. It is there, and its being there is the point.

**Failure branch at step 3 — and this is the one that matters.** The resident shifts ground and
David asks something the catalog does not cover: *"How does our delinquency rate compare to last
year?"* AD-5 guarantees this happens, and it happens in the worst possible room.

The Oracle must not improvise, approximate, or quietly answer a narrower question. It says what
it cannot do and what it can, in one breath: *"I can't answer that one. I can show you Unit 304's
full payment history, or every unit behind this month."* David takes the offered question and
keeps his footing.

**Getting this state wrong loses the meeting.** A hedge, a spinner, or a plausible-sounding
approximation in that moment costs more credibility than the feature ever earned — which is why
it is specified here rather than left to implementation.

### Sarah confirms an unknown vendor

*A short flow, but the one place a human is structurally required.*

1. The quarantine queue shows an unresolved vendor name extracted from a new invoice.
2. Sarah sees the extracted name alongside the document it came from.
3. She confirms it as a new vendor, or matches it to an existing one — resolving an identity the
   system deliberately refuses to create on its own (AD-8).
4. The document completes processing; anomaly checks now run against a known vendor's history.

## Inspiration & Anti-patterns

**Rejected directions**, all rendered and reviewed before direction A was chosen
(`mockups/directions-4.html` — the spines win over anything visible there):

| Rejected | Why it lost |
| --- | --- |
| B · Plainspoken | One-card-per-finding stops scaling around six or seven items, and the no-dismissal model guarantees the list grows. Its *language* was retained — see Voice and Tone. |
| C · Console | Dark, dense, coded severity chips. Scans fastest once learned, but reads as professional software to a volunteer who did not choose this as a career tool. |
| D · Documentary | The only direction that anticipated the printed export, which is why print survives as a requirement in Accessibility Floor. Lost on register — closer to a publication than a record. |

**Explicitly not an input:** the HTML renderings produced during the architecture run
(board explainer, security posture, walkthrough deck). Their ledger-paper palette and monospace
display type were chosen for internal documents by the facilitator, not elicited from the product
owner. They must not leak into the product UI.

**Anti-patterns for this product specifically:**

- **Reassurance without evidence.** Never a green tick meaning "looks fine" unattached to a count
  of what was checked.
- **Confidence scores shown to a board member.** "87% confident" invites a volunteer to make a
  financial judgement out of a number they cannot calibrate.
- **Chat-app conventions** — typing indicators, bubbles, avatars, streaming text that rewrites
  itself. This is a records tool that accepts questions, not a messaging product.
- **Anything that resembles a payment affordance.** No button may look like it moves money, since
  none can (AD-2).

## Open Items

- **Dark theme: committed light-only for the pilot.** The product is a document-like record tool
  whose output is read in meetings and on paper. This was resolved by the facilitator during
  Finalize rather than elicited — flagged so it can be reversed cheaply if wanted, since it is a
  token-level change while the spine is young.
- **Sign-in has no elicited design.** Inherited from Supabase auth; no journey lands on it beyond
  arrival. Constrained by WCAG 3.3.8 (see Accessibility Floor).
- **Reflow transform is under-specified** per table type. The instinct is stated; a story author
  building a six-column dues history needs the group-heading rule. Resolve when the register mock
  is built.
- **Multi-association navigation does not exist** and must not be designed in. The pilot is one
  association (see the architecture's Deferred → Multi-tenancy).
