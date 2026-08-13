---
baseline_commit: 0c95659
merge_request: 59
---

# Story 4.5: The board sees what needs review

Status: done

## Why this story exists

Four stories have put findings into a table nobody can see. `finding` has held rows since 4.1;
4.2, 4.3 and 4.4 fill it on every ingestion run. A treasurer signing in today gets a page that
says "Dashboard", their email address, and a link to the quarantine queue — the same placeholder
it has been since story 1.2.

This is the story where the product becomes visible. It is also the first story in Epic 4 whose
failure modes are about **reading**, not about arithmetic. 4.2 through 4.4 could be wrong by
computing the wrong number; this one can be wrong by computing the right number and showing it in
a way that misleads — which on a fiduciary surface is the worse failure of the two.

### The three rules that shape every decision here

- **UX-DR2 — colour is never the only channel.** The margin tick is a 3px bar in the gutter,
  `flag` or `brass`, and it is *always* paired with a plain-language text label. Never "HIGH",
  never "MED", never a coloured bar on its own.
- **UX-DR23 — never imply certainty the system lacks.** The finding type is already named
  `possible_duplicate_invoice` for this reason. The copy on this surface inherits that discipline:
  it says what was compared, and the board decides what it means.
- **UX-DR24 — no reassurance without a count.** An empty findings list may not say "all clear".
  It says what was checked, and over what, or it says nothing at all. Every detector already
  stores its denominator in the finding's evidence *specifically so this story can render it* —
  4.2's `invoicesChecked`, 4.3's `invoicesAveraged` and `windowMonths`, 4.4's `instalmentsDue`.
  Those fields exist for this page. Use them.

### Two things this story deliberately does not do

**The rows do not navigate.** UX-DR4 says the whole row is the click target for the finding
detail surface, and the epic assigns UX-DR4 here — but the finding detail surface is story 4.6.
Shipping a row that links to a route which does not exist puts a 404 on the board's dashboard,
reachable by clicking the thing the page most wants them to click. So 4.5 builds the row's shape,
semantics and copy; **4.6 makes it a link at the same moment it builds the destination**, and
UX-DR4's "the amount is never a separate link" clause is asserted there, where there is a link to
assert it about.

This is a scope decision, not an omission. Record it in 4.6's story when that one is written, and
raise it with the user before merging this one.

**No register link.** UX-DR10 lists a register link on the dashboard; the register is story 4.7.
Same argument. The ask field (3.6c) and the quarantine entry point (1.6d) are already on the page
and must survive this story untouched.

## Story

As a board member,
I want the dashboard to show me the findings nobody has looked at yet, each saying plainly what
was compared and how much money it concerns,
so that I can see what needs my attention before a payment run without asking the system anything.

## Acceptance Criteria

**AC1 — The dashboard lists unreviewed findings, newest first.**
Only `state = 'unreviewed'` rows appear; a reviewed finding is absent from this surface entirely
(EXPERIENCE.md: "The dashboard shows only unreviewed findings"). Order is `raised_at` descending
with a deterministic tie-break, so two renders of an unchanged register agree.

**AC2 — Every row carries a margin tick and a text severity label, and the label is not derived
from the colour.**
Two levels, per UX-DR2 and DESIGN.md: `flag` / "Needs review" and `brass` / "Worth checking".
`finding` has no severity column, so severity is a property of the **finding type**, mapped in one
place in `core/`. A row rendered with no colour at all still tells a reader which it is.

**AC3 — A finding type the map does not know still renders, and is still counted.**
Epic 4 adds detectors after this story. A type with no entry in the severity map must appear in
the list with its text label and its evidence, never be silently dropped and never crash the page.
A finding that vanishes from the board's queue because a later story added a detector is the worst
defect this surface can have — it is indistinguishable, from the outside, from having nothing to
report.

**AC4 — Each row's evidence line states what was compared, using the count the detector stored.**
Not flavour text (DESIGN.md: "it is the finding's justification"). One line per finding type,
built from the evidence object:

| Type | The line says, in substance |
| --- | --- |
| `possible_duplicate_invoice` | how many invoices on this upload matched a prior one, out of `invoicesChecked`, and on what — amount and date, or amount and number |
| `invoice_above_vendor_average` | `percentOverAverage` above this vendor's `windowMonths`-month average of `invoicesAveraged` invoices |
| `unit_dues_shortfall` | which unit, what was expected against what arrived, and `instalmentsDue` instalments as the denominator |

Wording is the implementer's, subject to UX-DR23: state the comparison, never the conclusion.

**AC5 — The amount is right-aligned, tabular, and absent rather than invented when the evidence
has none.**
`amount` is `string | null` in 4.2's and 4.3's evidence — an invoice whose amount could not be
read still raises a finding. A row for one of those shows no amount. It must never show `$0.00`,
`NaN`, `null`, or an empty currency symbol: each of those tells a board member a figure they
would act on.

**AC6 — Evidence that does not match its expected shape does not take the page down.**
`evidence` is `jsonb` and arrives as `unknown`. A finding written by an earlier version of a
detector, or by a detector this code has not met, must render as far as it can — type, severity
label, whatever is legible — and never throw. The dashboard failing closed on one malformed row
hides every other finding on it.

**AC7 — Two empty states, and they are different.**
Nothing uploaded yet is not the same as nothing found (EXPERIENCE.md, State Patterns). With no
documents read, the surface says so and points at upload. With documents read and no unreviewed
findings, it is affirmative *and carries the count*: nothing needs attention, N documents checked.
Neither state may say "all clear" without that number (UX-DR24). The count is real — documents
whose `extraction_state = 'read'`, not the number of rows on the page.

