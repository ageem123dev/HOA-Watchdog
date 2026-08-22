---
Status: ready-for-dev
baseline_commit: 658fb22
merge_request:
---

# Story 5.4: Mapping one column to another

## Story

As **a treasurer setting up an import**,
I want **to pair the columns my export actually has with the ones the importer needs, with a mouse or with the keyboard**,
so that **my bank's spreadsheet can be imported without me renaming a single column by hand, and without a mouse being the only way in**.

## What this story is, in one line

Story 5.3 answers *what columns does this file have*. This one answers *which of ours does each of
them correspond to* — and it is the first place in the product where a treasurer configures
anything.

## Two things it would be easy to get wrong, and both are load-bearing

**A mapping keyed on heading text throws away everything 5.3 built.** That story exists because
headings duplicate and go blank: a file with two columns called `amount` is reported rather than
refused, and a column with no name at all is reported by its position because position is the only
thing that identifies it. A mapping stored as `amount -> amount` cannot express *which* `amount`,
and cannot express a blank column at all. So the source side of a pairing is a **position**, and the
heading text is what is shown next to it.

**Keyboard operation is not a pass over a finished drag surface.** EXPERIENCE.md sets a WCAG 2.2 AA
floor and epics.md says so directly: *"keyboard operation has to be designed in at 5.4, not
retrofitted after the interaction feels right with a mouse. The cheapest correct answer is usually a
selectable list pairing, with dragging as an accelerator over it rather than the mechanism."* That
is the shape to build: **the pairing operation is the mechanism, and both drag and keyboard are
callers of it.** A drag handler that mutates state on its own is how the two paths come to disagree,
and the one that disagrees silently will be the keyboard one, because nobody demos it.

## Acceptance Criteria

1. **The importer's fields come from the importer.** The targets offered for a declared kind are
   derived from `REQUIRED_HEADERS`, `OPTIONAL_HEADERS`, `ROLL_REQUIRED_HEADERS` and
   `KINDS_WITH_UNIT_REFERENCE` — not from a list written here. A target the importer would refuse is
   never offered: `unit` is a target for `deposit` and `assessment_roll` and for nothing else,
   because `validate` rejects a unit reference on the other kinds. Two lists is how a wizard comes
   to produce a mapping the parser then throws away.

2. **A pairing names a position, not a heading.** The source side of every pairing is the 1-based
   position story 5.3 reports. A treasurer with two `amount` columns can map one of them and not the
   other; a column with a blank heading can be mapped at all. A mapping keyed on text can do
   neither, and the tests state which side is which.

3. **A target holds one source, and a source claimed twice is refused with both named.** Assigning a
   column already paired to another target is refused, naming the target that already holds it. Not
   silently moved: a treasurer building the bottom of the list would find the top of it changed
   underneath them, on a screen they are not looking at.

4. **Incomplete is a state, not an error.** A draft with required targets still unfilled is a valid
   draft; it reports *which* required targets remain, all of them at once. Completeness is something
   the draft answers, not something it enforces — the same inversion story 5.3 made against
   `readRows`, for the same reason: a treasurer half way through building a mapping has done nothing
   wrong.

5. **The whole mapping can be built and taken apart by keyboard alone.** Every pairing and every
   unpairing is reachable and operable without a pointer, with no focus trap and with focus visible.
   Asserted by driving the surface with keyboard and activation events only — a test that clicks is
   not evidence about the keyboard path.

6. **Dragging is an accelerator over the same operation, never a second implementation.** The pointer
   path and the keyboard path call one pairing function, and the tests prove they agree by observing
   the same resulting state rather than by reading the source. Drag support removed, the surface is
   still fully operable.

7. **Every pairing is announced, and no state is carried by colour alone.** Pairing and unpairing are
   reported through a live region naming both sides. A paired row says it is paired in text; a
   required target still unfilled says so in words, not by being tinted.

8. **What 5.3 reported is shown where the mapping is built.** Duplicated headings are named with the
   positions they occupy, and blank headings by position, on this screen. A treasurer told about a
   duplicate on some earlier screen and then shown two identical rows here has been told nothing
   useful.

9. **Nothing is stored and nothing is guessed.** The draft mapping is not persisted (5.7), no
   suggestion is offered (5.6), and no parsed rows are shown (5.5). The mapping module takes no
   store, and its test says so by calling it with nothing.

## Tasks / Subtasks

