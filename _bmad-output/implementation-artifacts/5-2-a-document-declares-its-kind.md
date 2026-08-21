---
Status: done
baseline_commit: ba2503d
merge_request:
---

# Story 5.2: A document declares its kind

## Story

As **a treasurer uploading a file**,
I want **to say what kind of document it is when I upload it**,
so that **a mapping can be "for deposits" — which it cannot be if the file decides row by row**.

## Why this is its own story

From the epic's three decisions, taken 2026-08-18:

> **Document kind becomes a property of the file, not the row.** Today `type` is an optional column
> read per row, defaulting to `statement`, and one file may mix kinds. The wizard's premise — *one
> example per document kind* — makes that untenable: a mapping cannot be "for deposits" if the file
> decides row by row. The upload declares its kind and the mapping is keyed on it. This is a change
> to `core/extraction/tabular.ts` and to the published upload contract, so it is a story of its own
> rather than a detail inside another.

**It is a contract change, and the contract is published.** `docs/upload-contract.md` is the
document a treasurer is pointed at, and `docs/upload-contract.test.ts` holds it to the code. Every
story from 5.3 onward keys its mapping on the kind, so a per-row `type` surviving into 5.4 would
make "the mapping for deposits" a phrase with no referent.

## Acceptance Criteria

1. **The kind arrives with the upload, not in the rows.** `readTable` and `readRows` take the
   document kind from their caller. A file whose kind is not declared cannot be read at all — there
   is no default standing in for a missing declaration, because a default *is* the per-row rule
   moved somewhere quieter.

2. **The `type` column is gone, and a file still carrying one is told so.** Removed from
   `OPTIONAL_HEADERS`. A file with a `type` header is **refused with a reason naming it**, not
   silently ignored: an ignored column is a treasurer believing their file said something it did
   not, which is the same "safe but silent" failure story 5.1c refused for `actorId`.

3. **One file is one kind, everywhere that used to ask a row.** The roll-header pre-check, the
   `unit` gating (`KINDS_WITH_UNIT_REFERENCE`) and the roll-row branch all read the declared kind.
   A test proves a file declared `assessment_roll` produces roll rows and one declared `statement`
   produces none, from **the same bytes**.

4. **The upload surface declares the kind.** `app/upload` sends it; a submission without one is
   refused before any file is read. The failure is a sentence a treasurer can act on, not a schema
   error.

5. **The published contract says all of this**, and `docs/upload-contract.test.ts` fails if the
   document and the code disagree. The "One file may mix kinds row by row" sentence and the `type`
   row in the optional-columns table are gone.

6. **The samples still work as samples.** `samples/assessment-roll.csv` and `samples/deposits.csv`
   carry a `type` column today. They are regenerated without it, `scripts/build-samples.mjs` no
   longer writes it, and `samples/samples.test.ts` passes — **see the trap in Dev Notes before
   touching them.**

## Tasks / Subtasks

- [x] **Task 1 — The kind becomes a parameter.** `readTable`/`readRows` require it; `kindOf` and
      `DEFAULT_DOCUMENT_KIND` are deleted rather than defaulted. Every internal read of the row's
      kind becomes the declared one. (AC1, AC3)
- [x] **Task 2 — Refuse a file that still carries `type`.** A named reason in `TABULAR_PROBLEMS`,
      not a silent drop. (AC2)
- [x] **Task 3 — Thread it through ingest and the upload surface.** `core/ingestion/ingest.ts`,
      `app/upload/actions.ts`, `app/upload/upload-state.ts`. A submission with no kind is refused
      before the file is read. (AC4)
- [x] **Task 4 — Regenerate the samples.** `scripts/build-samples.mjs` and the four sample files.
      Read the trap below first. (AC6)
- [x] **Task 5 — Rewrite the contract section.** `docs/upload-contract.md` and its test. (AC5)

## Dev Notes

### The trap: the samples are byte-exact fixtures

`.gitattributes` marks `samples/*.csv` as `-text` **on purpose**, with a comment explaining that a
repo-wide CRLF renormalisation would break them. `scripts/build-samples.mjs` writes them with CRLF
line endings because RFC 4180 specifies them, and `samples/samples.test.ts` compares byte for byte.

So regenerating them is not "edit the header row". Change the generator, re-run it, and let the test
compare — and do **not** let an editor, a script, or a `sed -i` rewrite the line endings on the way
past. This session has already had `sed -i` silently convert three CRLF files to LF; on these files
that would fail as *"the application rejects its own sample"*, which reads as a broken application
rather than a broken checkout.

The `.xls`, `.png` and `.pdf` samples are marked `binary` and are **not** affected by this story —
they go to the model extractor, which never sees a header row (AD-9).