**AC8 — Figure blocks are non-interactive and carry an "as of" date when the documents behind
them predate the current period.**
Per UX-DR3 and DESIGN.md: sans small-caps label above, serif tabular figure. Clicking does
nothing — it is not a link, not a button, and has no click handler. When the most recent upload
falls before the current calendar month, the block states the date it is as of; when it does not,
it does not. Both branches are asserted, and the boundary between them is asserted.

**AC9 — The ask field still comes first in the DOM, and the quarantine link still works.**
EXPERIENCE.md requires the ask field "reachable by keyboard from the top of the dashboard without
traversing every finding", and `app/dashboard/page.test.tsx` already carries a test whose comment
names this story as the one that would break it. The findings list goes **after** the ask field.
Every existing assertion in that file still passes, unmodified.

**AC10 — A vendor name from a document is rendered as text.**
AD-8: extracted strings are escaped on output, never interpolated. A vendor name containing
markup appears on the page as those characters. No `dangerouslySetInnerHTML` anywhere on this
surface.

## Tasks / Subtasks

- [x] **Task 1 — The read port** (AC: 1, 7)
  - [x] `core/ports/finding-reader.ts`: unreviewed findings with `id`, `findingType`, `subjectId`,
        `period`, `evidence`, `raisedAt`; plus the two counts the empty state and figure blocks
        need — documents read, and the most recent upload date.
  - [x] Read-only, and say why in the header the way `invoice-reader.ts` and `dues-reader.ts` do.
        A surface that could mark a finding reviewed through the same object it lists them with is
        one refactor from a page that clears its own queue.
  - [x] Decide deliberately whether the counts belong on this port or a second one, and write the
        reason down either way.

