---
Status: review
baseline_commit: 658fb22
merge_request: 80
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
- [x] **Task 3 — The sample-reading surface story 5.3 deferred.** The server action that calls
      `readSampleHeadings`, and the step that reaches it. 5.3 held this back deliberately so the
      action would land with the screen that calls it — see Dev Notes.
- [x] **Task 4 — Pairing by keyboard, as the mechanism.** A selectable pairing surface: choose a
      column, choose a target, pair; and the inverse. Live region, visible focus, text state. (AC5,
      AC7)
- [x] **Task 5 — Dragging, over the same operation.** A pointer accelerator that calls the same
      pairing function and nothing else. (AC6)
- [x] **Task 6 — Duplicates and blanks, on the screen where they matter.** (AC8)

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

#### Task 3 - `readSample`: the surface story 5.3 deferred

**A distinction to hold on to.** Story 5.3 established that *a sample has no document kind* - the
mapping is what the kind is for, and `readSampleHeadings` takes none. This step does ask for one, and
it is not the same question. The treasurer is declaring **which import they are setting up**, because
Task 1 cannot offer targets without knowing it. The file still declares nothing; the wizard does.

**If it ran correctly, how would I know?** The action returns the headings and problems
`readSampleHeadings` produced, under the kind the form declared, and nothing is written anywhere.

**How am I going to test it?** `auth` and the workbook adapter are mocked at the module boundary, as
`app/quarantine/actions.test.ts` does. The "nothing is stored" half is structural rather than
behavioural - a behavioural test cannot prove the *absence* of a write it never triggered, so the
test reads the module's imports, in the shape `test_no_data_credentials.py` uses for AD-3 and story
5.3 used for the shared folding.

| # | Failure mode | Class |
| --- | --- | --- |
| 3a | No session check, so the action is a public CSV parser - it is reachable without the page ever rendering, which is the argument `app/quarantine/actions.test.ts` already makes | GUARD - refused, and the refusal asserted before any read |
| 3b | No file chosen, or an empty file input, reaching the reader as `undefined` | GUARD - named refusal |
| 3c | `documentKind` absent or not a kind, so the mapping step renders with no targets or `targetsForKind` throws inside a render | GUARD - refused at the boundary, exactly as the upload action does |
| 3d | The four refusal reasons collapsed into one message, so an empty file is reported as a format we cannot read - which invites re-exporting a file that exported perfectly well. Story 5.3 kept them apart for precisely this | GUARD - four distinct messages, one test each |
| 3e | Bytes read before the declared size is checked, holding the submission in memory to decide it is too large to hold in memory | GUARD - size checked first, like `uploadDocuments` |
| 3f | The workbook decoder not passed, so every spreadsheet returns `no-reader` while CSVs work - a wizard that reads half the formats the importer accepts | GUARD - a workbook sample, decoder asserted reached |
| 3g | The sample ingested or stored, putting a file nobody meant to keep into the permanent record and the register a board reads | GUARD - structural: the module imports no repository, no store and not `ingest` |

#### Task 4 - the pairing surface, keyboard as the mechanism

**The shape, decided before the interaction.** A selectable list pairing, exactly as epics.md
prescribes: choose a column, then choose the target it feeds. Every control that changes the mapping
is a native `<button>`, so the *platform* operates it by keyboard and there is no second
implementation to keep in step. Task 5's drag calls the same `pair` function these buttons call.

**What "asserted by keyboard" honestly means here, because it is easy to fake.** On a native button
a keyboard activation *is* a click event - the browser synthesises it, and jsdom does not. So driving
`fireEvent.keyDown` would prove nothing unless the component grew its own `onKeyDown`, which is the
second implementation AC6 exists to forbid. The evidence is therefore two things together, and
neither alone: **(1)** every mapping control is a real `<button>` in the tab order - a `<div>` with
an `onClick` fails, and that is the actual defect this guards - and **(2)** the whole mapping can be
built and taken apart through exactly those controls. Written down rather than glossed, because a
test named "works by keyboard" that fires clicks at divs is precisely the reassuring-and-empty shape
this story keeps finding.