### What reads the kind today

`core/extraction/tabular.ts`:

- `OPTIONAL_HEADERS` includes `'type'` (line ~32);
- `DEFAULT_DOCUMENT_KIND = 'statement'` (~35);
- `kindOf(row)` = `optional(row, 'type') ?? DEFAULT_DOCUMENT_KIND` (~145);
- the roll-header pre-check: `dataRows.some((row) => kindOf(row) === 'assessment_roll')`;
- per row: `documentKind = kindOf(row)`, which gates `unitReference` via
  `KINDS_WITH_UNIT_REFERENCE` and decides whether a `RollRow` is built.

Callers: `core/ingestion/ingest.ts` (`readTable` at ~349, `readRows` at ~356), and the tests
`core/ingestion/reading.test.ts`, `docs/upload-contract.test.ts`, `samples/samples.test.ts`.
`ingest` itself is called from `app/upload/actions.ts` and `app/upload/upload-state.ts`, and from
`adapters/db/deposit-ingestion.test.ts` and `adapters/db/roll-ingestion.test.ts`.

### Why a missing kind must refuse rather than default

AC1 forbids a default, and the reason is worth stating because "default to `statement`" is the
smaller diff. A default is the per-row rule relocated: the file still decides, by omission, and the
wizard still cannot say what a mapping is *for*. It also fails in the direction this project keeps
refusing — quietly, and in a way that looks like it worked.

The same argument produced 5.1c's `actorId` refusal and 5.1b's `associationId` refusal. This is the
third instance of one rule: **a caller that supplies nothing must be told, not served a guess.**

### What this story does not do

Mapping, headers, preview and suggestion are 5.3 through 5.6. This story only moves *where the kind
comes from*. If it starts growing a mapping concept, that is the seam being crossed too early.

### References

- `_bmad-output/planning-artifacts/epics.md` — epic 5's three decisions, and the story spine
- `core/extraction/tabular.ts` — the per-row kind, and everything that reads it
- `docs/upload-contract.md` §"Document kinds" and the optional-columns table
- `docs/upload-contract.test.ts` — holds the document to the code
- `.gitattributes` — why the CSV samples are `-text`
- `_bmad-output/implementation-artifacts/5-1c-the-actor-is-proved-not-relayed.md` — the
  refuse-rather-than-ignore precedent, with its reasoning

## Dev Agent Record

### Test Design

#### Failure modes of a declared kind

| # | Failure mode | Class |
| --- | --- | --- |
| 1a | A caller omits the kind and the module supplies `statement` - the per-row rule relocated, deciding by omission | GUARD - required by the type *and* refused at runtime, because the value crosses a form submission |
| 1b | An unrecognised kind flows through and every row reports `invalid-row`, naming the wrong thing | GUARD - `unknown-kind`, refused before the file is read |
| 1c | The declared kind is used for records while a row's `type` still wins somewhere | GUARD - `kindOf` and `DEFAULT_DOCUMENT_KIND` deleted, not shadowed |
| 2a | A file still carrying `type` has the column silently ignored | GUARD - `kind-is-not-a-column`, refused by name |
| 3a | The roll-header pre-check still scans rows, so a file's contents decide what is demanded of it | GUARD - reads the declaration |
| 3b | The parameter is accepted and ignored, so the same bytes always mean one thing | GUARD - **the decisive test**: one rectangle read as `assessment_roll` and as `statement`, yielding a roll row in one case and none in the other |
| 4a | The unit gate consults the row, so a declared deposit's `unit` column is dropped | GUARD |

### Completion Notes List

- **The decisive test is 3b**, and it is the one that cannot pass if the parameter is ignored: the
  same rectangle, read twice, meaning two different things. Everything else is detail.
- **No default, by argument rather than by omission.** `DEFAULT_DOCUMENT_KIND` is deleted; a
  submission that declares nothing is refused at the upload surface *and* in `readRows`. Defaulting
  to `statement` is the smaller diff and it is the per-row rule relocated - the file would still
  decide, by saying nothing.
- **`type` is refused, not dropped.** Third instance of the rule 5.1b and 5.1c established. A
  treasurer whose file says `type,deposit` and is served a statement has been told their column
  worked.
- **The kind sits on `IngestibleFile`, not on the `ingest` call.** The first attempt made it a
  parameter of the batch, which cascaded to ~84 call sites - and the size of the cascade was the
  signal. The story is called *a document declares its kind*; per file is more faithful, and the
  test factories absorb it. Corrected rather than pushed through.
- **Four mutations, four caught**: the declaration ignored (54 tests red), an unknown kind accepted,
  a retired `type` column tolerated, and the roll pre-check asking the rows again.