- [x] **Task 2 — The presentation rule, pure and in `core/`** (AC: 2, 3, 4, 5, 6)
  - [x] `core/findings/finding-view.ts` (name is the implementer's): finding → row view. Severity,
        text label, title, evidence line, amount-or-absent. All copy lives here.
  - [x] In `core/` and not in the component, for the reason `core/quarantine/queue-view.ts` gives:
        it makes the copy and the severity mapping assertable without a DOM, and it stops a second
        surface (4.6's detail, 4.8's email) inventing a second wording for the same finding.
  - [x] Read `evidence` defensively — it is `unknown`. AC6 is a test, not a comment.
  - [x] AC3's unknown-type path is a branch with its own test, not a `default:` nobody exercised.

- [x] **Task 3 — The Postgres reader** (AC: 1, 7)
  - [x] `adapters/db/finding-reader-postgres.ts` + `.test.ts` under `npm run test:db`.
  - [x] `finding_state_recent_idx` is `(state, raised_at desc)` — the query should use it. Check
        with `explain`; do not assert it does without looking.
  - [x] **Dates out of Postgres go through `to_char(… at time zone 'UTC', 'YYYY-MM-DD')`.** Story
        4.4 shipped this bug in two readers and fixed it in both: `to_char` on a `timestamptz`
        renders in the *session* timezone, so an upload at 18:00 Pacific files under the next day.
        `adapters/db/pool-time-zone.ts` exists to test it — use it.
  - [x] Scope fixtures so tests do not share subjects. Both 4.3 and 4.4 shipped a suite that
        passed because every test saw every other test's rows.

- [x] **Task 4 — The components** (AC: 2, 4, 5, 8, 10)
  - [x] Figure block and findings list under `app/dashboard/`, presentational, taking a view.
        Follow `app/quarantine/queue-list.tsx`: the component takes data and returns markup, and
        does not reach the database.
  - [x] jsdom render tests, per-file `// @vitest-environment jsdom` and `afterEach(cleanup)` —
        `globals: true` is deliberately off (see `queue-list.test.tsx`).
  - [x] Styling only through custom properties. `core/design/no-raw-values.test.ts` scans `app/`
        and fails on a raw colour or font value. The tick's width is
        `--component-margin-tick-width`.
  - [x] Semantics: the list is a list; the tick is decorative and the label is the text. Currency
        announced as currency (UX-DR20). Flexible row heights — nothing fixed-height.

- [x] **Task 5 — Wire the dashboard** (AC: 1, 7, 8, 9)
  - [x] `app/dashboard/page.tsx` reads through the port and renders the list after the ask field.
  - [x] **No component calls `new Date()`.** The page derives today once, in UTC, and passes it
        down — the same choice the readers make, and it keeps AC8's boundary testable without
        mocking a clock. Write down the consequence: a board west of Greenwich sees the month roll
        over before their local midnight, which affects a label and no figure.
  - [x] Run the existing `page.test.tsx` unmodified. If an assertion in it needs to change, stop —
        that is AC9 failing, not a stale test.
  - [x] **The auth guard runs before the read**, matching `app/quarantine/page.tsx`. A page that
        queries findings and then redirects has already done the work an unauthenticated visitor
        asked for.

## Dev Notes

### The schema, as it stands

| Table | Shape that matters here |
| --- | --- |
| `finding` | `(id, finding_type, subject_id, period daterange, evidence jsonb, raised_at timestamptz, state, reviewed_by, reviewed_at)`; unique on `(finding_type, subject_id, period)`; index `finding_state_recent_idx (state, raised_at desc)`; `state in ('unreviewed','reviewed')` |
| `document` | `(id, filename, uploaded_at timestamptz, extraction_state)`; `extraction_state in ('held','read','unreadable','provider_unavailable')` — **`'read'` is "checked"** |

`delete` and `truncate` are revoked on `finding` from `watchdog_writer` and from `public`. Nothing
on this surface removes a row; marking reviewed is 4.6 and it is an `update`.

### Wiring, and the four traps in it

- **The page imports the adapter factory; nothing else does.** `app/quarantine/page.tsx` is the
  pattern: `import { createQuarantineQueue } from '@/adapters/db/…'` in the page, the core view
  function from `@/core/…`, and the component takes the view. Do not reach for a container or a
  registry — there isn't one, and adding one is this story reinventing a wheel it does not need.
- **`core/` may not import `pg`, `next`, `next-auth`, or anything under `adapters/` or `app/`.**
  `core/ports/boundary.test.ts` enforces it and catches wrapped imports and `require`. The view
  function is pure TypeScript over plain data.
- **A `daterange` does not come back from node-pg as an object.** There is no built-in parser, so
  `select period` yields the raw literal `[2026-04-01,2026-05-01)` and any code treating it as
  structured is reading a string that happens to have brackets in it. Project the ends explicitly
  — `to_char(lower(period) …)` and `to_char(upper(period) …)` — which is also where AC-level
  correctness of the UTC rule above gets settled.
- **Nothing on this page may be statically rendered.** `auth()` reads cookies, which forces the
  dashboard dynamic today — so this is currently true by accident rather than by decision. If the
  read is added in a way that lets Next cache it, the board gets yesterday's queue with no
  indication it is stale, which is the one thing a queue may never do.

### How many rows, and the count that must not disagree with them

The dashboard is a queue, not the register — 4.7 is where everything ever found lives. If the list
is bounded, the figure block's count is still the **true** total of unreviewed findings, and the
page has to say that more exist rather than letting a reader infer the number from what they can
see. If it is not bounded, say why that is safe. Either is defensible; silently rendering 500 rows
under a figure block reading "500" while the reader believes they have seen them all is not.

### The evidence each detector writes

Read the three `detect-*.ts` files rather than trusting this table, but as a starting map:

- `possible_duplicate_invoice` — `{ invoicesChecked, matchRule, pairs: [{ reason, vendorName,
  amount, invoiceNumber, issuedOn, priorDocumentId, priorInvoiceNumber, priorIssuedOn }] }`.
  `reason` is `'same-amount-and-date'` or `'same-amount-and-number'`. Several pairs per finding:
  the finding is keyed on the document and the month, so one upload with three duplicates is one
  row carrying three pairs. Decide what the row's single amount means when there are several, and
  say so on the page rather than picking one silently.
- `invoice_above_vendor_average` — `{ invoicesChecked, thresholdPercent, windowMonths, spikes: [{
  percentOverAverage, average, invoicesAveraged, vendorName, amount, invoiceNumber, issuedOn }] }`.
- `unit_dues_shortfall` — `{ kind: 'not-recorded' | 'below-expected', expected, received,
  shortfall, instalmentsDue, billingCycle, evaluatedOn, unitNumber, holderName }`. `holderName` is
  nullable and a null one still gets a finding — the money is still short. `kind: 'not-recorded'`
  deliberately does not mean *unpaid*; the commonest cause is a deposit nobody has uploaded yet,
  and the copy must not say otherwise.

### Severity has to be decided, and this is the argument

There is no severity column and there should not be one — it would be a detector's opinion stored
as fact. So the map lives in `core/` beside the copy:

- `possible_duplicate_invoice` → **Needs review** (`flag`). The epic is called *be told before you
  pay*, and this is the one finding where money is about to leave twice.
- `invoice_above_vendor_average` → **Worth checking** (`brass`). A higher bill is frequently
  legitimate; the whole point of UX-DR23 is that this is a comparison, not an accusation.
- `unit_dues_shortfall` → **Worth checking** (`brass`). Money owed *in*, with no payment run
  pending, and it names a person — the surface should not shout about a member by name on
  evidence that a deposit may simply be unuploaded.

That third one is a judgement rather than a derivation. Raise it with the user before merging.

### What 4.2, 4.3 and 4.4 learned, and this story inherits

- **A guard nothing can break is a guard to delete.** Six have gone this way across the three
  detector stories.
- **A test can pass for the wrong reason, and a mutation will not always tell you.** Ask of every
  refusal or absence test: *what would this look like if the thing I am asserting were broken?* If
  the answer is "the same", the test is worth nothing.
- **The AC audit before the merge request has found something on six consecutive stories.** On 4.4
  it found the detector could not detect its own headline case. Run it.
- **A fix diff is the highest-risk diff in the story.** MR !56 needed three rounds and each one
  found a defect in the previous round's fix.
- **Writing a limitation down is not handling it.** Twice in 4.4. This story does it once, on
  purpose, in the open (the deferred row link) — that is the only place it is allowed.
- **Anything carrying a backslash goes through the editing tool**, never a shell heredoc.

### Where this story differs from its three predecessors

Those were Postgres semantics and exact-decimal arithmetic; this is jsdom, copy and reading order.
The failure modes move with it: a component that renders nothing passes every assertion about what
it does not show, an empty list satisfies "no wrong row is present", and a test that queries the
document body without `cleanup` sees the previous test's markup. The one existing render-test file
worth reading first is `app/quarantine/queue-list.test.tsx` — it records each of those traps as a
comment where it was actually hit.

### The shapes to copy

- `core/quarantine/queue-view.ts` — domain → view in `core/`, and the argument for deciding
  emptiness once rather than per surface.
- `app/quarantine/queue-list.tsx` — a presentational component that takes its data and its actions
  as props, and the reason it does.
- `app/quarantine/queue-list.test.tsx` — jsdom opt-in, explicit `cleanup`, and the normalizer trick
  for asserting a string was not rewritten on its way to the page.
- `app/dashboard/page.test.tsx` — the server-component render pattern with `auth` mocked.
- `adapters/db/dues-reader-postgres.ts` — the UTC `to_char` and the fixture scoping.

### References

- [Source: epics.md] — Epic 4 story spine; UX-DR2, 3, 4, 10, 20, 23, 24
- [Source: EXPERIENCE.md] — Alert Lifecycle; Component Patterns; State Patterns
- [Source: DESIGN.md] — Components: margin tick, figure block, finding row
- [Source: core/design/tokens.ts] — `flag`, `brass`, `margin-tick-width`, `scale-figure`
- [Source: 4-4-the-dues-that-did-not-arrive.md] — the review record these learnings come from

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m]