| # | Failure mode | Class |
| --- | --- | --- |
| 4a | A control is a `<div>` or `<span>` with an `onClick`, so a mouse works and the keyboard does not reach it at all | GUARD - every mapping control asserted to be a `<button>`; the test enumerates them rather than naming one |
| 4b | A control is in the DOM but out of the tab order (`tabindex="-1"`), which looks identical on screen | GUARD - asserted absent |
| 4c | Pairing succeeds but nothing is announced, so a screen-reader user has no idea whether the key press did anything | GUARD - a polite live region naming both sides, asserted after a pairing |
| 4d | Unpairing is announced with the same words as pairing, or not at all | GUARD - distinct text, asserted |
| 4e | Paired state carried by colour or position alone, so it is invisible to a screen reader and to anyone who cannot distinguish the tint | GUARD - the pairing is in the text of the row |
| 4f | What remains is shown as a count, or only the first missing target, repeating the defect `completeness` was built to avoid | GUARD - every missing required target named on screen |
| 4g | A refusal from `assign` swallowed, so pressing a claimed column does nothing and says nothing | GUARD - the refusal is rendered, naming the target that already holds the column |
| 4h | The selection left dangling after a pairing, so the next Enter pairs a column the treasurer thought they had finished with | GUARD - selection cleared, asserted by pairing twice in a row |
| 4i | The component keeps its own copy of the pairing rules rather than calling `assign`, so the screen and the domain drift | GUARD - the refusal cases only `assign` produces are asserted through the surface |
| 4j | Targets rendered from a list written in the component rather than from `targetsForKind`, so an invoice offers `unit` | GUARD - asserted per kind against `targetsForKind` |

#### Task 5 - dragging, over the same operation

**If it ran correctly, how would I know?** A drag from a column onto a field leaves the surface in
the state the two button presses leave it in - the *same* state, including the same refusal for a
column another field holds.

**How am I going to test it?** By observing that state, twice, and comparing. Not by reading the
source: *"both paths call the same function"* is a claim a structural grep appears to prove and does
not, which the story flagged before implementation and story 5.3 learned the expensive way when a
sharing check passed against an import the module never used.

| # | Failure mode | Class |
| --- | --- | --- |
| 5a | The drop handler sets state itself instead of calling `pair`, so the two paths drift - and the one that drifts silently is the keyboard one, because nobody demos it | GUARD - the same mapping built both ways and compared, refusals included |
| 5b | `onDragOver` does not call `preventDefault`, so the browser never fires `drop` and dragging silently does nothing - green in jsdom, dead in a browser | GUARD - `preventDefault` asserted called |
| 5c | The drag carries the heading *text* rather than the position, so the duplicate-column case works by keyboard and breaks under drag | GUARD - a drop from position 4 pairs position 4, not position 2 |
| 5d | A drop carrying nothing, or a value that is not a position, assigns `NaN` | GUARD - refused, and the draft unchanged |
| 5e | Dragging becomes the only way in, because the columns stop being buttons once they are draggable | GUARD - Task 4's whole suite still passes, and it is asserted here that removing the drag handlers leaves the surface operable |

#### Task 6 - duplicates and blanks, on the screen where they matter

**Both forms are used, and that is the point.** `HeadingProblem` carries the *normalised* heading
(`amount`) because that is what collides; the *written* forms (`Amount` at 2, `amount` at 4) are in
the headings. A report naming only the normalised form sends a treasurer looking for a column their
spreadsheet does not contain, which is the distinction story 5.3 built and this is where it is spent.

| # | Failure mode | Class |
| --- | --- | --- |
| 6a | The problems dropped, so a treasurer sees two identical rows and is never told which is which | GUARD - rendered, both positions named |
| 6b | The report names only the normalised heading, sending them to look for `amount` when their file says `Amount` | GUARD - the written form of each position asserted present |
| 6c | The blank column reported without its position, which is the only thing identifying it | GUARD - `Column 3` asserted |
| 6d | Problems rendered as a refusal that blocks the mapping, inverting story 5.3's report-rather-than-refuse | GUARD - the surface stays fully operable with problems present, asserted by building a mapping through them |
| 6e | The page never renders the surface, leaving an action nobody calls - the exact shape that shipped broken in story 5.2 | GUARD - the wizard's form is asserted to submit the fields the action reads |

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

#### Task 3 - the surface story 5.3 deferred

