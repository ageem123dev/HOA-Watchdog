---
baseline_commit: 26bf300
merge_request: 60
---

# Story 4.6: One finding, and what to do about it

Status: done

## Why this story exists

Story 4.5 put the queue on the dashboard and stopped one step short on purpose: the rows do not
navigate, because the place they would navigate to did not exist. This story builds it, and adds
the link at the same moment — so no version of the product ever ships a dashboard whose main
affordance is a 404.

It also carries the only action in the entire pilot. EXPERIENCE.md: *"Destructive and irreversible
actions do not exist in the pilot beyond marking a finding reviewed."* Everything else the board
can do is reading. This is the one place a click changes the record, and the record it changes
names a person.

### The decision that shapes the whole story (taken 2026-08-13)

**EXPERIENCE.md and migration 021 contradict each other, and the user resolved it.**

> *"Marking reviewed is undoable for the session — it moves a record, and a misclick must not
> require database access to correct."* — EXPERIENCE.md, Interaction Primitives

The database says the opposite, and says it in a trigger:

```sql
if old.state = 'reviewed' and (new.state is distinct from old.state ...) then
  raise exception 'finding % is reviewed; its state and reviewer are final';
```

`delete` and `truncate` are revoked from `watchdog_writer` and from `public`. A review, once
written, is permanent — which is the fiduciary argument `core/ports/finding.ts` makes at length and
which nothing here may weaken.

**Resolution: hold the write, do not undo it.** The surface shows *"Moved to register — Undo"* and
issues no database write until the window closes. Undo cancels a write that never happened, so it
needs no database access, contradicts no constraint, and leaves migration 021 exactly as it is.
Both documents end up telling the truth.

### The consequence that has to be designed, not discovered

A held write introduces a state the product has never had: **an action the user believes they have
taken, which the database does not yet know about.** Two rules follow, and both are acceptance
criteria rather than notes.

- **If the window is interrupted, the review is not recorded.** Navigating away, closing the tab,
  or a crash all resolve the same way: nothing is written. That is the conservative direction — an
  unreviewed finding stays in a queue somebody looks at again, whereas a review recorded by
  accident permanently names a board member as having read something they did not. The failure has
  to fall on the side that is recoverable.
- **The page must never claim more than it has done.** Until the write lands, the copy says the
  finding was moved *and offers to undo it*. Once it lands, the undo goes. A surface still offering
  undo after the write is a lie a board member would act on.

## Story

As a board member,
I want to open a finding, see exactly what was compared, and record that I have read it,
so that the register shows what the board knew and when — and so a misclick does not put my name
against something I never looked at.

## Acceptance Criteria

**AC1 — A finding has its own page, reached by clicking anywhere on its dashboard row.**
UX-DR4, the half story 4.5 deferred: the whole row is the click target, and the amount is **never**
a separate link — a mis-click near money must not do something different from a mis-click near
text. Every assertion in `app/dashboard/findings-list.test.tsx` still passes, and the row's shape
(tick, severity words, title, evidence line, amount, date) is unchanged.

**AC2 — The page shows what was compared, not a restatement of the row.**
The row carries one sentence because it is one of twenty. This page has the space to lay out the
evidence the detector stored: every duplicate pair, every spike with its own percentage and
average, the dues figures with their instalment count. UX-DR23 still governs the wording — it says
what was compared and never what it means.

**AC3 — Marking reviewed holds the write, and the undo cancels a write that never happened.**
No database call is issued until the window closes. Undo within the window leaves the finding
`unreviewed` and issues nothing at all — asserted by the write port never being called, not by
reading the row back, because a test that reads the row back passes against an implementation that
wrote and then failed to write again.

**AC4 — An interrupted window records nothing.**
Unmounting during the window — navigation, tab close — leaves the finding unreviewed. Asserted
directly: the component unmounts mid-window and the port is never called.

**AC5 — The page never offers an undo for a write that has landed.**
Once the write completes, the undo affordance is gone and the copy is past tense: *"Moved to
register."* A control that would call `markReviewed` again, or that implies reversibility after the
fact, is the defect this AC exists to forbid.

**AC6 — The already-reviewed state, reached from an old email link.**
UX-DR13's named state, and story 4.8 will send the links that land on it. The page shows the
finding with its register status, **who** reviewed it and **when**, and offers no action. Not an
error — an ordinary outcome that someone got there first.

**AC7 — A second review is refused, and the refusal is legible.**
`markReviewed` rejects with `AlreadyReviewedError`; the surface says the finding was already
reviewed and by whom, rather than reporting a failure. `FindingNotFoundError` is a *different*
outcome and must not be merged with it — one means somebody got there first, the other means the
id came from somewhere it should not have. `core/ports/finding.ts` argues for the split; this story
is where it becomes visible.

**AC8 — An unknown or malformed id does not render a page that looks like a finding.**
A 404, not a blank detail page with empty fields.

**AC9 — The route is protected, and the guard runs before the read.**
`PUBLIC_ROUTES` is an allow-list, so a new route is closed by default — but the page carries the
second lock the dashboard, upload and quarantine pages all carry, and it runs *before* the finding
is fetched.

**AC10 — Print treatment is out of scope here.**
UX-DR22 covers the register and finding detail; the register is story 4.7 and the two want one
stylesheet rather than two. Recorded so its absence is a decision rather than an oversight.

