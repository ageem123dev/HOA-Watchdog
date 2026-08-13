---
baseline_commit: 26bf300
---

# Story 4.6: One finding, and what to do about it

Status: in-progress

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

- [ ] **Task 3 — The held write** (AC: 3, 4, 5)
  - [ ] A named constant for the window, in `core/`, with the reasoning beside it.
  - [ ] The pending state is client-side; the server action fires only when the window closes.
        Undo clears the timer and issues nothing.
  - [ ] **Interruption resolves to "not written"** — no `beforeunload`, no fire-on-unmount. Test it
        by unmounting.
  - [ ] Announce the outcome in a live region (UX-DR20). Past tense once written
        (EXPERIENCE.md: *"Every action states its outcome in the past tense afterwards"*).
  - [ ] `prefers-reduced-motion`: no countdown animation. The window is a delay, not a spectacle.

- [ ] **Task 4 — The two states that are not the ordinary one** (AC: 6, 7, 8)
  - [ ] Already-reviewed: status, reviewer, date, no action.
  - [ ] `AlreadyReviewedError` and `FindingNotFoundError` reach the surface as *different*
        outcomes. A test that cannot tell them apart is the defect.
  - [ ] Unknown id → 404 via `notFound()`.

- [ ] **Task 5 — Wire it up** (AC: 1, 9)
  - [ ] `app/findings/[id]/page.tsx`, and the dashboard row becomes a link to it.
  - [ ] The whole row is the target; the amount is not separately focusable. Assert the link count
        per row is exactly one.
  - [ ] Auth guard before the read, matching `app/quarantine/page.tsx` and the 4.5 dashboard.
  - [ ] Add `FINDING_ROUTE` (or equivalent) to `core/auth/route-policy.ts` if a constant is wanted;
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

### File List

**Task 1** — `core/ports/finding-reader.ts`, `core/ports/finding-reader.test.ts`,
`adapters/db/finding-reader-postgres.ts`, `adapters/db/finding-reader-postgres.test.ts`,
`core/findings/finding-view.ts`, `core/findings/finding-view.test.ts`,
`core/findings/dashboard-view.test.ts`.

**Task 2** — `core/findings/evidence.ts` (new), `core/findings/detail-view.ts` (new),
`core/findings/detail-view.test.ts` (new), `core/findings/finding-view.ts`,
`core/findings/finding-view.test.ts`.

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-13 | Story created. The EXPERIENCE.md/migration-021 conflict over undo was put to the user, who chose to hold the write rather than reverse it. |