### Test Design

#### Task 1 — the read ports

**Behaviour: the shape of what the dashboard is allowed to hold.**

1. *If it ran correctly, how would I know?* The declared member list of each port — the same
   observable `core/ports/finding.test.ts` asserts on, through `declaredMembers`.
2. *How do I test it?* Read the source, list the members. No seam needed; these are declarations.
3. *What else can go wrong?* Below.
4. *Same shape elsewhere?* `FindingRegister`/`FindingReviewer` already split for this reason, and
   `QueryLog`/`QueryLogReader` before them. This is the third instance of the same argument.

| # | Failure mode | Class |
| --- | --- | --- |
| 1 | The reader grows a write method, so the dashboard can review or delete what it lists | **GUARD** — assert the member list, and assert it mentions nothing about reviewing |
| 2 | The queue returns rows with no total, so a bounded list silently reads as the whole register | **GUARD** — one method returning both, so a caller cannot obtain the rows without the count |
| 3 | `evidence` typed as a known shape, so the view reads `.kind` off a row written by a detector that never had one | **GUARD** — typed `unknown`; the compiler refuses the careless read (AC6, made structural) |
| 4 | Document counts hung off a *finding* port, where nothing would ever notice they drifted | **GUARD** — separate port, separate file, named for its subject |
| 5 | A reviewed finding reaches the surface | OUT-OF-SCOPE here — not expressible in a type; it is the adapter's, tested in Task 3 |
| 6 | The port imports `pg` or reaches into `adapters/` | OUT-OF-SCOPE — `core/ports/boundary.test.ts` already forces it, for every file in `core/` |

#### Task 2 — the presentation rule

Six behaviours. The four questions, answered once for the group because they share every answer:
the observable is a returned value in all six (pure functions over plain data, no DOM and no
clock); the seam is that they take the finding rather than fetching it; the failure modes are
below; and the sibling shape — *a surface inventing a figure the record does not support* — is
what AC5 exists for and is checked in all of them.

| # | Behaviour | Failure mode | Class |
| --- | --- | --- | --- |
| 1 | `formatAmount` | Float arithmetic loses cents on a large amount | **GUARD** — string manipulation only; asserted with a value no double can hold |
| 2 | `formatAmount` | Malformed or absent input renders as `$0.00`, `$NaN` or `$` | **GUARD** — `null` out, which the row already knows how to show as nothing |
| 3 | `formatAmount` | Thousands grouping wrong at the 3/4-digit fencepost | **GUARD** — boundary tests either side |
| 4 | `severityOf` | An unknown type has no entry and the row is dropped | **GUARD** — falls back, never returns null (AC3) |
| 5 | `severityOf` | An unknown type is escalated to the loudest level | **GUARD** — falls back to *worth checking*; the system does not shout about what it cannot name |
| 6 | `titleOf` / `evidenceLineOf` | Evidence read carelessly, so a shape change throws and the page dies | **GUARD** — every read narrows from `unknown` (AC6) |
| 7 | `evidenceLineOf` | A count is invented when the evidence lacks one | **GUARD** — the line degrades rather than guesses |
| 8 | `amountOf` | Several distinct amounts summed or silently reduced to one | **GUARD** — shown only when the evidence agrees on one figure |
| 9 | `toFindingRow` | Throws on any input, taking every other row with it | **GUARD** — total, asserted against deliberately hostile evidence |
| 10 | `toDashboardView` | "Nothing needs your attention" with no count (UX-DR24) | **GUARD** — the count is in the state, not optional |
| 11 | `toDashboardView` | Nothing-checked and nothing-found collapse into one state | **GUARD** — a discriminated union; both branches tested |
| 12 | A vendor name is rewritten on the way to the page | **GUARD** — asserted with an unnormalised name (AD-8, AC10) |
| 13 | Locale changes the grouping or the decimal mark | OUT-OF-SCOPE by construction — no `Intl`, no `toLocaleString`; the formatter is pure string work |

### Completion Notes

**Baseline (0c95659):** 2457 tests passing / 593 skipped, 792 db tests passing, 8 pre-existing
`tsc --noEmit` errors — all in existing test files (`upload-limits.test.ts`, `boundary.test.ts`).

#### Task 1

Two ports, not one: `FindingReader` (`core/ports/finding-reader.ts`) reads the queue,
`CheckedDocuments` (`core/ports/checked-documents.ts`) answers UX-DR24's denominator. Splitting
them was failure mode 4 — a document count declared on a finding port is a number nobody owns.

Two design choices are enforced by the type rather than remembered:

- `unreviewed(limit)` returns `UnreviewedQueue { findings, total }`, so no caller can hold the
  rows without the count. A bounded list rendered under an unqualified figure is the specific way
  this surface could mislead, and there is now no shape in which it is expressible.
- `evidence` is `unknown`, not `Record<string, unknown>`. The column constraint makes it an object
  today; `unknown` is what makes AC6 a compile error instead of a promise.