## Tasks / Subtasks

- [x] **Task 1 — Read one finding** (AC: 2, 6, 8)
  - [x] Extend `FindingReader` with `byId(id)`, returning the finding plus its lifecycle: state,
        the reviewer's display name, and the date reviewed. `null` when there is no such finding.
  - [x] Reading one finding is the same *capability* as reading the queue, so it belongs on the
        same port. The port test asserts an exact member list — update it deliberately, and keep
        the negative that forbids a write member.
  - [x] `adapters/db/finding-reader-postgres.ts` + db tests. **Dates through
        `to_char(… at time zone 'UTC', 'YYYY-MM-DD')`** — the rule three readers now carry.
  - [x] A malformed id must not reach Postgres as a cast error the page shows. `subject_id` and
        `id` are `uuid`; decide where the shape is checked and test it.

- [x] **Task 2 — The evidence, laid out** (AC: 2)
  - [x] Extend `core/findings/` with a detail view: the same copy rules as the row, more of it.
        Reuse `formatAmount`, the severity map and the titles — a second wording of the same
        finding is what `finding-view.ts`'s header argues against.
  - [x] `evidence` is still `unknown`. Every read narrows; nothing throws (4.5's AC6, unchanged).
  - [x] Follow `app/oracle/answer-view.tsx` for evidence-table semantics if a table is used —
        UX-DR5 wants real `<table>`, `<th scope>`, tabular right-aligned numerics.

- [x] **Task 3 — The held write** (AC: 3, 4, 5)
  - [x] A named constant for the window, in `core/`, with the reasoning beside it.
  - [x] The pending state is client-side; the server action fires only when the window closes.
        Undo clears the timer and issues nothing.
  - [x] **Interruption resolves to "not written"** — no `beforeunload`, no fire-on-unmount. Test it
        by unmounting.
  - [x] Announce the outcome in a live region (UX-DR20). Past tense once written
        (EXPERIENCE.md: *"Every action states its outcome in the past tense afterwards"*).
  - [x] `prefers-reduced-motion`: no countdown animation. The window is a delay, not a spectacle.

- [x] **Task 4 — The two states that are not the ordinary one** (AC: 6, 7, 8)
  - [x] Already-reviewed: status, reviewer, date, no action.
  - [x] `AlreadyReviewedError` and `FindingNotFoundError` reach the surface as *different*
        outcomes. A test that cannot tell them apart is the defect.
  - [x] Unknown id → 404 via `notFound()`.

- [x] **Task 5 — Wire it up** (AC: 1, 9)
  - [x] `app/findings/[id]/page.tsx`, and the dashboard row becomes a link to it.
  - [x] The whole row is the target; the amount is not separately focusable. Assert the link count
        per row is exactly one.
  - [x] Auth guard before the read, matching `app/quarantine/page.tsx` and the 4.5 dashboard.
  - [x] Add `FINDING_ROUTE` (or equivalent) to `core/auth/route-policy.ts` if a constant is wanted;
        `PUBLIC_ROUTES` stays an allow-list either way.

## Dev Notes

### What already exists and must not be rebuilt

| Thing | Where | Note |
| --- | --- | --- |
| `markReviewed(findingId, reviewerId)` | `core/ports/finding.ts`, `adapters/db/finding-postgres.ts` | Story 4.1. **The write path is done.** It rejects with `AlreadyReviewedError` / `FindingNotFoundError`. |
| `AlreadyReviewedError`, `FindingNotFoundError` | `core/ports/finding.ts` | Distinct on purpose. Read that header before merging them. |
| `FindingReader`, `UnreviewedFinding` | `core/ports/finding-reader.ts` | Already carries `subjectId` and `period` that 4.5 does not render — they are here for this story. |
| Row copy, severity, `formatAmount` | `core/findings/` | Reuse. Three surfaces describe one finding; 4.8's email is the third. |
| `FindingsList`, `FigureBlock` | `app/dashboard/` | The row's shape is settled. This story adds a link around it and changes nothing else. |
| Deny-by-default routing | `core/auth/route-policy.ts` | `PUBLIC_ROUTES` is an allow-list, so `/findings/[id]` is closed without being listed. |

### The schema, as it stands

`finding (id, finding_type, subject_id, period, evidence, raised_at, state, reviewed_by, reviewed_at)`.
`reviewed_by` references `board_member (id)`; the display name lives on `board_member.display_name`,
which is nullable. A reviewed finding whose reviewer has no display name still has to render — say
what is known, and do not invent a name.

`finding_review_is_attributed` guarantees that `state = 'reviewed'` implies both `reviewed_by` and
`reviewed_at` are present, so the detail page never has to handle a reviewed finding with no
reviewer. That is a constraint doing work; rely on it rather than re-checking it, and say so.

### What 4.5 learned, and this story inherits

- **The AC audit has found something on seven consecutive stories.** On 4.5 it found a field read
  by the adapter, carried by the port and the view, and rendered by nothing. Run it.
- **A fix is the highest-risk diff.** 4.5's repair of a CodeRabbit finding made the tests weaker
  twice in a row, and the second attempt was vacuous.
- **Ask of every refusal test: what would this look like if the refusal did not happen?** If the
  answer is "the same", the test is worth nothing. AC3 and AC4 are both refusal tests.
- **A table lookup keyed on untrusted input reaches `Object.prototype`.** `constructor` satisfies
  `finding_type_is_verb_noun`. Use `Object.hasOwn`; `core/findings/finding-view.ts` has the helper.
- **`TZ` is ignored on this Windows host** — measured. Timezone tests need two cases in opposite
  directions, not an environment variable.
- **A clean CodeRabbit verdict arrives as an *edit* to the summary comment**, not a new note. Match
  on body and `updated_at`.
- **The close-out rides in every review round's commit**, not the last one — which round is final is
  never knowable when you push.
- **Anything carrying a backslash goes through the editing tool**, never a shell heredoc.

### Where this story is unlike its predecessors

Every Epic 4 story so far has been read-only. This one writes, and the write names a person and
cannot be taken back. The held-write design is the whole of the risk: the pending state is a claim
the surface makes on the database's behalf before the database has agreed, and every failure mode
worth listing is a way that claim and the record come apart.

### References

- [Source: epics.md] — Epic 4 story spine, row 4.6; UX-DR4, UX-DR13, UX-DR20, UX-DR22, UX-DR23
- [Source: EXPERIENCE.md] — Alert Lifecycle; Interaction Primitives; State Patterns (*Finding
  detail — already reviewed*)
- [Source: core/ports/finding.ts] — why raising, reviewing and reading are three capabilities
- [Source: migrations/021_finding.sql] — the one-way trigger and the revoked `delete`
- [Source: 4-5-the-board-sees-what-needs-review.md] — the review record these learnings come from

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m]