**The kind is asked for, and it is not the question 5.3 refused.** A sample still declares nothing -
`readSampleHeadings` takes no kind and still does not. The form asks which *import* is being set up,
because `targetsForKind` cannot offer a target list without knowing, and that answer is the
treasurer's rather than the file's. Carried forward beside the headings in `SampleState`.

**The four refusals stay four.** Story 5.3 kept `empty-file` apart from `unreadable-file` because
*"your file is empty"* and *"your file could not be read"* send a treasurer to different places, and
the second actively invites re-exporting a file that exported perfectly well. Collapsing them into
one sentence at the last step would have thrown that away, and the mutation that does so turns four
tests red.

**Nothing is stored, and it is checked structurally.** No behavioural test can prove the absence of a
write it never triggered, so one test reads the module's own import list and refuses any repository,
store or `ingest`. Non-empty asserted first - a filter over nothing reports success, which is how
5.3's `TABULAR_CONTENT_TYPES` round-trip passed against an empty list.

**Seven production mutations, seven caught**: the session guard dropped (2 red), the kind guard
dropped (2), the empty-file-input guard dropped (1), the size boundary moved from `>` to `>=` (1),
the size check removed (1), the four refusals collapsed (4), and the workbook decoder not passed (1).

**A test that failed for the wrong reason, caught by looking.** The at-the-limit boundary case built
a 25 MiB file with `padEnd`, which puts the filler *after* the final newline and makes a ragged row -
so the file was refused as unreadable and the test failed while the guard it was aimed at was
correct. Padded inside the last cell instead, with `expect(atLimit.size).toBe(MAX_DOCUMENT_BYTES)`
now asserting the fixture is the size it claims. Three fixture mutations caught, including making
that file one byte short.

#### Task 4 - the pairing surface

**Choose a column, then choose the field it feeds.** Every control that changes the mapping is a
native `<button>`, so the platform operates it by keyboard and there is no `onKeyDown` of our own to
drift out of step with the pointer path Task 5 adds.

**The keyboard claim is stated honestly rather than performed.** On a native button a keyboard
activation *is* a click event - the browser synthesises it and jsdom does not - so firing `keyDown`
would prove nothing unless the component grew its own handler, which is the second implementation
AC6 forbids. The evidence is two things together: every mapping control is a real `<button>` in the
tab order, and the whole mapping can be built and taken apart through exactly those controls. The
first is the one that matters, because `<div onClick>` is the actual defect and it looks identical
on screen.

**Nothing here decides what a valid pairing is.** `assign`, `unassign` and `completeness` do; this
renders their answers. The refusal for a column another field holds names that field, because "that
is not allowed" leaves a treasurer with nothing to act on.

**Nine production mutations, nine caught**: an unpair control turned into a `<div onClick>` (2 red),
the field buttons taken out of the tab order (1), the selection not cleared after a pairing (1), the
refusal swallowed (1), nothing announced (1), unpairing announced in the same words as pairing (1),
the field list written in the component instead of read from `targetsForKind` (1), what remains shown
as a count (1), and the paired column dropped from the row text (3).

**Fixture mutations: two caught, one benign and now pinned anyway.** Giving the blank column a
heading and removing the collision each turn the *fixture is the file it claims to be* block red.
Adding a sixth column did not, because nothing here is derived from the count - unlike Task 2, where
every boundary case was. Pinned with a length assertion regardless, since that is exactly the
reasoning that let Task 2's fixture rot unnoticed.

#### Task 5 - dragging, over the same operation

**The accelerator is eleven lines and sets no state of its own.** It reads a position off the
`DataTransfer` and calls `pair`. The position travels, not the heading text - columns 2 and 4 of the
fixture are both `amount`, and text would pair whichever a lookup found first, so the duplicate case
would work by keyboard and break under drag.

**AC6 is demonstrated rather than asserted.** The same mapping is built twice, once through the
buttons and once through drag events, and the rendered surface is compared - fields, live region,
refusal and what-remains. Refusals are compared too, because a drop handler that set state itself
would most likely just move the column and nothing on screen would say so. And with the **entire
drag layer deleted**, all 16 keyboard tests still pass: that is what "accelerator, not mechanism"
means, checked rather than claimed.