- [x] **Task 1 — The targets a kind actually has.** Derived from the importer's own constants, per
      document kind, with required and optional distinguished. (AC1)
- [x] **Task 2 — A draft mapping, keyed by position.** Assign, unassign, and a report of what is
      still missing. One source per target; a source claimed twice refused with both named. Takes no
      store. (AC2, AC3, AC4, AC9)
- [ ] **Task 3 — The sample-reading surface story 5.3 deferred.** The server action that calls
      `readSampleHeadings`, and the step that reaches it. 5.3 held this back deliberately so the
      action would land with the screen that calls it — see Dev Notes.
- [ ] **Task 4 — Pairing by keyboard, as the mechanism.** A selectable pairing surface: choose a
      column, choose a target, pair; and the inverse. Live region, visible focus, text state. (AC5,
      AC7)
- [ ] **Task 5 — Dragging, over the same operation.** A pointer accelerator that calls the same
      pairing function and nothing else. (AC6)
- [ ] **Task 6 — Duplicates and blanks, on the screen where they matter.** (AC8)

## Dev Notes

### The HTTP surface 5.3 left here on purpose

`core/extraction/sample-headings.ts` says it in its own header: *"The wizard screen is story 5.4, and
a server action with nothing rendering it is precisely the shape that shipped broken in 5.2 — an
action requiring a field no form sent, with every gate green. The action lands with the screen that
calls it."*

So the action is this story's, and the 5.2 lesson applies to it directly: **a test that renders the
form and asserts what it submits is the only thing that catches a field the action requires and the
form does not send.** `app/upload/upload-form.test.tsx` exists for exactly that reason and is the
pattern to copy — assert the control's `name`, because the name is what reaches `formData.get(...)`.

### What exists

- `core/extraction/sample-headings.ts` — `readSampleHeadings(file, deps)`, taking no store and no
  kind, returning `{ ok: true, headings, problems }` or one of four refusal reasons
  (`no-reader`, `unreadable-file`, `no-rows`, `no-headings`).
- `core/extraction/headings.ts` — `Heading` is `{ position (1-based), text (as written),
  normalised }`; `HeadingProblem` is `duplicate-heading` (with `heading` and `positions`) or
  `blank-heading` (with `positions`). `normaliseHeading` is the shared folding, and `tabular.ts`
  imports it rather than defining its own.
- `core/extraction/tabular.ts` — `REQUIRED_HEADERS` = `date, description, amount`;
  `OPTIONAL_HEADERS` = `reference, unit, ...ROLL_HEADERS`. `readRows` additionally requires
  `ROLL_REQUIRED_HEADERS` (`unit, cycle, year`) when the kind is `assessment_roll`.
- `core/extraction/record.ts` — `DOCUMENT_KINDS` and `KINDS_WITH_UNIT_REFERENCE` (`deposit`,
  `assessment_roll`), with a header comment naming the exact trap AC1 guards: *"One statement, two
  readers... Splitting that into two lists is how the parser comes to produce a value the validator
  then rejects."*
- `app/upload/` — the house shape for a protected page plus a client form plus a `'use server'`
  actions module, and `upload-form.test.tsx` for how a render test mocks the action at the module
  boundary.

### Where this lands, and what tests it

The pure half belongs in `core/` and must stay reachable without React — that is what makes AC6
provable, because a shared operation the two paths both call is a thing a test can call directly.

- `core/mapping/targets.ts` — the per-kind target list, derived from `tabular.ts` and `record.ts`
- `core/mapping/draft.ts` — the draft mapping: assign, unassign, what remains
- `app/onboarding/mapping/` — `page.tsx` (protected, redirect to `SIGN_IN_ROUTE` like `app/upload/page.tsx`),
  `actions.ts` (`'use server'`, calls `readSampleHeadings`), and the client pairing component

`core/` imports nothing outward — `core/ports/boundary.test.ts` enforces it, and story 5.3 already
recorded one import direction worth watching in this area (`sample-headings.ts` reaching into
`core/ingestion/acceptance.ts`). Do not add a second.

**Test tooling, so nothing is reached for that is not installed.** Render tests are Vitest with
`// @vitest-environment jsdom` at the top of the file and `@testing-library/react`; `vitest.config.ts`
already includes `.tsx` and maps the `@/` alias. **`@testing-library/user-event` is not a dependency**
— existing interaction tests use `fireEvent` and `act` from `@testing-library/react`
(`app/findings/review-control.test.tsx` is the fullest example). Do not add a package for this;
`fireEvent.keyDown` is what AC5 needs anyway, because it is the keyboard path being asserted.

