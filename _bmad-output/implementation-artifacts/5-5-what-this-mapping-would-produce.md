---
Status: ready-for-dev
baseline_commit: 387f9e7
merge_request:
---

# Story 5.5: What this mapping would produce

## Story

As **a treasurer setting up an import**,
I want **to see my own rows parsed through the mapping I just built, and what each one would become**,
so that **I find out my date column is the posting date rather than the transaction date now, and not after a hundred payments have been written against the wrong month**.

## What this story is

5.3 answered *what columns does this file have*. 5.4 answered *which of ours does each correspond to*. This answers **"and what would that actually do?"** — before anything is stored.

It is the last cheap moment. Everything after this point writes.

## The decision to record before building

**The rows are gone.** `readSampleHeadings` decodes the file, reads the header row, and returns
headings and problems — the rectangle itself is discarded when the function returns. A preview needs
the *data* rows, and there are three ways to get them back:

1. **re-upload the file** — a treasurer who has already handed us the sample being asked for it again;
2. **carry the bytes** in wizard state and decode a second time — the whole file across a form
   boundary, for a screen that shows a handful of rows;
3. **carry a bounded slice of rows** from the read that already happened.

**Take (3), and record why the bound is not a detail.** `SampleState` crosses a server-action
boundary and is serialised to the client. A 25 MB sample is 25 MB of state — and the screen is going
to show perhaps twenty rows. The bound is what makes the approach viable *and* it is the thing
UX-DR24 then forces you to be honest about: having previewed 20 rows of 143, the screen may not say
"looks good".

**Whatever is chosen, nothing is persisted.** 5.7 is where a mapping is remembered; a preview that
wrote anything would be the seam crossed early, exactly as 5.4 said of its own draft.

## The trap in applying a mapping

`readRows` matches columns by **heading name**, folded. So "apply the mapping" means producing a
rectangle whose header row carries the *target* names.

If the mapped columns are renamed **in place** and the unmapped ones left alone, an unmapped column
whose heading happens to be `amount` now collides with the `amount` you mapped — and `readRows`
refuses the whole file with `duplicate-headers`. The treasurer sees their mapping rejected because of
a column they deliberately did not map.

**So the previewed rectangle is built from the mapped columns only**, in target order. An unmapped
column cannot collide with anything because it is not there. This is a decision, not an
implementation detail, and AC2 exists to pin it.

## Acceptance Criteria

1. **The preview parses through the importer, not beside it.** The same `readRows` the real import
   uses, on the declared kind. A second parser written for the preview would eventually disagree with
   the first, and the disagreement would surface as a treasurer being shown one thing and getting
   another — which is precisely the failure this screen exists to prevent.

2. **Only mapped columns reach the parse, in target order.** An unmapped column cannot collide with a
   target name and cannot refuse the file. Asserted with a fixture carrying an unmapped column named
   the same as a mapped target.

3. **When the importer would accept the file, each previewed row shows what it becomes** — field by
   field: the date, the description, the amount, and the unit where the kind carries one. Not a tick.
   A row reported as "fine" without showing its values proves nothing to someone checking whether
   their date column is the *right* date column, which is the entire purpose of this screen.

4. **When the importer would refuse the file, the preview says the file would be refused** — and
   names **every** offending row with its number and reason, not the first. It does **not** show
   parsed rows alongside them. One bad row fails the whole document (see Dev Notes), so a screen
   showing 17 successes and 3 problems would misstate the outcome in the direction that costs most:
   the treasurer concludes the bulk of their data is fine and proceeds.

5. **Counts, always, and never bare reassurance.** How many rows were previewed, out of how many the
   sample holds, and — on a refusal — how many rows are implicated. **UX-DR24 forbids reassurance
   without a count of what was checked**, and "your mapping looks right" over an unstated sample is
   exactly that. "Read 20 of 143 rows; all 20 would import" is a claim a treasurer can weigh.

6. **An incomplete mapping previews nothing, and says what is missing.** It reuses `completeness`
   rather than deciding again — 5.4 already owns which required targets remain, and a second opinion
   here is the two-lists defect one layer out.

7. **The preview is bounded, and the bound is on screen.** The treasurer is told they are seeing the
   first N rows; a bound nobody is told about is indistinguishable from a file that ended early.

8. **Nothing is stored and nothing is imported.** No repository, no `ingest`, no document row. The
   preview modules take no store, and a test asserts it by calling them with nothing.

## Tasks / Subtasks