### Test Design

#### Task 2 — the evidence, laid out

**Behaviour: `toFindingDetail(finding: FindingDetail): FindingDetailView`.** One pure function, the
same shape as `toFindingRow` and tested the same way — a literal `FindingDetail`, no seams needed,
because `evidence` is a plain value and nothing here reads a clock or a database.

*If it ran correctly, how would I know?* The header fields are **identical to the row's** for the
same finding (cross-check: call `toFindingRow` on the same input and compare), and the comparisons
table holds exactly one row per stored pair or spike, each carrying that entry's own figures.

*Could this happen anywhere else?* Yes — every defect shape below already exists in
`finding-view.ts`, which is why the narrowing helpers are **extracted to `core/findings/evidence.ts`
and shared** rather than copied. A second copy of `text()` is a second answer to "what counts as a
value", and this story's whole argument is that three surfaces describing one finding must not
disagree.

| # | Failure mode | Class | Forced by |
| --- | --- | --- | --- |
| 1 | `evidence` is a string, an array, or `null` | GUARD | every field read degrades; no table, no throw |
| 2 | `findingType` unrecognised | GUARD | humanised title, `worth-checking`, no invented sentence |
| 3 | `findingType` is `constructor` | GUARD | `known()` via `Object.hasOwn`; severity is not a function |
| 4 | detail title disagrees with the row's title | GUARD | derived *from* `toFindingRow`, asserted equal |
| 5 | `pairs` / `spikes` absent or not an array | GUARD | no comparisons table at all |
| 6 | `pairs` holds a string, `null`, or a nested array | GUARD | non-objects filtered; the real pairs still render |
| 7 | zero pairs | GUARD | **no table**, not an empty one — an empty table claims a comparison that found nothing |
| 8 | one pair / ten pairs | GUARD | zero-one-many; order preserved |
| 9 | a pair's `amount` absent or unparseable | GUARD | that cell only is absent; the row keeps its other cells |
| 10 | `reason` is `constructor` | GUARD | prototype reach into `MATCH_REASON` |
| 11 | `reason` is a rule this code does not know | GUARD | slug made legible (`same-amount-and-vat` → `same amount and vat`); never dropped, never invented |
| 12 | `percentOverAverage` is not a number (`"abc"`, a number, absent) | GUARD | no `abc%` on a fiduciary surface — the cell is absent |
| 13 | `average` / `invoicesAveraged` absent on one spike | GUARD | AC2 wants each spike's own figures; losing one must not lose the others |
| 14 | dues `kind: 'not-recorded'` | GUARD | **no `$0.00` received** — the row already refused to manufacture that zero |
| 15 | `expected` / `shortfall` / `instalmentsDue` / `evaluatedOn` absent | GUARD | each figure omitted independently |
| 16 | `unitNumber` / `holderName` absent | GUARD | never `unit undefined`; the figure is omitted |
| 17 | `invoicesChecked` absent | GUARD | omitted, never `0` — UX-DR24 forbids a manufactured denominator |
| 18 | `thresholdPercent` / `windowMonths` absent | GUARD | omitted |
| 19 | a hostile string reaches a cell (`<script>`, a lone `"`) | PROPAGATE | carried verbatim; React escapes it, and re-escaping here would double it |
| 20 | `matchRule` (`normalised-exact`) rendered to the board | OUT-OF-SCOPE | deliberately not shown: it names the *matcher's* internals, not what was compared. Recorded so its absence is a decision |

**Reverse-it / cross-check.** The cross-check is #4 and it is the strong one: the detail header is
verified against an independent existing implementation of the same copy (`toFindingRow`) rather
than against a literal an author of this test chose. A reverse operation does not apply — the view
is a projection that deliberately discards, so nothing reconstructs the evidence from it.