The gate is unchanged: `npm run lint`, `npm run build`, `npm test`, and
`npx --no-install tsc --noEmit` against the 8-error baseline. No `test:db` unless something reaches a
database — and by AC9 nothing here should.

### The accessibility floor, in the terms this project already uses

From EXPERIENCE.md and UX-DR20, the ones a pairing surface actually touches:

- **Full keyboard operation, no traps.** AC5.
- **Visible focus** per the focus-ring component, never removed, never relying on colour alone.
- **Colour is never the sole channel.** AC7 — this project's existing answer is tick + text label.
- **Live regions** for state a sighted user learns by watching. A pairing is exactly that.
- **Minimum target size** 24x24 CSS px (44x44 on phone). Drag handles are small by nature and this
  is where that rule bites.
- **Motion is functional only**, and `prefers-reduced-motion` is respected throughout — which for a
  drag surface means no ambient movement, not merely a shorter animation.
- **Row heights flex** for user text spacing (1.4.12); a pairing row must not be fixed-height.

UX-DR21's responsive rule applies too: below 48rem this reflows rather than scrolling sideways. A
two-column drag surface is the shape most likely to breach that.

### What this story does not do

No persistence, no suggestion, no preview, no ordering rule. 5.5 previews what the mapping would
produce, 5.6 suggests, 5.7 remembers, 5.8 enforces the order. **If a "remember this for next time"
or a pre-filled pairing appears here, a seam has been crossed early.**

In particular: do not let the draft mapping reach a repository "so 5.7 has less to do". Story 5.3's
`readSampleHeadings` takes no store and its test asserts that by calling it with nothing; the same
assertion belongs here (AC9), and it is what will make 5.7's addition visible in a diff.

### The trap this epic keeps setting

Fixtures are byte-exact and `.gitattributes` marks the sample directory `-text`. Any new sample is
produced by `scripts/build-samples.mjs` and never edited in place.

### The trap this *project* keeps setting

Read the review gate's test-value pass before writing assertions, not after. Story 4.8 shipped four
tests that were vacuous in the *fixture* direction — an amount containing the substring asserted,
two reads of an unchanged table, an assertion restating its neighbour — and mutating production code
caught none of them. A pairing surface is fertile ground for the same shape: an assertion that "a
pairing exists" passes against a surface that pairs everything to everything.

Story 5.3 recorded the sharper version of this, and it is worth carrying into a story whose whole
point is that two paths must agree: **a check written in a hurry to prove a property tends to assert
the nearest observable thing rather than the property.** Three guards in that story were themselves
weak. AC6 is the one at risk here — "both paths call the same function" is a claim a structural grep
appears to prove and does not. Observe the resulting state instead.

### References

- `_bmad-output/planning-artifacts/epics.md` — epic 5's story spine; *"Two places this epic will
  fight the code"*, which names this story's accessibility requirement explicitly
- `_bmad-output/planning-artifacts/ux-designs/ux-HOA-Treasurer-Assistant-2026-07-30/EXPERIENCE.md`
  — the Accessibility Floor section
- `_bmad-output/implementation-artifacts/5-3-the-headers-we-were-given.md` — the headings this maps
  from, and why the HTTP surface was left to this story
- `_bmad/custom/review-gate.md` — the three checks every diff reaching main gets

## Dev Agent Record

### Test Design

#### Task 1 — `targetsForKind`: the targets a kind actually has

**If it ran correctly, how would I know?** For a given kind it returns two lists, and those lists are
exactly the columns `readRows` would demand and accept for that kind. The observable signal is not
the lists themselves — it is that a file built from the required list is one `readRows` accepts, and
a file missing any one of them is one it refuses.

**How am I going to test it?** A pure function over two frozen constant lists; no seam needed. The
interesting test is the **cross-check**, not the example: build a header row from the returned
required list, hand it to `readRows` for that kind, assert it parses; drop one target, assert it
refuses. Two implementations that disagree cannot both pass, whatever either source file says. This
is the shape story 5.3 arrived at for the shared folding after a structural check turned out to be
satisfiable by a decorative import.

**Could this happen elsewhere?** `record.ts` already names this defect shape in its own header:
*"One statement, two readers... Splitting that into two lists is how the parser comes to produce a
value the validator then rejects."* That is this failure mode exactly, one seam over.