#### A test replaced, deliberately, rather than deleted

`'reads only the roll rows when a document mixes kinds'` existed to pin the per-row behaviour this
story abolishes. Deleting it to get a green suite would have dropped an assertion quietly - the one
thing this project's rules never allow. It is replaced by
`'refuses the mixed-kind file that used to be read row by row'`, plus a companion asserting every
row of a declared roll is a roll row with no per-row opt-in. The contract change is visible in the
suite, not only in the diff.

#### What the mechanical passes got wrong, and how each was caught

Three bulk edits went wrong in this story, and none were caught by "it compiled":

1. **A column-offset insertion driven by tsc's own output** put `documentKind` inside a `${...}`
   template literal and into a *deps* object rather than the file literal - taking two db test files
   from 11 errors to 120. One of those bad edits compiled cleanly. Restored from `HEAD` and redone
   through the `rollFile`/`depositFile` helpers, one place each.
2. **A script crashed mid-run while printing** a `U+10437` character, after writing the first file
   and before writing the second. Only checking the files afterward revealed the roll fixtures still
   had all seven `type` headers.
3. **The row-literal pass could not reach CSV *text* fixtures.** Five fixtures build their tables as
   strings; they still carried `type` and were refused. Found by the suite, one failure at a time,
   until a repo-wide grep for the header found the rest at once.

The pass that went right is the one that printed all 53 proposed removals for reading **before**
writing any of them. That is the difference: a bulk edit needs a step that would notice it went
wrong, and compiling is not that step.

#### Two fixture bugs the suite caught in my own work

- `quarterly` is not a billing cycle (`BILLING_CYCLES` is monthly, six_monthly, annual) - an
  existing test uses it precisely to prove refusal, and my new fixture used it as if valid.
- The invoice fixtures inside the roll suite were given `assessment_roll` by the mechanical pass;
  three of them assert invoice behaviour and had to declare `invoice`.

#### The samples, and the trap that did bite

`scripts/build-samples.mjs` regenerated all four tabular samples. **The trap flagged in Dev Notes
caught me one file earlier than expected**: the patch script wrote the *generator* with LF endings
when it was CRLF. Restored before running anything. The samples themselves came out right because
they were produced by the generator rather than edited.

`invoices.xlsx` and `deposit-slip.pdf` changed too, and that is expected rather than churn - both
are built from the tables that lost a column. `statement.xls` is untouched, because STATEMENT never
had a `type` column, which is a useful consistency signal. The generator is deterministic: two runs,
identical hash.

#### The worst mistake of this story: 21 tests destroyed, and the suite went green

`core/extraction/tabular.test.ts` **already existed** - 194 lines, 21 tests covering `readTable`
parsing, header normalisation, unknown-column tolerance, missing and duplicate headers, header-only
files, malformed rows, the closed set of refusal reasons, and CSV failure passthrough. A helper
script wrote the new declared-kind tests to that path with `io.open(path, "w")` and truncated all
of it.

**`git status` said ` M`, not `??`, and that was read straight past.** Then the suite went green,
because the deleted assertions no longer existed to fail. Nothing in the gate could see it: a test
that is gone does not fail.

Caught by **Argus**, as a `medium`, on the whole-story review - the one reviewer looking at the
change rather than at the result of running it.

Restored from `git show HEAD:`, threaded with the new parameter, and merged with the new block:
**42 cases now**, against the 11 that were passing while 21 were missing. Three of the originals
were genuinely obsolete - they pinned the per-row `type` - and those are *replaced* with assertions
that the behaviour is gone, not dropped.

The Write tool refuses to overwrite a file it has not read. A Python helper has no such guard, which
is the whole lesson and is now in memory.

**A second thing this exposed:** after the restore, `tsc` was 9 against a baseline of 8 - a threaded
argument too many in the restored helper - while the suite stayed green, because vitest strips types
without checking them. That is exactly what `{gate}` says `tsc --noEmit` is for, and it is the
second time in this story that a green suite meant less than it appeared to.

#### AC4 shipped broken, and every gate was green

`actions.ts` was changed to require `documentKind` and to refuse a submission without one. **The
form was never changed to send it.** `upload-form.tsx` had `name="documents"` and nothing else, so
every upload through the UI would have been refused with *"Choose what kind of document this is
before uploading."*

 was at baseline, lint was clean, the build succeeded and 3300 tests passed. Nothing could see
it, because **no test rendered the form and looked at what it submits** - the same shape as the
AC-audit's standing example: *an AC read by the adapter, carried by the port, and rendered by
nothing*. Found by reading the form while checking AC4, not by running anything.