#### Task 3 — the held write

**Behaviour: a client control that holds a write for a window and issues it when the window closes.**
The whole risk of the story is here: between the click and the write there is a state in which the
board member believes they have acted and the database has not been told.

*If it ran correctly, how would I know?* The injected action is called **exactly once, and only
after the window elapses** — and in the undo and unmount cases, **never**. Both are assertions about
a spy, not about a row read back: AC3 says so explicitly, because reading the row back also passes
against an implementation that wrote and then failed to write again.

*How am I going to test it?* Two seams, and neither exists by accident. The action is a **prop**, so
the test holds the spy that proves the negative; the clock is `vi.useFakeTimers()`, so the window is
advanced rather than waited on. A control that reached for the server action itself would make AC3
unassertable.

| # | Failure mode | Class | Forced by |
| --- | --- | --- | --- |
| 1 | the write is issued on click | GUARD | spy not called after click; called only after the window elapses |
| 2 | undo within the window still writes | GUARD | undo, advance past the window, spy never called |
| 3 | unmount within the window writes | GUARD | unmount mid-window, advance, spy never called (AC4) |
| 4 | unmount leaves the timer running | GUARD | same test — a leaked timer is what would fire |
| 5 | double click starts two windows | GUARD | two clicks, advance, spy called **once** |
| 6 | undo pressed twice | GUARD | idempotent; still nothing written |
| 7 | undo offered after the write lands | GUARD | AC5 — no undo control in the settled state |
| 8 | undo *acts* after the write lands | GUARD | the control is gone, so there is nothing to press; asserted as absence |
| 9 | the control re-arms after a completed review | GUARD | no "mark reviewed" control once recorded |
| 10 | copy claims the write before it lands | GUARD | pending copy offers undo; settled copy is past tense |
| 11 | the outcome is never announced | GUARD | `role="status"` live region carries it (UX-DR20) |
| 12 | the action rejects and the surface says it succeeded | GUARD | rejected promise → not the past-tense success copy |
| 13 | the action throws synchronously | GUARD | same handling; no unhandled rejection |
| 14 | a countdown animation runs under `prefers-reduced-motion` | GUARD-by-construction | **there is no animation at all**, so there is no branch to get wrong |
| 15 | the write lands after unmount and setState warns | PROPAGATE | the row is correct; only the UI cannot update. Nothing is retried and nothing throws |
| 16 | a backgrounded tab throttles the timer | OUT-OF-SCOPE | the write still happens, later. Browsers own this; no `beforeunload` is added to compensate — that is what AC4 forbids |

**Failure mode 14 is the one worth naming.** The subtask asks for no countdown animation under
`prefers-reduced-motion`; the cheap reading is a media query around an animation. Having **no
animation on any path** satisfies it without a branch, and a rule enforced by the absence of code
cannot rot. The window is a delay, not a spectacle.

**Reverse-it / cross-check.** Neither applies, and the reason is the design: the whole point is that
nothing is persisted during the window, so there is no state to read back and invert. The
cross-check is structural instead — every negative is asserted on the injected spy, which is the
only observer that can tell "not written" from "written and not visible".

#### Task 4 — the two states that are not the ordinary one

**Behaviour A: `markFindingReviewed` — the server action.** Its whole job is to turn three
distinguishable failures into three distinguishable answers, and AC7 says the defect is a test that
cannot tell them apart.

*Seams:* `vi.mock` over `@/adapters/auth/auth` and the two adapters, as `app/quarantine/actions.ts`'s
test does. The guard is asserted by **the write port never being called**, not only by the returned
value — a server action is its own entry point, reachable without the page ever rendering.

| # | Failure mode | Class | Forced by |
| --- | --- | --- | --- |
| 1 | no session | GUARD | `refused`, and `markReviewed` never called |
| 2 | a session carrying no user id | GUARD | same — the truthiness check alone passes a session with no user |
| 3 | a malformed finding id | GUARD | `not-found` **before Postgres sees it**; a 22P02 reported as "the register could not be reached" is a lie about which thing broke |
| 4 | `AlreadyReviewedError` | GUARD | `already-reviewed`, carrying who and when |
| 5 | `FindingNotFoundError` | GUARD | `not-found`, and **a test that cannot separate this from 4 is the defect** |
| 6 | the follow-up read of who/when fails or returns nothing | GUARD | still `already-reviewed`, with no date — never `failed`, because the review does exist |
| 7 | any other rejection | GUARD | `failed`, logged before it is discarded |
| 8 | the failure is swallowed with no trace | GUARD | `console.error` asserted; this is the only write path in the story |
| 9 | the reviewer has no display name | GUARD | says what is known; never "by null" |

**Behaviour B: the already-reviewed state (AC6).** The finding is shown with its register status,
who reviewed it and when, and no action.

| 10 | the detail view carries no lifecycle | GUARD | `reviewed` is present exactly when the row is reviewed |
| 11 | the static state and the refusal are worded differently | GUARD | **both come from `reviewMessage`, asserted equal** — AC6 and AC7 describe the same fact reached two ways, and two wordings of it is the drift this story exists to prevent |

**Cross-check** — #11 is one, and the strong one: the sentence a reader gets by arriving late is
compared against the sentence they get by being refused, rather than against a literal.