| # | Failure mode | Class |
| --- | --- | --- |
| 1a | `unit` offered for every kind, so a treasurer maps a column on an invoice and `readRows` silently ignores it — a pairing that reads as done and does nothing | GUARD — offered only for the kinds in `KINDS_WITH_UNIT_REFERENCE`, asserted per kind |
| 1b | A roll's `unit`/`cycle`/`year` offered as *optional*, so the mapping reports complete and `readRows` then refuses the file for missing headers | GUARD — required for `assessment_roll`, and the cross-check proves the refusal |
| 1c | `cycle`/`year` offered for kinds that never read them, so a treasurer maps two columns to nothing | GUARD — absent from both lists for every other kind |
| 1d | The lists hand-written here, correct today and drifting the day a column is added to `tabular.ts` | GUARD — derived from the exported constants, and the cross-check fails if they diverge |
| 1e | The retired `type` column offered as a target, which `readRows` refuses outright with `kind-is-not-a-column` — the mapping would break the whole upload | GUARD — asserted absent for every kind |
| 1f | An unrecognised kind answered with a default list rather than refused, so a typo produces a plausible-looking wizard | PROPAGATE — throws a named error; the surface never constructs one, so this is a contract for callers rather than a screen state |
| 1g | A target appearing in both lists, shown twice on screen and counted twice in "what remains" | GUARD — the two lists are asserted disjoint for every kind |

#### Task 2 - the draft mapping: `assign`, `unassign`, `completeness`

**If it ran correctly, how would I know?** Each returns a new draft, or a named refusal. The
observable signals are the pairing list and what `completeness` says remains - and the cross-check
is that a *complete* draft's targets, laid out as a header row, is one `readRows` accepts.

**How am I going to test it?** Pure functions over a value; the seam is that there is none. That is
AC9's assertion too: the module is called with a kind and a column count and nothing else, and if it
ever needs a repository the test that calls it with nothing goes red - which is what will make
story 5.7's addition visible in a diff rather than absorbed into it.

**Could this happen elsewhere?** The in-place-mutation mode (2e) is the one with siblings: any React
state built from this must be replaced rather than edited, or the screen renders the old value. That
is why every operation here returns a new draft instead of `void`.

| # | Failure mode | Class |
| --- | --- | --- |
| 2a | Keyed by heading text, so two `amount` columns are one target and a blank heading is unmappable - which throws away the whole of story 5.3 | GUARD - the source side is a position and there is no text parameter; two identically-named columns are paired to different targets and stay distinct |
| 2b | A column already paired to another target silently moved, changing a pairing at the top of the list while the treasurer works at the bottom | GUARD - refused, naming the target that already holds it |
| 2c | A position the file does not have accepted - `0`, negative, past the last column, or fractional - producing a mapping that reads a column that is not there | GUARD - refused; boundaries `0, 1, columns, columns+1` and a non-integer |
| 2d | A target this kind does not have accepted, so an invoice can be mapped to `unit` and the retired `type` is reachable after Task 1 refused to offer it | GUARD - refused, checked against `targetsForKind` rather than a second list |
| 2e | The draft mutated in place, so React renders the old value and nothing can be undone | GUARD - a new draft returned and the original asserted unchanged |
| 2f | Re-pairing a target appends rather than replaces, so one target holds two columns | GUARD - one pairing per target, asserted after a re-pair |
| 2g | Unassigning a target that holds nothing throws, so a double key-press breaks the screen | GUARD - a no-op returning an equal draft |
| 2h | Unassign takes a position rather than a target and removes the wrong pairing | GUARD - it takes a target, and a fixture with two pairings proves which one went |
| 2i | Unassign frees the target but leaves the column considered claimed, so it can never be paired again | GUARD - reverse-it: assign, unassign, assign the same column elsewhere |
| 2j | Only the first unfilled required target reported, so a treasurer fixes one and is shown the next - the exact inversion story 5.3 made against `readRows` | GUARD - all at once |
| 2k | Optional targets counted as missing, so a mapping can never be completed | GUARD - only required targets are reported |
| 2l | A draft assembled by hand carrying an out-of-range position and reported complete | OUT-OF-SCOPE - unconstructable through this module's API, which is where 2c guards. Nothing else constructs a draft; if anything ever does, `completeness` is where the check belongs |

### Completion Notes List