**Five production mutations, five caught**: the drop handler setting state instead of calling `pair`
(2 red), `preventDefault` dropped from drag-over (1), the payload carrying heading text (3), the
unusable-payload guard removed (2), and `draggable` removed (1).

#### Task 5 - the defect Argus found, and the second one behind it

**`disabled={selected === null}` on the field buttons.** A drag begins without a click, so nothing is
selected when it starts, so the drop target was disabled - and a disabled button receives no pointer
or drag events in Chromium, Firefox or Safari. **The accelerator was dead in every real browser and
passing here**, because jsdom dispatches synthetic events to disabled elements regardless. Which is
the same *passing in jsdom, dead in a browser* failure this task had already written a guard for,
one level up, reintroduced two lines away from that guard.

**And it cost something the review did not mention.** A disabled control is out of the tab order, so
a treasurer navigating by keyboard could not reach the field list at all until they had already
selected a column - they could not even discover what the importer needs. That is an AC5 failure, and
**Task 4's own tab-order test missed it** because it checked `tabindex="-1"` and nothing else. The
test asserted the nearest observable thing rather than the property, which is the third time this
story has caught itself doing that.

Fixed with `aria-disabled`, which advertises the state without removing the control; the `onClick`
guard is what actually refuses, and a test now pins that it survives. Both halves have regression
tests, and reverting either turns 2 red.

**Neither regression test could be behavioural**, and that is stated in the file rather than papered
over: jsdom cannot reproduce the event suppression, so a test that dragged and asserted success would
pass either way. The assertion is structural on purpose.

#### Task 6 - duplicates and blanks, and the step that reaches the action

**Both of story 5.3's forms are spent here.** The duplicate notice names *Column 2 (Amount)* and
*Column 4 (amount)* - the written forms, from the headings - while the problem itself is keyed on the
folded `amount`, which is what actually collides. A notice naming only the folded form sends a
treasurer looking for a column their spreadsheet has not got, and that is the distinction 5.3 built.

**Reported, never a refusal**, and asserted as such: a mapping is built *through* the duplicated and
blank columns while the notice is on screen. The inverse is asserted too - a clean file renders no
panel at all - so those tests are not passing against something permanently visible.

**The page and the form are Task 3's other half, and they landed here.** Task 3 built the action and
its state; the checkbox went on before the step that calls it existed, which is the wrong order and
worth recording rather than tidying away. `mapping-wizard.test.tsx` is the test story 5.2 needed and
did not have: it asserts the control *names*, because a name is what reaches `formData.get(...)`, and
`/onboarding/mapping` now appears in `next build`'s route list.

**Nine production mutations, nine caught**: the problems panel dropped (3 red), the duplicate
reported with the folded heading (1), the blank reported without its position (1), the sample control
renamed (2), a kind pre-selected (1), the pairing surface never rendered (1), and the page's session
guard dropped (2). Two fixture mutations caught: the collision removed, and the two written forms
made identical - the second is the one that would have made *"as written"* prove nothing.

### Review Findings

#### The AC audit (step 4c)

Every criterion, the test that covers it, and the mutation that turns that test red. No criterion is
listed on the strength of a name alone — a vacuous test satisfies *"I named one"* while staying green
when the behaviour is deleted, which is the defect this project keeps finding.