**Red was not achieved on the first run** — the tests failed with `ENOENT` because the files did
not exist, which is a missing-symbol failure and not a valid red. Stubbed both interfaces empty,
re-ran, and got five assertion failures on member lists. Then implemented.

**One test was wrong and was corrected before the code was.** `not.toMatch(/review|.../)` failed
against the *correct* design, because `review` is a substring of `unreviewed` — the one member the
port is supposed to have. Anchored on word boundaries instead. A pattern that fails on the right
answer is one that gets loosened until it forbids nothing.

*Sensitivity:* injected `markReviewed`, `removeFinding` and `clearQueue` in turn; each failed 2
tests. Restored, green.

*Review gate — `argus_review` on the task diff:* `moderate` · confidence 0.9 · context 5/5 files ·
1 agy call, 56,494 tokens.

- **[high] the forbidden-verb regex omits `remove` while the test's own name promises it** —
  **confirmed**, and it was exactly the defect class this project keeps finding: a guard whose name
  claims more than its assertion. `removeFinding` would have passed it. Added `remove`, and `clear`
  because that is EXPERIENCE.md's word ("nothing is ever deleted or cleared by disagreement").
  Both verified by injection above.
- **[medium] branded types for `id` / `subjectId` / `findingType`** — **disagree.** The code is as
  described and the swap is plausible, but every port in this repo types ids as `string`.
  Introducing brands in one new file makes it inconsistent with ~20 siblings and with every
  adapter, and buys nothing until they all move. That is a repo-wide convention decision for the
  user, not a patch inside this story.
- **[medium] ×2 model failure in the return type (`Promise<T | Error>` / Result)** — **disagree.**
  `core/ports/finding.ts` argues explicitly for the opposite: named errors that reject and must
  not be swallowed (`AlreadyReviewedError`, `FindingNotFoundError`). A Result type here would make
  this the only port in the codebase with a different error contract.

Argus's line numbers (172, 249, 305) are diff offsets and resolve to nothing in the real files;
each finding was judged against the actual source rather than the cited line.

#### Task 2

Three modules, because they fail in three different ways. `money.ts` turns a stored decimal into a
figure; `finding-view.ts` turns one finding into a row; `dashboard-view.ts` decides which of three
states the surface is in.

**The rule that shaped most of it: a row makes one claim and has one money column.** Findings for
duplicates and spikes are keyed on `(type, document, month)`, so one finding can cover several
invoices with several amounts and several vendors. `agreed()` is the answer used in both places —
the value is shown when the evidence holds one, and omitted when it holds several. Summing would
state a total no record holds; taking the first would attribute one invoice's figure, or one
vendor's name, to a finding covering three.

**Severity is derived, and the mapping is a judgement.** A duplicate is *Needs review* because it
is the one finding where money is about to leave twice. A spike and a dues shortfall are *Worth
checking*. An unrecognised type is shown, counted, and quiet — never escalated, because a type this
code cannot name is one it cannot describe either, and an urgent tick beside an empty sentence is
reassurance in reverse.

**AC6 is enforced by narrowing at every read.** Eight hostile evidence shapes are in the suite —
`null`, a string, an array, pairs holding nulls, a count that is not a number — each asserted twice:
the row renders, and it invents no amount.

*Sensitivity:* five mutations, all caught. Demoting the duplicate severity failed 9; `agreed()`
returning the first value failed 3; routing an unknown type into the duplicate reader failed 1;
collapsing `nothing-checked` into `nothing-to-review` failed 2; `<` to `<=` on the as-of boundary
failed 2.

*Review gate — `argus_review` on the task diff:* `simple` · confidence 0.95 · context 8/8 files ·
1 agy call, 125,774 tokens.

- **[high] emptiness decided from `queue.findings.length` rather than `queue.total`** —
  **confirmed, and it was the one defect in this task that a board member would have acted on.**
  The rows are a bounded window and the total is the register; any disagreement between them — a
  zero `limit`, a finding reviewed between the count and the select — rendered "nothing needs your
  attention" over an outstanding queue. That is precisely the false reassurance UX-DR24 exists to
  forbid, produced by the module written to enforce it.

  Fixed test-first: the regression asserts `queue([], 3)` reaches the findings state, and it failed
  against the pre-fix code with `expected 'nothing-to-review' to be 'findings'`. A findings state
  holding no rows is visibly wrong, which is the right way for this to fail.

  Worth recording *why my own tests missed it*: every one of them constructed the queue with
  `queue(findings)`, whose `total` defaults to `findings.length`. The helper made the two numbers
  agree by construction, so no test could distinguish them — a fixture that quietly guarantees the
  property under test, which is the same defect shape as 4.3's eleven db tests sharing one vendor.

No other findings. `formatAmount`'s float-freedom and the graceful degradation of malformed
evidence were both called out as holding.

#### Task 3

One statement returns the rows and the total together (`count(*) over ()`), so both describe the
same snapshot. Two round trips could disagree if a finding were reviewed between them, and that
disagreement is the thing the combined shape exists to prevent.

**The index does not serve this query, and that was measured rather than assumed.** The story said
to check with `explain` and not to assert it without looking, so:

```
Limit → Sort (raised_at DESC, id DESC) → WindowAgg → Seq Scan on finding (32 rows)
```

Two reasons, and only one is about table size. `count(*) over ()` has to see every unreviewed row,
so `limit` bounds what is *returned*, not what is read — the index cannot short-circuit that at any
size. Accepted rather than optimised: splitting into an index-scanned page plus a separate count
would use the index and lose the shared snapshot, which is the property this surface needs. Written
into the adapter so nobody later claims otherwise.