**The uuid shape check is shared, not copied.** Task 1 put one in the reader; the action needs the
same answer, and a second regex is the `MATCH_REASON` mistake again. It moves to
`core/findings/finding-id.ts` and both callers import it.

**Deviation, recorded:** AC8's `notFound()` is listed under this task but lands with `page.tsx` in
task 5, because it is a page behaviour and creating the page here would mean committing a route
before task 5 adds its auth guard. Everything else in AC8 — refusing a malformed id without
rendering a finding-shaped page — is this task's and is asserted here.

### Completion Notes

**Baseline (1ef0b6e):** 2599 tests passing, 813 db tests, 8 pre-existing `tsc` errors.

#### Task 1 — read one finding

`UnreviewedFinding` was renamed to **`FindingRecord`**. The old name became a lie the moment a
detail page could show a reviewed finding, and `FindingDetail extends FindingRecord` needs an
honest base. Thirteen references across six files, mechanical.

`reviewed` lives on `FindingDetail` and deliberately not on `FindingRecord`: the queue returns
unreviewed findings by definition, so the field would be permanently null on the one surface that
reads it, and a caller trusting it there would be trusting an accident of the query.

`byId` returns `FindingDetail | null` rather than rejecting. "No such finding" is ordinary on a
surface reached by a kept link — 4.8 will send those links — and a rejection would put it in the
same channel as a database failure, where the page could no longer tell "that id was never real"
from "the register is down".

**A malformed id is refused before Postgres sees it.** `finding.id` is a `uuid`, so a bad value
raises 22P02 on the cast, and the id comes straight off the URL path where anything is reachable by
typing. The honest answer to "is there a finding here" is no, not a database error.

**The template literal ate a backtick.** The SQL comment was first written with `` `left join` ``
in it, which closed the string mid-query. The suite reported it as *21 tests vanishing* and `tsc`
as **fewer** errors than baseline — neither of which reads as a syntax error. Worth knowing that a
suddenly-smaller error count is a signal, not an improvement.

*Sensitivity:* three mutations, all caught. Removing the uuid guard failed 1; reporting every
finding as reviewed failed 1; an inner join in place of the left join failed 1.

*Review gate — `argus_review` on the task diff:* `moderate` · confidence 0.95 · 9/9 files. Four
findings, **all four confirmed and taken**:

- **[medium] the nameless-reviewer test cleaned up after its assertions**, so a failure leaked the
  row. Cleanup moved into `afterAll` and widened to delete fixture members by email prefix.
- **[medium] `toContain([before, after])` on the two date assertions flakes under concurrency.**
  `max` is monotonic so the answer lies between the controls, but two concurrent inserts can make
  it an *intermediate* value equal to neither. The count assertions beside them already used
  bounds; the dates did not. Now both do — and both mutations were re-run afterwards to confirm the
  weaker-looking form still bites, because 4.5's fixes weakened its tests twice in a row.
- **[low] `DetailRow extends FindingRow`** forced the single-finding query to select a dummy
  `0 as total`, and `0` is an int4, so node-pg returned a number where the interface promised a
  string. Declared independently.
- **[info] the left-join comment asserted something false about SQL** — it blamed a nullable
  `display_name`, when an inner join filters on the join condition, not on the columns selected
  through it. The real reason is that `reviewed_by` is null on every unreviewed finding. Same defect
  class as story 4.3's migration comment.

#### Task 2 — the evidence, laid out

`toFindingDetail` **calls `toFindingRow`** for the header rather than re-deriving any of it, and the
tests assert equality against that call rather than against literals. A literal would have passed
while the two surfaces drifted, which is the defect the arrangement exists to prevent — the
mutation that appended `" (detail)"` to the title failed 6 tests.

The narrowing helpers moved out of `finding-view.ts` into **`core/findings/evidence.ts`**. Two
copies of `text()` would be two answers to "what counts as a value", and the row and the page
disagreeing about whether `""` is a vendor name is where that drift actually starts.

**A table is `null`, never empty.** Headers over no rows claim a comparison ran and matched nothing;
an absent `pairs` means it did not run. The two are indistinguishable once drawn, and the mutation
that returned an empty table instead of `null` failed 8 tests.

**A dues shortfall gets no comparisons table at all** — one unit against its own schedule is
arithmetic, and a one-row table would imply there could have been others. Its figures are the
comparison. `matchRule` (`normalised-exact`) is likewise omitted on purpose: it names how the
matcher spells invoice numbers to itself, not what was compared.

*Sensitivity:* four mutations, all caught — always-emit-a-table (8), manufacture the `$0.00`
received (1), let the title drift from the row's (6), drop the percentage guard (1).

*Test-value pass — it found something the mutations could not.* The blank guard in `text()`
(`"   "` is not a vendor name) was **covered by nothing**: all 115 tests passed with it removed.
Not lost cover from the extraction — it was unasserted while private in `finding-view.ts` too, and
promoting it to a shared module with a stated contract is what exposed it. Four cases added, failing
first: a blank cell reads as empty and is not, and a title built from one gains a separator with
nothing after it.

*Review gate — `argus_review` on the task diff:* `moderate` · confidence 1.0 · 7/7 files · 1 agy
call. Two findings, **both confirmed against the real files and both taken**:

- **[medium] the dashboard row had no percentage guard**, and it is the sibling of the one this task
  built. `text(only['percentOverAverage'])` was interpolated straight into the sentence, so a stored
  `"abc"` rendered *"abc% above a 6-month average of $980.00"* — verified live before fixing. The
  validation is now `decimal()` in `evidence.ts` and both surfaces use it; a value carrying its own
  `$` is refused too, because the surface adds the mark.
- **[low] `MATCH_REASON` was duplicated** into the new file. Moved to `evidence.ts`. The two readers
  stay deliberately different — the row *drops* a slug it does not know because its sentence has a
  grammatical slot, the table *makes it legible* because a cell has none — but they now read one
  table. Mutating it failed 3 tests across both callers.

#### Task 3 — the held write

The control takes the write as a **prop**, which is what makes AC3 assertable at all: the test holds
the spy that proves the negative. A control reaching for the server action itself would leave
"nothing was written" unprovable, and AC3 is explicit that reading the row back is not good enough.

**No animation on any path**, so `prefers-reduced-motion` has nothing to switch off. A rule enforced
by the absence of the mechanism cannot be dropped by a later layout change; one enforced by a media
query can.

`canRetry` is a fiduciary judgement rather than a styling detail. Three of the four outcomes are
*answers* — it landed, somebody got there first, that finding is not on the register — and offering
to retry an answer invites a board member to press until the register agrees with them. Only an
unreachable register is worth a second attempt.

*Sensitivity:* six mutations, all caught — drop the unmount cleanup (2), stop cancelling on undo (2),
re-offer the control after a landed write (1), drop the in-flight guard (1), stop resetting on a
change of finding (2), drop the generation guard (1). The stub the tests were first run against
failed 12.

*Review gate — three `argus_review` rounds on this task, because **each round found defects in the
previous round's fix**.* That is the pattern `_bmad/custom/review-gate.md` documents, happening
again.

**Round 1** — `moderate` · confidence 0.95 · 6/6 files. Two `high`, both confirmed:

- **The undo stayed live while the write was in flight.** The window closing and the register
  answering are two moments; the control treated them as one. A board member pressing Undo in
  between would watch the control reset and then watch the page flip to *"Moved to register."* —
  having recorded, under their own name and permanently, a review they had just cancelled. **This
  is AC5's defect, one moment earlier than the obvious reading of it.** Fixed with a `sending`
  state entered *before* the call, and copy that claims nothing until the register answers.
- **A change of finding did not cancel the window.** Next.js reuses this component across
  `/findings/a` → `/findings/b`, so a cleanup keyed on unmount never runs while the timer's closure
  still holds the old id — recording a review against the finding the reader just left, and
  announcing it on the one in front of them.

**Round 2** — two more, both inside round 1's fix. One confirmed `high`: the in-flight promise called
`setState` unconditionally, so an answer for finding-1 landed on finding-2's page. One `medium`
confirmed: resetting state in an effect resets it *after* paint, so a newly-opened finding showed
the previous one's "Moved to register." for a frame.

**Round 3** — three `high`, and **only one survived verification**:

- **Confirmed: a ref was written during render.** React may discard a render, leaving the ref ahead
  of the state it describes. Rewritten as a generation counter bumped inside `cancel` — the one
  path every interruption already goes through — so it is only ever written from an event handler
  or an effect cleanup.
- **Not reproduced: "`useEffect` cleanup is asynchronous, so the timer can fire first."** The
  mechanism is real and the consequence is not reachable at a five-second window — a passive
  cleanup is flushed within a tick. The existing test advances **100×** the window after unmount and
  the port is still never called, with `vi.getTimerCount()` at zero. The suggested `useLayoutEffect`
  was declined for a second reason: it warns under SSR, and this is a client component Next.js
  renders on the server.
- **Not reproduced: "the timer callback should check the finding before setting `sending`."** A
  change of finding cancels the timer, so the callback cannot run holding a stale id — the state it
  describes is unreachable. Adding the guard would be a guard no test could force, which the
  workflow's own rule forbids.

*Not directly asserted, and recorded rather than left silent:* the **paint-flash** half of round 2's
`medium`. Testing Library flushes effects inside `act`, so a frame rendered before effects run is
not observable from a test, and a test that passed either way would be worth nothing. The fix (state
adjusted during render) is applied and the *race* half is asserted.

#### Task 4 — the two states that are not the ordinary one

AC6 and AC7 are the same fact reached two ways — arriving late, and being refused a moment too late
— so **both come from one `reviewMessage`**, and the test compares the page's sentence against the
refusal's rather than against a literal. A literal would pass while the two drifted, which is the
only way this could go wrong.

`already-reviewed` carries `on: string | null` because the date is read in a **second** query issued
after the refusal, and that query can fail on its own. Reporting `failed` when it does would tell a
board member the register was unreachable at the moment it had just answered them; the copy says
only what is known instead.

`refused` joined the union: a signed-out caller is not an unreachable register, and calling it
`failed` would offer a retry that cannot help.