| AC | Test | Mutation that turns it red |
| --- | --- | --- |
| 1 — targets from the importer | `targets.test.ts` › *agrees with the importer* (3 cross-checks × 5 kinds) and *offers `unit` exactly when the importer reads one* | roll headers dropped from `required` — 2 red; `unit` offered for every kind — 3 red; roll-only columns offered to every kind — 4 red |
| 2 — a pairing names a position, not a heading | `draft.test.ts` › *keeps two identically-named columns apart*, *maps a column whose heading is blank*; `column-pairing.test.tsx` › the same two through the surface | the surface pairing by folded heading text instead of position — **2 red**; the drag payload carrying heading text — 3 red |
| 3 — one target per column, refused with both named | `draft.test.ts` › *refuses a column another target already holds, and names that target*; `column-pairing.test.tsx` › *shows the refusal `assign` gives…* | a claimed column silently moved — 1 red; the refusal swallowed at the surface — 1 red |
| 4 — incomplete is a state, not an error | `draft.test.ts` › *reports every unfilled required target at once*; `column-pairing.test.tsx` › *names every missing required field* | only the first missing target reported — 2 red; optional targets counted as missing — 8 red; what remains shown as a count — 1 red |
| 5 — built and taken apart by keyboard alone | `column-pairing.test.tsx` › *renders no clickable element that is not a button*, *takes no control out of the tab order*, *takes the whole mapping apart again* | an unpair control turned into a `<div onClick>` — 2 red; the field buttons given `tabIndex={-1}` — 1 red; `disabled` restored on the field buttons — 2 red |
| 6 — drag is an accelerator over the same operation | `drag.test.tsx` › *builds the same mapping either way*, *refuses a claimed column the same way either way* | the drop handler setting state instead of calling `pair` — 2 red. **And the converse**: deleting the entire drag layer leaves all 16 keyboard tests passing |
| 7 — announced, and never colour alone | `column-pairing.test.tsx` › *announces the pairing in a live region*, *announces an unpairing differently*, *pairs a column to a field and says so in the row* | nothing announced — 1 red; unpairing announced in the same words — 1 red; the paired column dropped from the row text — 3 red |
| 8 — duplicates and blanks where the mapping is built | `heading-problems.test.tsx` › *names both positions*, *names each column as the treasurer wrote it*, *is named by its position* | the problems panel dropped — 3 red; the duplicate reported with the folded heading — 1 red; the blank reported without its position — 1 red |
| 9 — nothing stored, nothing guessed | `actions.test.ts` › *imports no repository, no store and no ingestion*; `draft.test.ts` › *builds a whole mapping given a kind and a column count and nothing else* | a `document-repository-postgres` import added to the action — **1 red** |

Two of these had no directly-proven mutation when the audit began — AC2 at the surface and AC9 — and
both were run rather than argued. AC2's is the interesting one: pairing by *folded heading text*
instead of position is what a careless implementation would actually do, and it turns the two
duplicate-column tests red.

#### The local CodeRabbit round - six findings, six confirmed

`review_completed`, 17 of 17 diff files reviewed, coverage reconciled. Every one was real, and none
had been found by either of the two reviewers that ran before it.

**1 (critical) - the mapping outlived the file it was built against.** `useState`'s initialiser runs
once, and the wizard leaves its form on screen after a read - so a treasurer who reads a second
sample kept the first sample's draft. Pairings pointing at positions that now mean *different
columns*, bounded by the old file's column count, and the mapping still looked finished. Fixed with
a render-phase reset keyed on the kind and the headings; both halves of that key are mutation-proven
(dropping either turns 1 red).

**2 (major) - the `session.user === null` branch of the page guard had no test.** Deleting it left
every test green.

**3 (major) - a vacuous assertion, and an instructive one.**
`within(field('Reference')).queryByText(/required/)` looks *inside* the element, and the label is the
button's own text content - so it returned `null` whether or not `required` was there. It now reads
the button's text directly, and labelling every field "required" turns it red.

**4 (major) - the junk-payload test never reached the code it named.** It set `text/plain`, which the
handler does not read, so `getData` returned `''` and the case exercised `position < 1` while its
comment claimed to be testing `NaN`. The `Number.isInteger` guard had **no test at all**. Now set
under the exported `DRAG_FORMAT`. Writing the out-of-range case revealed the layering was different
from what I assumed - an integer past the last column is a real request `assign` refuses, so the
surface shows a refusal rather than ignoring it, and the test says that instead.

**5 (major) - the forbidden-import scan matched single-line imports only.** A multiline import - the
shape a formatter produces the moment that file gains one more name - was invisible to the guard, and
so were re-exports and dynamic `import()`. Widened, and a multiline `document-repository-postgres`
import now turns it red.

**6 (minor) - a refusal asserted without its reason.** *dropping any one required target makes
readRows refuse* checked only `ok === false`; a refusal for an unrelated reason would have satisfied
it. It now asserts the dropped header is the one named.

**Worth noting against `ocr`.** Its one `critical` claimed the whole drag suite was vacuous because
the payload format did not match - wrong, and refuted by mutation. CodeRabbit found the *real* version
of that concern: one specific test whose payload genuinely did not reach the format the component
reads. Same neighbourhood, and only one of them was true.

#### The defect the fix round introduced, and what caught it