**The ordering carries `id desc` as a tie-break.** One detection run raises several findings on the
same `now()`, and without a second key the board's queue reshuffles between two refreshes of a
register that has not changed.

**Determinism without a run prefix.** Every other adapter test here isolates with a prefix because
every other query narrows on something; these do not — the queue is the whole table. Three
techniques replaced it: seed into 2099 so this file's rows sort ahead of anything else running;
assert *relative* order within the result rather than absolute position; and cross-check the global
counts against an independently written control query.

*Sensitivity:* seven mutations, all caught. Unfiltering reviewed rows failed 2; dropping the
tie-break failed 1; removing `at time zone 'UTC'` failed 1; returning the page size as the total
failed 1; counting documents in every extraction state failed 3; removing the upper limit bound
failed 1.

*Review gate — `argus_review` on the task diff:* `moderate` · confidence 0.95 · context 4/4 files ·
1 agy call, 62,129 tokens.

- **[medium] the count test races other files writing findings** — **confirmed.** It compared
  `queue.total` to one control read, which asserts that nothing else committed between two
  statements. That is not a property of this adapter, and other files in this directory raise and
  review findings concurrently. Rewritten to bracket the total between a control on each side:
  exact when the table is quiet, still correct when it is not, and still fails when `total` is
  replaced by the page size (verified by mutation).
- **[medium] no upper bound on `limit`** — **confirmed.** The port made `limit` required because
  "an optional bound is one a caller forgets", and a caller passing a million forgets it just as
  thoroughly. The register is append-only and permanent, so the request gets worse every year.
  Capped at 200 and refused rather than clamped — a caller asking for more wanted a bulk export,
  which is story 4.7's surface. Test written first and observed failing.
- **[high] `setPoolTimeZone` races other concurrently running test files** — **disagree**, and it
  was worth checking rather than assuming, because it would have been serious. `writerPool()`
  memoises per module registry, and vitest isolates modules per test file, so each file holds its
  own pool and its own connections; a session timezone is per-connection. `dues-reader-postgres`
  and `invoice-reader-postgres` already do this concurrently today.
- **[medium] the pool is never closed, so the runner hangs** — **not reproduced** on the
  consequence. No test file in `adapters/db/` closes `writerPool()`, and the suite completes in
  ~39s every run. Vitest tears the worker down. Left consistent with its siblings rather than
  making this one file different for a hang that does not occur.

#### Task 4

`FigureBlock` and `FindingsList` under `app/dashboard/`, both presentational and both taking their
data as props — the pattern `app/quarantine/queue-list.tsx` set, for the reason its header gives.

`FindingsList` takes the whole `DashboardView` rather than a list of rows, so the component picks a
branch instead of re-deriving which state applies. A page that decided emptiness for itself is how
"nothing needs your attention" reaches a board member on the day the association signed up.

**An existing design gate caught something before Argus did.** `core/design/text-pairings.test.ts`
failed on `--color-rule`: the row separator used a token no surface declares a pairing for, so its
contrast is measured by nothing. Every other hairline in `app/` uses `--color-rule-strong`, which is
measured and has its shortfall recorded as a known gap. Changed to match. A separator nobody can see
is a separator that is not there.

*Sensitivity:* five mutations, all caught. Removing the severity words while leaving the tick failed
1 — which is the UX-DR2 case that otherwise fails silently. Drawing every tick in `flag` failed 1;
rendering an absent amount as `$0.00` failed 1; dropping the "showing the N most recent" notice
failed 1; letting `nothing-checked` reassure failed 2.

*Review gate — `argus_review` on the task diff:* `moderate` · confidence 0.95 · context 6/6 files ·
1 agy call, 64,861 tokens.

- **[medium] `TICK[row.severity]` allows prototype property access** — **confirmed, and the
  verification moved it.** Argus pointed at the component, where `row.severity` is already a
  validated `Severity`; the lookups that actually take untrusted keys are in
  `core/findings/finding-view.ts`. Probed rather than reasoned about, and it was worse than
  reported:

  - `finding_type_is_verb_noun` is `^[a-z][a-z0-9_]*$`, which **`constructor` satisfies in full**.
    `SEVERITY['constructor']` returns the `Object` function, so `?? UNKNOWN_SEVERITY` never fires
    and the row's severity becomes a function — no label, no tick colour, on exactly the
    unrecognised finding AC3 promises will still render. UX-DR2 broken on the one row that needed
    the promise most.
  - `reason` comes out of `jsonb`, so `MATCH_REASON['constructor']` put
    `function Object() { [native code] }` into the sentence a board member reads.

  Both fixed through one `known()` helper using `Object.hasOwn`, with the two regression tests
  written first and observed failing (`expected [Function Object] to be 'worth-checking'`).

- **[high] unknown `view.kind` crashes on `view.rows`** — **disagree.** `DashboardView` is a closed
  discriminated union and the fall-through is type-narrowed to the findings variant; adding a fourth
  kind is a compile error at `view.rows`, not a runtime crash. An explicit check plus a `never`
  branch would add a guard no test could force, which is the shape this project has deleted six of.
- **[medium/low] ×3 `=== null` misses `undefined`** — **disagree.** All three fields are required
  and non-optional, produced in-process by pure functions that always assign them. Argus's premise
  is that they arrive over JSON; they do not — `FindingsList` is a server component, so there is no
  serialization boundary between `toDashboardView` and the render.

#### Task 5

The page reads both ports after the auth guard, derives `today` once in UTC, and passes it down;
nothing below that line reads a clock. The findings list sits after the ask field, which is the
accessibility requirement rather than a layout choice — and the existing ask-field test named this
story as the one that would break it. Every assertion in `page.test.tsx` still passes unmodified;
the new ones were appended.