The uuid check moved to `core/findings/finding-id.ts` and both callers import it — the reader (so a
bad path segment is a 404, not a 500) and the action (so a bad id is not reported as "the register
could not be reached", which names the wrong thing as broken).

*Sensitivity:* three mutations on the action, all caught — merge the two refusals (5), drop the id
shape guard (5), drop the session guard (3). Plus five red assertions before the already-reviewed
view existed.

*Review gate — `argus_review` on the task diff:* the first two calls **failed in the provider**
(`agy` returned nothing; a direct probe confirmed the CLI itself was healthy). The third, with
`refine: false`, completed: `moderate` · confidence 0.9 · 11/11 files.

All three findings landed in `adapters/db/finding-reader-postgres.test.ts` — **task 1's file, outside
this task's diff**, pulled in as repo context. Verified anyway, since it is inside the story's range.
**None required a change, and all three are recorded rather than dropped:**

- **[high] `setPoolTimeZone` breaks isolation across concurrently executing files — not reproduced.**
  `writerPool()` is module-scoped, and `vitest.config.ts` overrides neither `pool` nor `isolate`, so
  each test *file* runs in its own module registry with its own pool; there is nothing shared to
  interfere with. No `.concurrent` anywhere in `adapters/db/`, so tests within a file are sequential,
  and the zone is restored in a `finally`.
- **[medium] a connection leaks if the second `beforeAll` connect fails — disagree.** `afterAll` ends
  both through `Promise.allSettled`, and a socket held by a worker that is exiting dies with it.
- **[medium] the bracketed counts can be straddled by a concurrent insert *and* delete — confirmed,
  and accepted.** Real: another file's `afterAll` deletes findings, so the count is not monotonic and
  task 1's "the answer lies between the controls" reasoning holds only for inserts. Not fixed,
  because `unreviewed()` returns a **global** total by design and cannot be scoped to this file's
  rows — every alternative weakens the assertion, which the hard rules forbid. Left as a known
  residual: it needs a concurrent insert and delete inside a sub-second window.

#### Task 5 — wire it up

**Every assertion in `app/dashboard/findings-list.test.tsx` still passes unchanged**, which is what
AC1 asks for. The row's shape did not move to accommodate the link — the link was wrapped around the
shape, and the grid moved onto the anchor.

`findingRoute(id)` is a function on `core/auth/route-policy.ts` rather than a constant, because two
places have to agree on how the id goes into the path. It **encodes** the id: story 4.8 will put
these links in email, and a route built by concatenation from a value nobody encoded is one `../`
from pointing elsewhere. `PUBLIC_ROUTES` is untouched and asserted untouched — the route is closed
because the allow-list does not name it and does no prefix matching.

The anchor states `color: inherit` and `textDecoration: none`. Unstated, twenty rows in link blue
read as twenty destinations rather than as a register.

*Sensitivity:* three mutations, all caught — read before the guard (1), drop `notFound()` (3), make
the amount its own link (5).

*Review gate — `argus_review` on the task diff:* `moderate` · confidence 0.95 · 10/10 files. One
finding, **disagreed with and recorded**:

- **[medium] "awaiting `auth()` before `params` creates a concurrency waterfall."** The code is as
  described; the consequence is not. `params` is a promise Next has already put in flight — this
  code does not initiate it, so there is no second round-trip to overlap and the saving is ~0. Kept
  sequential for a positive reason too: reading `params` after the session check keeps AC9's
  guard-before-read ordering legible at a glance, and that ordering is the thing a later editor is
  most likely to break.

#### The acceptance-criteria audit — and it found something again, on the eighth story

The Dev Notes named the place: *"`FindingReader` … already carries `subjectId` and `period` that 4.5
does not render — **they are here for this story**."* At the end of task 5, **`period` was rendered
by nothing** — read by the adapter, carried by the port, carried by the view, and dropped at the
surface. The same shape 4.5's audit found for the detection date.

It is now the first figure on every finding, whatever its type, added once in `toFindingDetail`
rather than inside each `lay*` function so a detector added later cannot forget it.

**Stated inclusively, where the database stores it half-open.** `[2026-04-01, 2026-05-01)` covers
April, and printed as stored it reads as though the first of May were in it — a board member
checking their own records against the finding would be looking at the wrong month.
`core/ports/finding.ts` chose the half-open form because that is what Postgres canonicalises a
`daterange` into; this is where it stops being a storage detail.

*`subjectId` is deliberately still unrendered*, and that is a decision rather than the same
oversight: it is a raw uuid identifying a document, a unit or a vendor depending on the type, there
is no surface to link it to yet, and printing it would be machine text on a board member's page.

**The sensitivity pass then caught a test of mine passing for the wrong reason.** `Date.UTC` rolls
an impossible date *forward* rather than refusing it, so the round-trip check that catches
`2026-02-30` had no test behind it: the case I wrote was caught by the `end <= start` range check
instead, and removing the guard entirely left all 70 tests green. Three cases added with enough room
to roll forward — `2026-02-30 → 2026-06-01`, a thirteenth month, and an April the 31st — and the
mutation now fails three.

*Expired premises, re-specified:* six cases asserted `figures` was empty for degraded evidence and
for an unrecognised type. They meant *no evidence-derived figures*, and the period is a column on
the row rather than a field of the blob. Re-specified to assert the period is the only figure, which
keeps exactly the cover they had.

### File List

**Task 1** — `core/ports/finding-reader.ts`, `core/ports/finding-reader.test.ts`,
`adapters/db/finding-reader-postgres.ts`, `adapters/db/finding-reader-postgres.test.ts`,
`core/findings/finding-view.ts`, `core/findings/finding-view.test.ts`,
`core/findings/dashboard-view.test.ts`.

**Task 2** — `core/findings/evidence.ts` (new), `core/findings/detail-view.ts` (new),
`core/findings/detail-view.test.ts` (new), `core/findings/finding-view.ts`,
`core/findings/finding-view.test.ts`.

**Task 3** — `core/findings/review.ts` (new), `core/findings/review.test.ts` (new),
`app/findings/review-control.tsx` (new), `app/findings/review-control.test.tsx` (new).

**Task 4** — `core/findings/finding-id.ts` (new), `app/findings/actions.ts` (new),
`app/findings/actions.test.ts` (new), `core/findings/review.ts`, `core/findings/review.test.ts`,
`core/findings/detail-view.ts`, `core/findings/detail-view.test.ts`,
`adapters/db/finding-reader-postgres.ts`.

**Task 5** — `app/findings/[id]/page.tsx` (new), `app/findings/[id]/page.test.tsx` (new),
`app/findings/[id]/detail-panel.tsx` (new), `app/findings/[id]/detail-panel.test.tsx` (new),
`core/auth/route-policy.ts`, `app/dashboard/findings-list.tsx`,
`app/dashboard/findings-list.test.tsx`.

**AC audit** — `core/findings/detail-view.ts`, `core/findings/detail-view.test.ts`.

### Review Findings

**Nineteen mutations run across the story; all nineteen caught.** Nine `argus_review` calls (five
per-task, two whole-story, two on fix diffs), one local CodeRabbit CLI round, and the
acceptance-criteria audit.

#### The integration pass — `main...HEAD` at `5c570dd`

`complex` · confidence 1.0 · 20/27 files · **no findings.** Reviewed the composition of all five
tasks plus the CodeRabbit round's fixes, which per-task reviews structurally cannot see.

An earlier whole-story pass at `731cd7b` found the pluralisation defect fixed in `b3f3d70`; this one
is on the head the merge request points at.

#### What each earlier round found — and what was refused

Recorded per task above. The three worth naming here:

1. **The held write took three rounds, because each found a defect in the previous round's fix** —
   the pattern `_bmad/custom/review-gate.md` documents, happening again. The worst was AC5's own
   defect one moment earlier than its obvious reading: the undo stayed live while the write was in
   flight, so pressing it would reset the control and then flip the page to "Moved to register.",
   having permanently recorded a review the board member had just cancelled.
2. **The test-value pass found a guard no mutation could have found** — `text()`'s blank check was
   unasserted in both callers, and all 115 tests passed with it removed. Later the same pass caught
   a test of *mine* passing for the wrong reason: `Date.UTC` rolls an impossible date forward rather
   than refusing it, so the round-trip check that catches `2026-02-30` was being satisfied by the
   range check instead.
3. **The AC audit found something on the eighth consecutive story** — `period`, read by the adapter,
   carried by the port and the view, rendered by nothing.

**Five findings were verified and refused**, each with its reason, rather than dropped:

| Finding | Verdict |
| --- | --- |
| `setPoolTimeZone` breaks isolation across concurrent files | **not reproduced** — the pool is module-scoped and Vitest isolates test files; nothing is shared |
| a connection leaks if the second `beforeAll` connect fails | **disagree** — `afterAll` ends both via `allSettled`, and the socket dies with the exiting worker |
| `useEffect` cleanup is async, so the timer can fire first | **not reproduced** — unreachable at a five-second window; the test advances 100× it and the port is never called |
| the timer callback should re-check the finding before `sending` | **not reproduced** — a change of finding cancels the timer, so the state is unreachable and no test could force the guard |
| awaiting `auth()` before `params` is a concurrency waterfall | **disagree** — `params` is already in flight; and the order keeps AC9's guard-before-read legible |
| `ReturnType<typeof vi.spyOn>` is a TypeScript compile error | **not reproduced** — `tsc` reports 8 errors, the baseline, none in that file. Argus read its own verifier's `rc=-1` as a diagnostic. The suggested fix would have *broken* the build: Vitest 4.1.10 exports `MockInstance`, not `SpyInstance` |

**One residual, accepted and recorded:** the bracketed count assertions in task 1's db test can be
straddled by a concurrent insert *and* delete, because another file's `afterAll` deletes findings and
the count is therefore not monotonic. Not fixed — `unreviewed()` returns a **global** total by design
and cannot be scoped to one file's rows, and every alternative weakens the assertion.

#### Gates on `5c570dd`, locally — there is no CI, so this is the whole of the evidence

`npm test` 2769 passed · `npm run test:db` 813 passed · `npm run lint` 0 errors (1 pre-existing
warning) · `npx tsc --noEmit` 8 errors, matching baseline · `npm run build` compiled, with
`/findings/[id]` registered.

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-13 | Story created. The EXPERIENCE.md/migration-021 conflict over undo was put to the user, who chose to hold the write rather than reverse it. |
| 2026-08-13 | Tasks 1–5 implemented test-first. Nine Argus rounds, one local CodeRabbit round (7 of 7 taken), 19 mutations all caught. The AC audit found `period` unrendered — the eighth consecutive story it has found something. Merge request !60 opened; status `done`, meaning ready-to-merge. |