#### Task 1 - the targets a kind actually has

**Derived from the importer's constants, and the tests do not read the source to prove it.** They
build a header row out of what `targetsForKind` returns, hand it to `readRows`, and assert the
answer - for every kind, three ways: the required list alone parses, dropping any one member is
refused, and required plus optional still parses. Two implementations that disagree cannot both
pass. Story 5.3 arrived at that shape the expensive way, after a structural check written to prove
two modules shared a folding turned out to be satisfied by an import the module never used.

**17 of the 38 passed against the empty stub**, and every one of them was a negative - *never offers
`type`*, *offers `unit` exactly when the importer reads one* for the kinds that read none, *lists no
target twice*. An empty list satisfies all of those. Worth recording rather than counting as
coverage: the tests that carry this task are the four `readRows` cross-checks, and they were red.

**Sensitivity - four production mutations, four caught:** roll headers dropped from `required` (2
red), `unit` offered for every kind (3 red), the roll-only columns offered for every kind (4 red),
and an unknown kind answered instead of thrown (1 red).

**Fixture mutations - the class a code mutation cannot reach.** The refusal test asserts that
dropping a required column makes `readRows` refuse, which would pass just as well against a fixture
so malformed that *everything* is refused. Making `date` invalid turns **10** red, and an invalid
`cycle` turns 2 red, so the fixture is doing no work the code should be doing. Both restored and
re-run before moving on.

**`isDocumentKind` is checked against a parameter TypeScript already types as `DocumentKind`.** That
is deliberate, not belt-and-braces: the kind crosses a form submission before it reaches here, which
is the same argument `readRows` makes for its own `unknown-kind` refusal. The guard exists because
test 1f demanded it, not the other way about.

### Review Findings

#### Task 2 - the draft mapping

**Refused and reported are different things, and the split is deliberate.** An incomplete draft is a
valid draft - `completeness` answers what remains, all of it at once, and refuses nothing. What *is*
refused is a pairing that cannot exist: a column the file does not have, a target this kind does not
have, or a column another target already holds. Those are not states a mapping passes through on the
way to being finished.

**A claimed column is refused, never moved.** Silently re-pointing it would change a pairing the
treasurer made earlier, at the top of a list they are no longer looking at, with nothing to say it
happened. Re-pairing a *target* does replace, and frees whatever it held - otherwise that column is
claimed by nobody and pairable by nobody.

**Seven production mutations, seven caught**: re-pairing appends instead of replacing (2 red), a
claimed column silently moved (1), position 0 accepted (1), only the first missing target reported
(2), optional targets counted as missing (8), the not-a-target check dropped (3), and `unassign`
doing nothing (3).

**The fixture pass found a real defect, and it is the one this story predicted.** The first version
declared `const COLLIDING_COLUMNS = 5` and described the layout in a comment - *two `amount` columns,
one blank*. Changing that 5 to 10 left **all 29 tests green**. Every boundary case was derived from
the constant (`COLLIDING_COLUMNS + 1`), so it moved with it, and no test in the file had ever seen a
heading: the tests named for duplicate and blank columns were pairing bare positions, and the
collision existed only in prose.

That is exactly the shape the story flagged before implementation - *a check written in a hurry
asserts the nearest observable thing rather than the property* - and no production mutation could
have surfaced it, because the production code was right.

Fixed by making the fixture a real rectangle read through `readHeadings`, with the column count
derived from it, plus a `the fixture is the file it claims to be` block asserting the collision and
the blank are actually there. Three fixture mutations now caught: a sixth column added, the collision
removed, and the blank column given a name.

### File List

- `core/mapping/targets.ts` *(new)* - `targetsForKind`, derived from the importer's own constants
- `core/mapping/targets.test.ts` *(new)* - 38 cases, four of them cross-checks against `readRows`
- `core/mapping/draft.ts` *(new)* - the draft mapping: `assign`, `unassign`, `completeness`
- `core/mapping/draft.test.ts` *(new)* - 32 cases, including a cross-check that a complete mapping
  lays out a header row `readRows` accepts

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-21 | Task 2: a draft mapping keyed by position; the fixture pass found the collision fixture was prose, not data |
| 2026-08-21 | Task 1: the targets a kind has, derived from the importer and cross-checked against `readRows` |
| 2026-08-21 | Created from epic 5's story spine, with the position-not-text keying and the keyboard-as-mechanism shape recorded before implementation |