`/dashboard` builds as `ƒ` (server-rendered on demand), so the queue is never served from a cache.
Confirmed in the build output rather than assumed from `auth()` reading cookies.

Figure labels are "Unreviewed findings" and "Documents checked". Not "Needs review": that is the
label of the *loud* severity, so a figure wearing it would read as a count of those alone — and it
would collide with the row labels underneath it in the same breath.

**A mutation caught a vacuous test of my own.** The UTC test originally used
`latestUploadOn: '2026-04-01'`, where a UTC clock and a local one both produce no "as of" — so
"read in UTC" and "read locally" were the same observable, which is story 4.3's defect in a new
place. Rewritten with `'2026-03-31'` against a 2026-04-01T02:00Z clock, where the two disagree, and
re-run against the mutation to confirm it now fails. Measured on the way: this host sits at UTC−5,
and **the `TZ` environment variable is ignored on it** — forcing `TZ=America/Los_Angeles` left
`getTimezoneOffset()` at 300, so TZ is not a usable lever for timezone tests on Windows.

*Sensitivity:* three mutations. Moving the read above the auth guard failed 1; rendering figures
before anything had been read failed 14; reading `today` in local time failed 1 **after** the test
was repaired, and 0 before — which is the whole point of running it.

**A flake, found by running the gate rather than by a test failing.** The db suite failed once
during the final gate and passed on the next three runs. The mechanism was identifiable without
catching it again: Argus's race finding on the *findings* total had been fixed, and the *documents*
count in the same file was left comparing against a single control read — the identical race, half
fixed. Bracketed the same way, and re-verified that it still fails when the `extraction_state`
filter is removed. A green suite that flakes once in five is not a green suite.

*Review gate — NOT SATISFIED for this task's diff.* `argus_review` failed twice with
`agy failed: Command failed` from the `antigravity` backend. `_bmad/custom/review-gate.md` is
explicit that falling back to the Claude subagent layers does not satisfy this gate — same model
family reviewing its own work — so this is recorded as a gap rather than a pass. The integration
pass in Step 6 covers `0c95659..HEAD`, which includes every line of this diff; if Argus is still
unreachable there, it goes to the user rather than being written up as reviewed.

### The acceptance-criteria audit

**Seven consecutive stories now.** Two findings, and the first is the kind this pass exists for.

**1. The detection date was built and never shown.** EXPERIENCE.md's State Patterns table requires
it — *"Findings show their detection date"* — and `raised_at` was projected by the adapter, carried
by the port as `raisedOn`, carried through `toFindingRow`, and then rendered by nothing. Every test
passed, because every test asserted what the row *did* show. A queue whose entries carry no date
cannot be aged by the person reading it, which is most of what a queue is for. Now rendered as
`Noticed <time datetime="…">`, and the mutation removing it fails 2 tests.

**2. Two fields reached the view with no consumer.** `FindingRow.findingType` and `.period` were
plumbed through and read by nothing — which looks like a feature until someone goes looking for
where it is shown. Removed from the view. The **port** keeps both, deliberately: they are the
record's identity under migration 021's `(finding_type, subject_id, period)` key, and story 4.6
links on them. The view carries what the surface renders; the port models the record.

Everything else in the ten ACs verified against the running code rather than against its tests:
only unreviewed rows reach the surface, the unknown type is both rendered and counted in `total`,
the amount is absent rather than invented, both empty states are distinct and neither reassures
without a count, the figure blocks carry no interactive element, and the ask field still precedes
the list in the DOM.

### The integration pass and the local CodeRabbit round

**`argus_review` on `0c95659..HEAD` (17 production and test files, 2,674 lines): clean.** No
findings. `moderate` · confidence 1.0 · context 19/19 files · 1 agy call, 287,242 tokens.

Worth recording that it took four attempts. Three calls failed with `agy failed: Command failed`
before one succeeded, and a direct probe of `agy` in between returned normally — so the backend was
healthy and the failures were transient rather than a broken engine. This pass covers every line of
task 5's diff, which closes the gap recorded there.

**The one local CodeRabbit CLI round** (`review_completed`, 19 files reviewed, on `ae21671`). Every
changed path appeared in `reviewedFiles`; nothing went unreviewed. Two findings, both confirmed:

- **[minor] the `latestUploadOn` tests assert the literal `2099-03-04`** — which asserts that no
  other test file has seeded into 2099, and seeding into 2099 is the technique this very file
  documents at the top and recommends to the next author.
- **[trivial] a local `known` shadows the module-level `known()` lookup helper** — harmless today
  because nothing in that function calls it, and a bug the moment somebody does. Renamed to
  `stored`.

`argus_ingest` compared the two against the integration run on the same SHA: both fall below the
configured critical+major threshold, so nothing was written to memory. Correct — the store is for
the misses that matter.

**Then the fix diff turned out to be the dangerous one, again.** The review gate on it found that my
repair of the first finding had made the tests *weaker*:

- `>= '2099-03-04'` passes for any date further in the future, so a timezone defect shifting a
  newer row by a day still passes — the exact bug the test exists for.
- `not.toBe('2099-03-05')` and `not.toBe('2099-03-06')` pass trivially the moment another file
  seeds anything later, so the filtering under test stops being checked at all.

Both are now compared against an independently written control query, bracketed either side the way
the count assertion already was. And **the second attempt at the timezone test was vacuous in a way
I caught before mutating it**: the "second UTC read" was taken inside the Los Angeles block, so the
buggy value sat in its own bracket and the assertion passed against the defect. Moved after the
timezone is restored.