- [x] **Task 1 — Apply a mapping to a rectangle.** Pure: rows plus a `DraftMapping` in, a rectangle
      headed with target names out, mapped columns only, in target order. (AC1, AC2)
- [ ] **Task 2 — Carry a bounded slice of rows from the sample read.** The bound is a named constant,
      and the total row count travels with it so AC5 can be honest. (AC7)
- [ ] **Task 3 — The preview result.** Compose apply + `readRows` into **either** the records a
      clean sample produces **or** the refusal and every offending row — never both, because
      `readRows` never returns both. Plus the counts. Takes no store. (AC1, AC3, AC4, AC5, AC8)
- [ ] **Task 4 — Refuse to preview an incomplete mapping.** Via `completeness`. (AC6)
- [ ] **Task 5 — The screen.** Rows and what they become, refusals in place, the counts and the
      bound. (AC3, AC4, AC5, AC7)

## Dev Notes

### What exists, and what it returns

- `core/mapping/draft.ts` — `DraftMapping { kind, columns, pairings: [{ target, position }] }`,
  positions **1-based**, plus `completeness(draft) -> { complete, missing }`.
- `core/mapping/targets.ts` — `targetsForKind(kind) -> { required, optional }`, derived from the
  importer's own constants.
- `core/extraction/tabular.ts` — `readRows(rows, kind)` returns
  `{ ok: true, records, rollRows }` or `{ ok: false, problems }`. Problem reasons include
  `invalid-row` (**carrying `row`, 1-based over data rows**), `duplicate-unit`, `missing-headers`,
  `duplicate-headers`, `no-rows`.
- `core/extraction/record.ts` — `ExtractionRecord` is `documentKind`, `vendorName`,
  `documentNumber`, `issuedOn`, `totalAmount`, `unitReference`, `currency`. **That is the vocabulary
  AC3 renders**; note `vendorName` holds the *description* column and `documentNumber` the
  *reference*, which is worth a label a treasurer recognises rather than the field name.
- `core/extraction/sample-headings.ts` — `readSampleHeadings(file, deps)`, and the place Task 2
  touches.
- `app/onboarding/mapping/` — `actions.ts` (`readSample`), `sample-state.ts`, `mapping-wizard.tsx`,
  `column-pairing.tsx`.

### One bad row fails the whole document, and the preview must say so

**This is the single most important thing to know before writing Task 3**, and it is easy to get
backwards. `readRows` accumulates row problems and then:

```ts
// One bad row fails the document. Storing the other 199 is precisely how "no
// partial or best-effort record is stored" gets violated in practice, and a
// ledger missing one line without saying so is worse than one that was
// refused outright.
if (problems.length > 0) return { ok: false, problems }

return { ok: true, records, rollRows }
```

So it returns records **or** problems, never both. There is no "17 good rows and 3 bad ones" result
to render, because that is not what the importer would do — it would refuse the file.

**A preview that showed 17 parsed rows and flagged 3 would therefore be lying**, and lying in the
direction that matters: the treasurer would believe most of their data is fine and press on. The
preview reports the importer's actual verdict — *this file would be refused, and here is every row
that is why* — or, for a file it would accept, what those rows become.

Row numbers in `invalid-row` and `duplicate-unit` are **1-based over data rows**, not over the file,
so a heading row does not shift them. Confirm against the code; this paragraph was wrong in the first
draft of this story and the correction is the reason these ACs read as they do.

### What this story does not do

No persistence (5.7), no suggestion (5.6), no ordering rule (5.8), and **no import**. The preview
must not become a "and now import it" button — 5.8 decides what order imports are allowed in, and a
preview that could import would route around it.

### The traps this project keeps setting

- **A test that names a behaviour and proves nothing.** Story 5.4 shipped three of these and a
  reviewer found all three: an assertion inside `within()` that queried descendants of a button whose
  text was its own; a drag test whose payload never reached the format the component read; and a
  bounds test that asserted which buttons rendered rather than the bound it claimed to check. For
  every assertion here, ask what would have to break for it to go red.
- **Fixture-vacuity.** Break the *input*, not just the code. 5.4's collision fixture was a comment
  and a count, and changing the count from 5 to 10 left all 29 tests green.
- **Scripted edits that do not apply.** This file's own repository has three instances in one
  session, two from CRLF line endings defeating a `\n` anchor. Read back every scripted edit: old
  text gone, new text present, match count as expected.

### References