Fixed with a `select` offering every kind in `DOCUMENT_KINDS`, labelled, **with nothing
pre-selected** - a default there would put the decision back where this story took it from, made by
omission, and a roll uploaded as a bank statement fails silently: the units simply never appear.

`app/upload/upload-form.test.tsx` *(new)* asserts the **wire**, not the appearance: the control's
`name` (what `formData.get` reads), the option values as a set against `DOCUMENT_KINDS`, and that
nothing is pre-selected. Three mutations prove it - removing the control (4 red), giving it a
default (1 red), renaming the field (3 red). The first of those is the bug that shipped.

#### The local CodeRabbit round - one finding, confirmed, and only partly fixed

`review_completed`, 22 of 22 diff files reviewed, one `major`: **`IngestibleFile.documentKind` is
per file, but the action stamps one declared kind onto every file in a `multiple` selection.**

Confirmed, and the asymmetry is what makes it a `major` rather than a nuisance:

- a **deposit** file declared `assessment_roll` is refused for having no `cycle` or `year` - loud,
  and harmless;
- a **roll** declared `deposit` is read happily, because `unit` is a column a deposit has. Its rows
  become payments instead of creating units. Silent, and wrong.

**Fixed only in part, deliberately.** CodeRabbit's stronger option - collect a kind per file - means
listing the chosen files and putting a control on each, which is a different upload surface and
beyond this story's ACs (AC4 says *the upload surface declares the kind*, singular). What is here
now is the affordance: the control carries an `aria-describedby` hint reading *"Every file you
choose is uploaded as this kind. Send a roll and a bank feed separately"*, asserted by a test and
mutation-proved, because an unasserted sentence is one a later tidy-up deletes.

**Residual risk, stated rather than closed:** a treasurer who mixes kinds in one selection and
ignores the hint can still have a roll read as deposits. **Raised as a follow-up** - per-file
declaration, or refusing a multi-file selection whose kind cannot be per-file - rather than pretended
away here.

#### Argus found a vacuous test this story created

Removing the retired `type` column from `ingest-quarantine.test.ts` fixed the **header** and missed
the **filler generator**, which kept emitting a leading `invoice,` - five columns against a
four-column header. Every filler row was then invalid, the document was refused as `invalid-row`,
and the test asserting `outcome === 'unreadable'` passed.

**It is named for the NUL guard past 8192 bytes, and it had stopped testing it.** Demonstrated
rather than asserted: with the broken filler *and* `isStorableName`'s NUL check deleted, all six
cases still passed. With the filler corrected, deleting that check turns the test red.

That is a test this story quietly hollowed out - the same class as the 21 destroyed above, and
invisible for the same reason: nothing fails when a test stops meaning what its name says.

### File List

- `core/extraction/tabular.ts` - the kind is a parameter; `kindOf`, `DEFAULT_DOCUMENT_KIND` and the
  `type` header gone; `unknown-kind` and `kind-is-not-a-column` added
- `core/extraction/tabular.test.ts` *(new)* - the declared-kind contract, 11 cases
- `core/extraction/tabular-roll.test.ts`, `core/extraction/tabular-deposit.test.ts`
- `core/ingestion/ingest.ts` - `IngestibleFile.documentKind`, threaded to the reader
- `core/ingestion/ingest.test.ts`, `reading.test.ts`, `ingest-quarantine.test.ts`
- `adapters/db/roll-ingestion.test.ts`, `adapters/db/deposit-ingestion.test.ts`
- `app/upload/actions.ts` - the submission declares the kind, refused before a byte is read
- `app/upload/upload-form.tsx` - the control that sends it, nothing pre-selected
- `app/upload/upload-form.test.tsx` *(new)* - what the form submits, 5 cases
- `docs/upload-contract.md` - one file is one kind; the `type` row and the mixing sentence gone
- `scripts/build-samples.mjs` and the four regenerated samples

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-21 | Created from epic 5's story spine, with the byte-exact sample fixtures flagged as the trap |
| 2026-08-21 | All five tasks: the kind is declared by the upload. `type` refused rather than ignored, samples regenerated, contract rewritten |
| 2026-08-21 | Argus found that a helper script had truncated an existing 21-test file; restored and merged, 42 cases |
| 2026-08-21 | AC4 was shipped broken - the action required a field the form never sent, with every gate green. Control and render test added |
| 2026-08-21 | CodeRabbit: one kind is stamped on every file of a multi-select batch. Affordance added; per-file declaration raised as a follow-up |
| 2026-08-21 | Argus: the quarantine filler still carried the retired column, making a NUL-guard test pass on malformed rows instead. Fixed and proved |
| 2026-08-21 | Status done, written in this commit rather than after the merge |