Three versions of that assertion, each wrong differently, and the mutations now confirm both
properties: removing the UTC cast fails 1, removing the `extraction_state` filter fails 2.

### The gate on the fix commit

`argus_review` on `ae21671..db9f8d8` confirmed the rewrite — the bracketing was called out as the
right way to assert against a concurrently modified table — and raised two more, **both refuted by
measurement rather than by argument**:

- **[high] `let inLosAngeles` is implicitly `any` and fails lint/tsc.** Not reproduced.
  `eslint` returns 0 on that file, `tsc --noEmit` stays at its 8-error baseline, and none of those
  errors is in it. The finding's evidence was Argus's own `lint: rc=-1`, which is its verifier
  failing to run rather than the code failing. TypeScript gives an uninitialised `let` an *evolving*
  any and narrows it from its single assignment, which is legal under strict.
- **[low] the non-null assertion in `controlLatestRead`.** Disagree.
  `@typescript-eslint/no-non-null-assertion` is not configured, and `rows[0]!` appears across ten
  sibling files in `adapters/db/`. Changing this one would make it the odd file out to satisfy a
  rule the project has not adopted.

Neither was acted on. This file has now been rewritten three times in two rounds, and a fourth
edit to satisfy a failure that does not occur is exactly the churn the "a fix is the highest-risk
diff" rule warns about.

### MR !59 round 1 — 10 findings, 8 taken

**The two that were defects rather than polish:**

- **A duplicate finding with a priced pair but no `invoicesChecked` rendered with no amount.** The
  guard suppressed the evidence line and the figure together, but a missing denominator invalidates
  only the sentence — the pairs still carry an amount the record supports. A finding written before
  that field existed, or by any detector that stops storing it, would have lost its money column.
  The pull is the exact opposite of AC5's, which is why it is worth stating: AC5 forbids inventing a
  figure the record does not support, and this forbids withholding one it does.
- **The hostile-evidence tests were routed through the wrong reader.** All but one fixture was
  duplicate-shaped and the amount assertion ran them through the *spike* reader, which finds no
  `spikes` key and returns null trivially — so those cases could not have failed however the spike
  path behaved. Each fixture now carries the reader whose shape it is hostile to, spike- and
  shortfall-shaped entries were added, and a third case runs every fixture through every reader,
  because a finding can be stored with one type and evidence shaped for another.

**Also taken:** the `limit` fencepost (200 accepted, 201 refused — `>` and `>=` were
indistinguishable before); the refusal *message* rather than just the type; the port documenting the
bounds its adapter enforces; the "as of" test requiring **both** figure blocks rather than at least
one; the SQL docblock that had drifted onto `MOST_ROWS`; a stale comment describing a shadowing that
no longer existed; and a `not.toMatch(/finding/i)` that sat beside an exact `toEqual` and could not
fail — a guard that proves nothing, which is this project's most-repaired defect.

**Refused — switch the read queries to `readerPool()`.** Least-privilege, and it would break the
dashboard outright. Probed rather than argued:

```
finding  => DENIED: 42501 permission denied for table finding
document => SELECT ok
```

Migration 021 states the intent in words: *"Nothing is granted to watchdog_reader, and the silence
is the decision."* The reader role exists for the LLM query catalog under AD-4, not for application
surfaces, and `dues-reader`, `invoice-reader` and `query-log-reader` all use the writer pool for the
same reason. Routing §6 lists AD-4 as an architecture decision that is never auto-applied.

**Partly disagreed — force the UTC test into a timezone behind UTC.** That fix does not work here:
`TZ` is ignored on this Windows host, measured, with `getTimezoneOffset()` staying at 300 under
`TZ=America/Los_Angeles`. The intent is right, though, and the previous single case was only
decisive on a runner *behind* UTC. Added a second case at 2026-03-31T22:00Z, where UTC and any zone
*ahead* of it disagree — between the two, one fails on any runner that is not itself at UTC, with no
environment involved.

*Sensitivity:* three mutations, all caught. Suppressing the amount again failed 1; the fencepost as
`>=` failed 1; dropping the date from one of the two figure blocks failed 2.

*Review gate on the round's diff:* `argus_review` clean — no findings, confidence 1.0, 9/9 files.
(Two attempts again; the first returned `agy failed`.)

### Convergence

**MR !59 converged after one round.** The re-review of `32edc5f..b8d8fc3` covered all seven changed
files and returned *"No actionable comments were generated"*. Eight of the ten threads were resolved
by CodeRabbit; the two left open are the `readerPool` refusal, answered on its thread with the
`42501` probe, and the docblock move, which was taken and which the clean re-review of that same file
confirms.

**It arrived as an edit to the summary comment, not as a new note** — created 16:59:26, updated
17:40:12. Keying only on newly-posted notes would have reported this MR as awaiting review
indefinitely. That trap is already recorded in memory; this is the second story to hit it.

### The close-out was late, on the first story after the rule that exists to prevent that

`8e-close` says the status change and the review record ride in the *round's* commit. Round 1's
fixes went up without them, because the round was not known to be the last one until the re-review
came back clean — which is precisely the reasoning the rule forbids. Recovered under Step 9.1,
which names this as the bug and costs a re-review of the docs-only push.

The rule only works if the close-out goes into **every** round's commit, not the final one, because
which round is final is never knowable at push time. Recorded.

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-13 | Story created from Epic 4's spine. Row navigation and the register link deferred to 4.6 and 4.7 with the reasoning recorded. |
| 2026-08-13 | Implemented across five tasks. MR !59 converged after one review round: 10 findings, 8 taken, `readerPool` refused with a permissions probe. |