**A source file committed as binary, with every gate green.** The reset signature was first written
with `U+0000`/`U+0001`/`U+0002` separators, through a shell heredoc that turned the escapes into the
**bytes themselves**. Git reclassified `column-pairing.tsx` as binary (`numstat` reported `-  -`),
ESLint could not read it - and all 134 tests passed, because a NUL is a perfectly valid character in
a template literal.

Nothing in the suite could have failed. `docs/no-control-characters.test.ts` scans markdown only,
which is an open action item from story 4.6 recording this exact defect in a `.ts` file; this is its
second appearance in TypeScript and the action item now says so. **Argus found it on the fix diff** -
the third moment of the review gate, reviewing a diff that existed only because of the second.

Replaced with `JSON.stringify`, which is unambiguous whatever a heading contains and, the point here,
printable.

#### The integration pass (step 6)

Scope `658fb22..HEAD`, **excluding `_bmad-output/**`** — the story document is this review's spec,
and reviewing it as a diff reviews the prose against itself.

Engine: **argus (MCP)**, one call. `audit_chain_ok: true`, context 17/17 files, selectivity 1,
reflection converged, confidence 1. **No findings.**

This is the pass that per-task reviews structurally cannot be — an interaction between Task 2's draft
and Task 4's surface is invisible to either alone. It is also not a re-read of what the earlier
reviews saw: the branch moved after 4b's Argus run, so this was the first look at the CodeRabbit
round's fixes *in the context of the whole story*, which is where a fix that breaks a sibling fix
becomes visible.

The Claude subagent layers were not run: the engine is `argus`, which satisfies the gate on its own
under `_bmad/custom/review-gate.md`. The acceptance dimension is covered by the AC audit above, with
a proven mutation per criterion, which is stronger evidence than a reading of the diff against the
prose.

### File List

- `core/mapping/targets.ts` *(new)* - `targetsForKind`, derived from the importer's own constants
- `core/mapping/targets.test.ts` *(new)* - 38 cases, four of them cross-checks against `readRows`
- `core/mapping/draft.ts` *(new)* - the draft mapping: `assign`, `unassign`, `completeness`
- `core/mapping/draft.test.ts` *(new)* - 32 cases, including a cross-check that a complete mapping
  lays out a header row `readRows` accepts
- `app/onboarding/mapping/actions.ts` *(new)* - `readSample`, the `'use server'` boundary
- `app/onboarding/mapping/actions.test.ts` *(new)* - 16 cases, one of them structural
- `app/onboarding/mapping/sample-state.ts` *(new)* - the state the step holds between submissions
- `app/onboarding/mapping/column-pairing.tsx` *(new)* - the pairing surface
- `app/onboarding/mapping/column-pairing.test.tsx` *(new)* - 17 cases
- `app/onboarding/mapping/drag.test.tsx` *(new)* - 9 cases, including the two paths compared
- `app/onboarding/mapping/mapping-wizard.tsx` *(new)* - the step: declare the kind, read a sample
- `app/onboarding/mapping/mapping-wizard.test.tsx` *(new)* - 8 cases, about the wire
- `app/onboarding/mapping/heading-problems.test.tsx` *(new)* - 6 cases
- `app/onboarding/mapping/page.tsx` *(new)* - the protected route
- `app/onboarding/mapping/page.test.tsx` *(new)* - 3 cases, the second lock

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-21 | Local CodeRabbit round: six findings, six confirmed, including a draft that outlived its sample; the fix round then wrote control bytes into a source file and Argus caught it |
| 2026-08-21 | Task 6: duplicates and blanks reported where the mapping is built, and the page that reaches the action |
| 2026-08-21 | Task 5: dragging as an accelerator; Argus found the drop target was `disabled`, so the drag path was dead in every real browser |
| 2026-08-21 | Task 4: the pairing surface, native buttons as the mechanism, announced and stated in text |
| 2026-08-21 | Task 3: the sample-reading server action, guarded and storing nothing |
| 2026-08-21 | Task 2: a draft mapping keyed by position; the fixture pass found the collision fixture was prose, not data |
| 2026-08-21 | Task 1: the targets a kind has, derived from the importer and cross-checked against `readRows` |
| 2026-08-21 | Created from epic 5's story spine, with the position-not-text keying and the keyboard-as-mechanism shape recorded before implementation |