- `_bmad-output/planning-artifacts/epics.md` — epic 5's spine; UX-DR24 at line 137
- `_bmad-output/implementation-artifacts/5-4-mapping-one-column-to-another.md` — the draft mapping,
  and its list of what it deferred to here
- `_bmad-output/implementation-artifacts/5-3-the-headers-we-were-given.md` — why a sample is not a
  document, which still holds

## Dev Agent Record

### Test Design

#### Task 1 - `applyMapping`: a rectangle headed with target names

**If it ran correctly, how would I know?** The returned rectangle, handed to `readRows` for the
draft's kind, parses into the records the sample's values imply. That is the cross-check and it is
the assertion that matters — a rectangle that merely *looks* right is what an off-by-one produces.

**How am I going to test it?** Pure function, rows in and rows out; no seam needed. The care goes
into the **fixture**: every column carries a value that identifies which column it came from, so a
shift of one is visible in the assertion rather than hidden behind plausible-looking data.

**Could this happen elsewhere?** The 1-based/0-based seam is the same one story 5.3 guarded when it
made `Heading.position` 1-based "because it is the number a treasurer counts to". Every consumer of
that number is a place to get it wrong once.

| # | Failure mode | Class |
| --- | --- | --- |
| 1a | Columns renamed *in place* with unmapped ones left alone, so an unmapped column headed `amount` collides with the mapped `amount` and `readRows` refuses the whole file with `duplicate-headers` - over a column the treasurer deliberately did not map | GUARD - build from mapped columns only; fixture carries exactly that collision |
| 1b | The 1-based position used as a 0-based index, so every column is read one to the left. **Silent**: the values are still plausible, and a date column reads as a reference | GUARD - each fixture cell names its own column, so a shift changes the assertion |
| 1c | A data row shorter than the header row - ragged CSV, trailing empties dropped by the exporter - yielding `undefined`, which stringifies into the cell as `"undefined"` and reaches the validator as a non-empty value | GUARD - absent cells become `''`, which `readRows` already treats as absent |
| 1d | The header row treated as data, or dropped twice so the first real row is lost | GUARD - row counts asserted, and the first data row's values asserted by name |
| 1e | A pairing whose position exceeds the actual rectangle width (the draft was built against a wider sample than the rows given) | GUARD - empty cell rather than a crash or `undefined` |
| 1f | An empty rectangle, or one with a header and no data rows | GUARD - a header-only rectangle out, not a crash |
| 1g | Output column order taken from pairing insertion order, so the preview's columns rearrange as the treasurer re-pairs, and the tests are order-dependent | GUARD - deterministic `targetsForKind` order, asserted against a draft built in a different order |

### Completion Notes List

#### Task 1 - applying a mapping

**Mapped columns only, in `targetsForKind` order.** Renaming in place would have let the fixture's
unmapped column headed `amount` collide with the mapped one and `readRows` would refuse the whole
file - the defect the story predicted, now covered by a fixture that carries exactly that collision.
Order comes from the importer rather than the pairings so the preview does not rearrange itself each
time a treasurer re-pairs.

**`?? ''`, never `undefined`.** A ragged row - trailing empties dropped by an exporter - would put
`undefined` in a cell, which stringifies to `"undefined"`: a non-empty value that parses as a
perfectly good vendor name. The same guard covers a draft built against a wider sample than the rows
it is applied to.

**Four production mutations, four caught**: the 1-based position used as a 0-based index (7 red), an
absent cell left `undefined` (2), order taken from the pairings (7), and the header row treated as
data (9).

**The fixture pass found a real gap, and it is the one this project keeps finding.** Making the
fixture rows anonymous (`'x'` in every column) turned 2 red - so the column-naming is load-bearing.
But **pairing the draft in target order left all 15 green**: the ordering test computes its
expectation from `targetsForKind` and compares, so with an in-order fixture a pairings-order
implementation gives the same answer and the test proves nothing. The fixture *was* out of order,
deliberately, and nothing asserted it - so tidying it would have silently disarmed the test, exactly
as story 5.4's collision fixture rotted into a comment. Now asserted, and re-running that mutation
turns it red.



### Review Findings

### File List

- `core/mapping/apply.ts` *(new)* - `applyMapping` and `mappedTargets`
- `core/mapping/apply.test.ts` *(new)* - 16 cases, including the `readRows` cross-check

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-22 | Task 1: a mapping applied to a rectangle, mapped columns only, cross-checked through `readRows` |
| 2026-08-22 | Created from epic 5's spine, with the rows-are-gone decision and the rename-collision trap recorded before implementation |
