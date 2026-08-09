---
baseline_commit: 3281477
merge_request: 30
---

# Story 2.7: An uploaded assessment roll becomes units, holders and assessments

Status: review

> **Sequencing, and it is a real choice.** Story 2.6 documents the trap this story removes. If 2.7
> ships first, 2.6's "the thing a reader most needs told" section stops being a warning and becomes
> an instruction — *upload the roll first, then the deposits*. That is the better README and the
> better order. Running 2.6 first is defensible only if the documentation is wanted before the fix.

## Why this story exists

Epic 2 opens by saying what it is for: *"The association's assessment roll and its deposits become
typed records: units, who held them and when, what each owed for the year, and what actually
arrived."* AD-1 says the same thing as an invariant: *"All ledger-like data — deposits, **assessment
roll**, invoices — enters the system exclusively through user upload."*

**The deposits half is built. The roll half does not exist.**

`unit`, `unit_holder`, `unit_membership` and `assessment` have no ingestion path and no admin
surface. Verified by search: outside `migrations/`, the only statements inserting into any of the
four are in `*.test.ts` files. `assessment_roll` is an accepted `documentKind`, and uploading one
today writes `extraction` rows and creates no unit, no holder, no membership and no assessment.

The consequence is not subtle. **Upload a deposit to any real installation and every line is held
`unknown-unit`**, because there are no units for a reference to resolve against. Stories 2.1, 2.2,
2.3 and 2.5 are each individually correct and collectively produce nothing, and a treasurer watching
it happen sees a system that reads their bank feed perfectly and attributes none of it.

### This is the third time, and the shape is identical

| Story | What was built | What called it |
| --- | --- | --- |
| 2.4 | `payment`, `held_payment`, `resolveLine`, the repository, the queue | Nothing. Story 2.5 existed to fix it |
| 2.1 | `unit`, `unit_holder`, `unit_membership`, `UnitDirectory` | Only 2.5's `unitIdsFor`, and only for reading |
| 2.2 | `assessment`, `AssessmentDirectory` | **Nothing, still** |

Story 2.5 recorded the lesson: *"a set of green units does not add up to a working path, and only
something that exercises the whole path can say otherwise."* Task 4 below is that thing, and it is
the task to keep if anything is cut.

## Story

As a treasurer,
I want to upload the association's assessment roll and have it become the units, the people who hold
them and what each owes,
So that the deposits I upload afterwards are attributed instead of held.

## Acceptance Criteria

**AC1**
**Given** an assessment roll is uploaded
**When** ingestion completes
**Then** each row has created or updated a unit, the person holding it, their membership and that
unit's assessment for the year — without anyone invoking a second step

**AC2**
**Given** a roll has been uploaded, and then a deposit naming those units
**When** the deposit is ingested
**Then** its lines are stored as payments against those units rather than held `unknown-unit`. This
is the acceptance criterion the story exists for; the other four constrain how it is met

**AC3**
**Given** the same roll uploaded twice, or a corrected roll uploaded over an earlier one
**When** it is ingested the second time
**Then** no unit, holder, membership or assessment is duplicated, **and nothing already recorded
against a unit is destroyed** — a payment written before the re-upload is still there afterwards,
attributed to the same unit

**AC4**
**Given** a roll row that is defective — an unknown cycle, an unparseable amount, a missing unit
number
**When** the document is read
**Then** nothing from that document is written at all. A half-loaded roll is a set of units that
look complete and are not, and every arrears figure derived from it is wrong without saying so

**AC5**
**Given** the `UnitDirectory` and `AssessmentDirectory` ports
**When** this story is finished
**Then** both are still read-only, and their exhaustive port tests still pass unmodified. The
capability to create a unit lives in exactly one new place, and a deposit still cannot reach it

## Tasks / Subtasks

- [x] **Task 1 — The roll's shape, decided and parsed** (AC1, AC4)
  - [x] A roll row names four things — a unit, a person, a year's dues and a cadence. The current
        vocabulary carries one figure per row, so decide and record whether the roll gets its own
        record type or `ExtractionRecord` is widened.
        **Recommended: its own type.** Widening means four more nullable fields that are null on
        every other kind, four more `validate` rules refusing them on every other kind, four more
        columns on `extraction`, and four more fields on the provider schema — for a shape that is
        not "a figure read off a document" at all. `unitReference` already cost one of each.
  - [x] Extend the tabular contract with the columns a roll needs, following exactly the precedent
        `unit` set in story 2.5: **optional headers, read only when the row's kind calls for them.**
        A stray `cycle` column on an invoice export must be ignored, not turned into a refusal of the
        whole upload.
  - [x] `validate.ts` currently refuses `unitReference` on every kind but `deposit`. A roll row needs
        the unit too, so that rule widens to admit `assessment_roll`. **No migration is needed for
        this**: migration 014 added no database-level tie between `unit_reference` and
        `document_kind` — the rule lives only in the validator. Update 014's column comment, which
        says "Null for every other document kind" and would become false.
  - [x] `billing_cycle` is `monthly`, `six_monthly`, `annual`, lower-case, and migration 013's check
        constraint enforces it. Reuse `BILLING_CYCLES` from `core/assessment/billing-cycle.ts`;
        a hand-written list here is the third statement of it.
  - [x] One defective row fails the document, matching `readTable`'s existing rule. Say it in the
        problem set rather than relying on the reader to infer it.

- [x] **Task 2 — The one port that may create a unit** (AC1, AC3, AC5)
  - [x] A **new** port with a write. `UnitDirectory` and `AssessmentDirectory` both argue in their
        docblocks that the absence of a write method *is* the design, and both have exhaustive tests
        that fail when a method is added. Neither may gain one. The new port is the single owner of
        this capability, in the manner AD-14 fixes single ownership for vendor identity.
  - [x] **Read the hazard below before designing `replace`.** AD-13 says a re-uploaded roll replaces
        its rows. Taken literally against this schema, that destroys the ledger — see *The AD-13
        collision* in Dev Notes. The grain of "replace" differs per table and the story is not done
        until each is decided and written down.
  - [x] Decide holder identity on re-upload and record the reasoning. Migration 012 refused a unique
        constraint on `unit_holder.full_name` in as many words — *"an association's second `John
        Smith` must be recordable; folding the two together would silently hand the first one the
        second one's unit"*. So a roll cannot match a holder by name, and re-uploading it must not
        create a second holder row every time. The constraints are: nothing references
        `unit_holder`, and `unit_membership` is referenced by nothing at all. Replacing the
        memberships and holders this **document** produced is the shape that fits; whatever is
        chosen, the argument goes in the adapter beside the code.
  - [x] One statement per table for the whole document, not one per row. `payment-repository-postgres.ts`
        and `extraction-repository-postgres.ts` both loop per record and both carry an open action
        item for it; a roll is the same shape and there is no reason to add a third.
  - [x] Writer connection, AD-4. One transaction: a roll that creates units and then fails before the
        assessments is a roll that has to be diagnosed by hand.

- [x] **Task 3 — Wire it into ingestion** (AC1, AC4)
  - [x] One shared module called from **both** call sites, exactly as `core/ingestion/record-payments.ts`
        is called from `ingest.ts` and `extract-document.ts`. Story 2.5's Dev Notes set the rule:
        both producers, or say which and why — and its scope correction is the reason that rule
        exists.
  - [x] Which means the provider schema gains the roll's fields too. Story 2.5 found that structured
        output answers the schema it is given, so a field absent from the schema is null on every
        document a provider ever read — which is how 2.4's `unitReference` was dead in practice while
        the record and the validator both carried it. Bound the new fields from the shared constants,
        never a hand-written number.
  - [x] Called **before** `extractions.replace` settles the document, for the reason `recordPayments`
        and `holdUnknownVendors` are: a settled document is never re-read, so a roll missing after it
        is silent and permanent, while one missing before it is healed by the next poll. Assert the
        order by consequence — make the extraction write fail and show the roll write already
        happened — because a comment saying "call this first" constrains nothing.
  - [x] **Only for `assessment_roll` documents**, and assert it. An invoice must write nothing to any
        of the four tables. A change that quietly wrote an empty roll for every document would pass
        every other test in this story.

- [x] **Task 4 — Prove the trap is gone** (AC2, AC3)
  - [x] **The test this story is for:** ingest a roll through the real entry point, then ingest a
        deposit naming those units through the same entry point, then read `payment` and
        `held_payment` directly. Before this story that deposit holds every line. After it, the lines
        resolve. `adapters/db/deposit-ingestion.test.ts` is the pattern and the place to start.
  - [x] Re-ingest the roll and assert AC3's destructive half: a payment written between the two roll
        uploads is **still there**, still against the same unit. This is the assertion that catches
        the `on delete cascade` a developer will otherwise reach for when the FK refuses a delete.
  - [x] A roll where one row is defective, asserting nothing at all was written — the case where a
        partial write would be least visible.
  - [x] A roll naming a unit that already exists in a different spelling (`4b` against a recorded
        `4B`), asserting one unit and not two. Migration 011's unique index on `normalised_number` is
        what decides this, and the test should fail if the adapter matches on the raw column.
  - [x] Mutation-check the wiring, as 2.5 did: remove the call from each call site and record how
        many tests fail. A number near zero means the tests prove the parts and not the path.

## Dev Notes

### The AD-13 collision — read this before writing `replace`

Epic 2's header says AD-13 requires *"re-uploading a roll replaces its rows rather than appending"*.
The obvious reading — delete this document's rows, insert the new ones — **destroys the ledger**, and
the schema will let it happen in one of two ways depending on which fix is reached for.

Three tables reference `unit (id)` and **none of them declare an `on delete` action**, so all three
are `RESTRICT`:

| Reference | Migration | On delete |
| --- | --- | --- |
| `unit_membership.unit_id` | 012 | RESTRICT (default) |
| `assessment.unit_id` | 013 | RESTRICT (default) |
| `payment.unit_id` | 015 | RESTRICT (default) |

So deleting a unit on re-upload fails the moment that unit has a payment. The failure is loud, which
is the good outcome. **The dangerous outcome is the fix:** adding `on delete cascade` to
`payment.unit_id` makes the delete succeed and silently removes every payment ever recorded against
that unit. In a fiduciary product, re-uploading a corrected roll would erase the ledger it exists to
check.

The shape that works, stated as a starting position rather than a mandate:

- **Units are upserted on `normalised_number`, never deleted.** Migration 011's unique index is the
  natural conflict target. A unit dropped from a corrected roll stays; removing a unit that holds
  payments is a decision a human makes, not a side effect of an upload.
- **Assessments are replaced at the grain the schema already names** —
  `assessment_one_per_unit_year unique (unit_id, assessment_year)`. Upsert on that pair.
- **Memberships and holders** are the genuinely open part; see Task 2. Note
  `unit_membership_no_overlap` — `exclude using gist (unit_id with =, held_during with &&)` — will
  reject a second identical membership with `23P01` rather than duplicating it, so a naive re-upload
  fails loudly rather than corrupting. That is a floor, not a design.

Whatever is decided, **AC3's payment-survives-re-upload test is the thing that proves it**, and it
is worth writing before the adapter rather than after.

### Order within one upload is real and will be met

`ingest` processes a batch sequentially in the order given. A treasurer who selects the deposits and
the roll in one submission, deposits first, gets every deposit line held — the units do not exist
yet. Re-uploading the deposits afterwards fixes it, because `PaymentRepository.replace` is
set-replacement.

This is ordinary and does not need a scheduler. It does need saying, in the outcome the surface
renders and in story 2.6's README. If it can be made better cheaply — reading the roll files in a
batch before the others — record whether that was done and why.

### What the roll has to carry

Derived from the schema; confirm against it rather than trusting this table.

| Roll row names | Lands in | Constraint that decides it |
| --- | --- | --- |
| Unit number | `unit.unit_number` | ≤ 64 chars, non-blank; identity is `unit_normalised_number()` |
| Holder name | `unit_holder.full_name` | ≤ 200 chars, non-blank; **deliberately not unique** |
| Held from / until | `unit_membership.held_during` | Half-open `daterange`; a bounded start is required; overlaps per unit are rejected by the database |
| Annual amount | `assessment.annual_amount` | `numeric(14,2)`, `> 0`, the **annual** figure and never the instalment |
| Cycle | `assessment.billing_cycle` | `monthly`, `six_monthly`, `annual`, lower-case |
| Year | `assessment.assessment_year` | 1900–2200; one row per unit per year |

Two of these have no constraint that can catch a mistake and are called out in the migrations for
that reason: `annual_amount` accepts an instalment as readily as an annual figure, and
`numeric(14,2)` **rounds** a third decimal rather than rejecting it. Both belong in the roll
reader's refusals if they are to be caught at all.

### Learnings that apply directly

1. **A green unit test proves a part works.** Only a test that runs the path proves the parts are
   connected. This is the third story in this epic written because of it.
2. **A test that counts rather than checks.** Row counts pass against an insert that wrote nulls into
   every column — assert what is in the rows, especially `annual_amount` and `billing_cycle`.
3. **Choose values that discriminate.** A roll of one unit owing 1200 monthly cannot tell an annual
   figure from an instalment; 1200 and 100 are both plausible. Use amounts where the two differ
   visibly and a cycle that is not the default.
4. **`toThrow(SomeType)` cannot tell a contract from a crash.** Assert the message — particularly on
   the `23P01` overlap and the FK refusal, where a crash and a contract look identical.
5. **A mutation that removes two things at once cannot show that either one matters.** Migration
   012's own comment records this being learned here.
6. **Read the file count in the test summary.** The suite has silently under-run twice in this
   project, reporting green with files uncollected.

### Testing standards

- Gate: `npm run lint`, `npm run build`, `npm test`, `npm run test:db`, and
  `npx --no-install tsc --noEmit` against its **baseline of 8**. Quote the numbers from the run, not
  from memory.
- Per-file `RUN_PREFIX` on anything writing to a shared table. This story writes to four of them and
  they are the tables every other epic-2 database test seeds into.
- The end-to-end test needs the real database — `unit_normalised_number()` and the exclusion
  constraint are the things under test, and a fake pool cannot answer for either.

### If this has to be cut

Split at the money, not at the plumbing. **Units, holders and memberships remove the trap**; the
`assessment` half makes stories 2.2 and 2.3 reachable and can become 2.8. The parser, the port, the
adapter, the wiring and Task 4 are shared by both halves, so splitting costs a second pass over every
file — take it only if the story is genuinely too large in flight, not up front.

### References

- `_bmad-output/implementation-artifacts/2-5-deposits-become-payments-on-upload.md` — the same defect
  one story earlier, and the source of the both-producers rule and the end-to-end test pattern.
- `core/ingestion/record-payments.ts` — the module this one is a sibling of; call it from the same
  two places in the same order.
- `adapters/db/deposit-ingestion.test.ts` — the end-to-end shape Task 4 extends.
- `migrations/011_unit.sql`, `012_unit_membership.sql`, `013_assessment.sql`, `015_payment.sql` — the
  constraints that decide every question in Task 2.
- `core/ports/unit-directory.ts`, `core/ports/assessment-directory.ts` — the two docblocks arguing
  their own read-only-ness, which AC5 protects.

## Dev Agent Record

### Agent Model Used

### Test Design

#### The record-shape decision, settled before any test was written

Task 1 asked whether the roll gets its own type or `ExtractionRecord` is widened, and recommended
its own. **Re-derived from the source rather than taken on trust, and the recommendation survives —
but for a different and much stronger reason than the one the story gave.**

The story's argument was arithmetic: four new nullable fields. That was wrong. A roll row needs six
values and `ExtractionRecord` already carries four of them plausibly — the unit in `unitReference`,
the amount in `totalAmount`, the date in `issuedOn`, and the holder's name in `vendorName`. Only
`billingCycle` and `assessmentYear` are genuinely new. On the story's own reasoning, widening would
have been the cheaper option.

**The real argument is `holdUnknownVendors`.** It quarantines every distinct non-null `vendorName` a
reading produces, from both call sites, before anything is stored. Route a holder's name through that
field and **every unit holder on the roll is quarantined as an unknown vendor** — a treasurer
uploading a 40-unit roll gets 40 questions asking whether "Jane Smith" is a vendor they recognise.
Nothing in the type system would have caught it; the field is a `string | null` either way.

So the roll gets its own row type, and the holder's name never touches `vendorName`.

#### The scope decision: tabular only, and why — stated rather than discovered

Story 2.5's rule is "both producers, or say which and why". This story wires **the tabular path
only**, and the reason is structural rather than a matter of effort.

`core/ports/extractor.ts` states a safety property about its own return type: `ExtractionRecord[]`
has "no free-form field, so there is nowhere for a poisoned document to smuggle a paragraph of
instructions through a value". A roll row carries a **person's name** — a second free-text field, on
the untrusted side of AD-8's boundary, reaching a table whose column is 200 characters. Widening the
provider's result to carry it is an AD-8 change and wants a decision record, not a story task.

The asymmetry also runs the opposite way to 2.5's. There, the unwired path (CSV) was the one the
pilot actually uploads, which is what made the gap fatal. Here the wired path is that one: an
assessment roll is a spreadsheet the association already maintains, and a scanned roll is the unusual
case. **The limitation is real and is recorded rather than hidden**: a scanned roll stores extraction
rows and creates no units, exactly as today. Story 2.6's README must say so, and it is listed in
Completion Notes as a follow-up.

#### Behaviour 1 — `readRows` also yields the roll rows

1. *If it ran correctly, how would I know?* For each row whose `type` is `assessment_roll`, a
   `RollRow` carrying unit, holder, held-from date, annual amount as a decimal string, cycle and
   year. Rows of every other kind produce none.
2. *How do I test it?* Pure function over a rectangle of strings — no seams, no fakes. Cross-check by
   round-tripping through `serialiseCsv` → `parseCsv` → `readRows`.
3. *What else can go wrong?* Below.
4. *Siblings?* `readRows` itself, and `tabular-deposit.test.ts` is the test this one is modelled on.

**The header contract**, following the precedent `unit` set in 2.5 — optional headers, read only when
the row's kind calls for them:

| Column | Roll meaning |
| --- | --- |
| `date` | the day the membership begins |
| `description` | the holder's name |
| `amount` | the **annual** assessment, never the instalment |
| `unit` | the unit number |
| `type` | `assessment_roll` |
| `cycle` *(new)* | `monthly`, `six_monthly`, `annual` |
| `year` *(new)* | the assessment year |

**`year` is explicit and is deliberately not derived from `date`.** Deriving it looks free and is
wrong: `date` is when the *membership* started, so a member who bought in 2019 and appears on the
2027 roll would derive an `assessment_year` of 2019. The two are different facts that a roll row
happens to carry together.

| # | Failure mode | Class |
| --- | --- | --- |
| 1 | No `cycle`/`year` column at all on a file containing roll rows | GUARD: missing-headers, naming both |
| 2 | Blank `cycle` or `year` on a roll row | GUARD: invalid-row |
| 3 | `Monthly` — capitalised | GUARD: case-folded, matching `validate`'s treatment of a currency code. A closed vocabulary's case cannot change its meaning |
| 4 | `quarterly` — a cycle migration 013 does not admit | GUARD: invalid-row |
| 5 | `year` not an integer, or outside 1900–2200 | GUARD: invalid-row, matching `assessment_year_plausible` |
| 6 | `amount` zero or negative | GUARD: `AMOUNT_PATTERN` admits both and `assessment_amount_positive` refuses them. Caught here, or the whole transaction aborts |
| 7 | `amount` with a symbol, separator, or third decimal | GUARD: `AMOUNT_PATTERN` already refuses; asserted so the roll path is known to apply it |
| 8 | Blank `unit` or blank `description` on a roll row | GUARD: invalid-row — a roll row that names no unit or nobody is defective, not partial |
| 9 | `unit` over 64, holder over 200 | GUARD: `unit_number_length`, `unit_holder_name_length` |
| 10 | A NUL in either | GUARD: `text` cannot store one; the same shape as `unstorableUnitReference` |
| 11 | Malformed or impossible `date` | GUARD: invalid-row |
| 12 | Invoice rows and roll rows in one file | GUARD: only roll rows yield roll rows; the others are untouched |
| 13 | No roll rows at all — an ordinary invoice CSV | GUARD: an empty list and **not** a problem. Every upload goes through this reader |
| 14 | The same unit twice in one roll | GUARD: refuse. Two rows for one unit are two answers about who holds it; `assessment_one_per_unit_year` would abort the transaction anyway. Detected on the **folded** number, so `4B` and `4b` collide as migration 011 makes them collide |
| 15 | A defective roll row among good ones | GUARD: the whole document fails, matching `readRows`' existing rule |

No PROPAGATE modes: the function is pure and returns its refusals.

**Out of scope, recorded:** the provider path (above), and closing a superseded membership — that is
temporal logic against the exclusion constraint and belongs to Task 2, where the database is.

#### Behaviour 2 — `RollRepository.apply(documentId, rows)`

1. *If it ran correctly, how would I know?* Rows in `unit`, `unit_holder`, `unit_membership` and
   `assessment`, and a deposit naming those units afterwards resolving instead of holding.
2. *How do I test it?* The real database. `unit_normalised_number()`, the unique index and the
   exclusion constraint are the things under test, and a fake pool can answer for none of them. A
   `pool` seam for the query-count assertions, as `createPaymentRepository` established.
3. *What else can go wrong?* Below.
4. *Siblings?* `payment-repository-postgres.ts` — same writer role, same one-transaction shape, and
   the same open action item about looping per row.

**Called `apply`, deliberately not `replace`.** The grain differs per table and that difference *is*
the hazard the story was written around, so a name promising uniform replacement would be a lie in
the signature:

| Table | Grain | Why that one |
| --- | --- | --- |
| `unit` | upserted on `normalised_number`, **never deleted** | three tables reference it with no `on delete` action. Deleting fails loudly on a unit with a payment — and the `on delete cascade` reached for to "fix" that would erase the ledger |
| `unit_holder` | owned by the document; deleted and re-inserted | migration 012 refused a unique constraint on `full_name` in as many words, so a holder cannot be matched by name and cannot be upserted |
| `unit_membership` | owned by the document; a *prior* document's tenure is closed rather than replaced | the exclusion constraint refuses overlaps, so succession has to close |
| `assessment` | upserted on `(unit_id, assessment_year)` | `assessment_one_per_unit_year` already names the grain |

**Ownership needs a column, so this task carries migration 019.** `unit_membership` and
`unit_holder` gain a nullable `document_id` cascading from `document`. Without it there is no way to
make a re-upload idempotent: the rows a document wrote cannot be told from the rows another document
wrote, and "delete what I wrote, write it again" is the only formulation that is exactly idempotent
without matching holders by name — the thing migration 012 forbids.

**The membership range is computed, not assumed.** For a row claiming a unit from `heldFrom`:

- any *other* document's still-open tenure starting **before** `heldFrom` is closed at `heldFrom`;
- the new tenure runs `[heldFrom, nextStart)` where `nextStart` is the earliest other tenure
  beginning after it, or unbounded if there is none.

That single rule satisfies the exclusion constraint in every ordering, including a roll uploaded out
of order — a 2026 roll landing after a 2027 one produces `[2026-01-01, 2027-01-01)` rather than an
overlap.

| # | Failure mode | Class |
| --- | --- | --- |
| 1 | An empty row list | GUARD: refuse, as `PaymentRepository.replace` does. Obeying it would delete the memberships this document wrote and call the deletion a roll |
| 2 | A unit already recorded in another spelling (`4b` vs `4B`) | GUARD: one unit, and the roll's spelling wins — migration 011 stores what the treasurer typed |
| 3 | A prior document's open tenure starting earlier | GUARD: closed at the new start, not deleted. Story 2.1's AC says a change of hands closes rather than overwrites |
| 4 | A prior document's tenure starting on **exactly** the same day | GUARD: closing it would make `[d,d)` — an empty range, which `unit_membership_has_a_start` refuses because every empty `daterange` has a null lower bound. Refuse the document with a named error; two rolls disagreeing about one unit from one date is a question for a human |
| 5 | A prior tenure starting **later** | GUARD: the new tenure ends where that one begins |
| 6 | The same roll applied twice | GUARD: this document's own rows are deleted first, so the second apply writes the same set. AD-13 |
| 7 | A payment already recorded against a unit in the roll | GUARD: it must still be there afterwards, against the same unit. **This is AC3's destructive half and the assertion that catches an `on delete cascade`** |
| 8 | A failure midway | GUARD: one transaction, rolled back; a poisoned client destroyed rather than returned to the pool |
| 9 | One roll row per statement | GUARD: assert the query count, as story 2.5 did for `unitIdsFor`. The per-row loop is already an open action item against two adapters and there is no reason to add a third |
| 10 | Two roll documents applied concurrently naming one unit | PROPAGATE: the unique index and the exclusion constraint refuse it, loudly. Recorded rather than serialised — a roll is uploaded by one treasurer at a time |
| 11 | A NUL or an over-long name reaching the adapter | OUT-OF-SCOPE: `readRollRow` is the boundary and refuses both before a row exists |
| 12 | A third decimal on the amount | OUT-OF-SCOPE: `numeric(14,2)` rounds rather than errors, which is why `AMOUNT_PATTERN` refuses it in the reader |

### Debug Log References

### Review Findings

#### Integration pass — Argus over `main...HEAD`

One low finding: `cell()` indexes `row[headers.indexOf(header)]`, which is `row[-1]` for an absent
header. **Disagree** — pre-existing and unchanged by this branch (verified: it appears in the diff
only as context), and correct as written: the return type is `string | undefined` and JavaScript
yields `undefined` for a missing index, which is exactly what `optional()` and `required()` expect.

*Two Argus calls failed before this one returned* — `agy` reported success and returned neither
structured output nor prose, once on the task-2 diff and once on the branch diff. Both succeeded on
retry. Recorded rather than hidden: a review that errors is not a review that passed.

#### The one local CodeRabbit round, from the CLI

`status: review_completed`, **23 files reviewed against 23 changed** — reconciled both directions,
nothing unreviewed and nothing out of scope. Eight findings: one major, one minor, six trivial.

**The major one was real and is the best finding of the story.** The conflict check matched only a
tenure beginning on *exactly* the requested day, so a date landing **inside** a tenure that had
already been closed slipped past it — the close-update skips bounded ranges, and the insert then
computed a range overlapping the recorded one. A treasurer uploading a roll that genuinely
contradicts recorded history got a raw `23P01` instead of a sentence naming the unit. Fixed with
`m.held_during @> r.held_from and (lower(...) = r.held_from or not upper_inf(...))`, where
`not upper_inf` is what keeps ordinary succession out of it and `@>` being half-open admits a start
on the day a closed tenure ended. Both cases now have tests; the first was watched failing with
`23P01` before the fix.

| # | Severity | Verdict |
| --- | --- | --- |
| 7 | major | **fixed** — the conflict check above |
| 1, 6 | trivial | **fixed** — `KINDS_WITH_UNIT_REFERENCE` now carries `satisfies readonly DocumentKind[]`, so a member that is not a document kind fails compilation rather than at runtime |
| 2 | trivial | **fixed** — a test asserted `resolves.toBeDefined()`, which holds for any query that does not throw and would pass with the column dropped. It now reads the row back and asserts the null is stored |
| 3 | trivial | **fixed** — the `this-roll` message discriminator was added in task 2 with no test for its branch. Now covered, including that the two wordings differ |
| 8 | trivial | **fixed, and it found two more bugs** — see below |
| 4, 5 | minor, trivial | **skipped** — both are about `.claude/skills/bmad-ship-story/SKILL.md`, which arrived on this branch from a separate commit and is not this story's work |

**Finding 8 is the one worth keeping.** It asked that the query-count test compare two roll lengths
and assert equality rather than assert an absolute `< 12`. Making that change immediately failed —
and the failures were in the test harness, not the adapter:

1. the counting wrapper re-wrapped `client.query` on every `connect()`, so a **pooled** client reused
   by the second measurement counted every statement twice (23 against 11);
2. once that was fixed, `newDocument()` running through the same pool could land on the wrapped
   client and add one to the count before the call under test (12 against 11).

Both were invisible under the loose bound. The property now pinned is the one that matters: the
statement count does not depend on the length of the roll at all.

#### Argus on the fix commit — and it caught the fix

One medium finding, **confirmed and mine**: the counting wrapper permanently mutated `client.query`
on a pooled client, poisoning the shared pool — and the reset-after-setup above was a patch over that
rather than a fix for it. Replaced with a `Proxy` that delegates and leaves the pooled client
untouched, so nothing outside the measurement can be counted and nothing leaks past it.

That is the review gate's own thesis landing on this story: *a fix is the highest-risk diff, not the
lowest.* Two bugs came out of one loosened assertion, the second was worked around rather than
solved, and only a review of the fix diff said so.

*`argus_ingest` found nothing to learn from.* It was called with `from: .argus/cr.jsonl` and the
commit SHA, exactly as the refreshed workflow specifies, and returned `reviews_found: 0` — the
ingest adapter does not parse the CLI's JSONL event stream, which is a different shape from the IDE
extension's stored review. So Argus was **not** scored against this round. Stated plainly rather than
recorded as a pass: this is a gap between the refreshed step 4b and the ingest adapter, and it wants
fixing before the next story leans on it.

### Completion Notes List

**Task 1 — the roll's shape and its reader.** Done. `readRows` now yields `rollRows` beside the
records, and a roll row is its own type rather than four more fields on `ExtractionRecord`.

*The story's stated reason for that was wrong, and the right one is stronger.* The story argued field
count; re-derived, `ExtractionRecord` already had a plausible home for four of the six values and
only two were genuinely new, so on that argument widening was cheaper. The decisive reason is
`holdUnknownVendors`: it resolves and quarantines **every distinct non-null `vendorName`**, so a
holder routed through that field would ask a treasurer whether each of their owners is a vendor they
recognise, on every roll upload. Nothing in the type system would have caught it — the field is
`string | null` either way.

*`year` is explicit and deliberately not derived from `date`.* Deriving looks free and is wrong:
`date` is when the *membership* began, so a member who bought in 2019 and appears on the 2026 roll
would get an assessment against 2019. There is a test whose only job is to pin that apart.

*Two guards exist that no database constraint would have caught.* `AMOUNT_PATTERN` admits `0`, `0.00`
and `-100.00`; `assessment_amount_positive` refuses all three **by aborting the transaction the whole
roll is written in**, so one bad cell would have cost the document rather than the row. Positivity is
decided without a float — the shape is already known, so any digit `1-9` means greater than zero.

*One statement of which kinds carry a unit.* `KINDS_WITH_UNIT_REFERENCE` is read by both `validate`
and `tabular`. A second list is precisely how a producer comes to emit a value the validator rejects,
which is the defect story 2.5 spent a task on.

*An expired test premise, re-specified rather than weakened.* `validate.test.ts` asserted "a unit
reference belongs to a deposit" with `assessment_roll` in the **refusing** list. That was exactly true
for stories 2.4 and 2.5 and is made wrong by this story. It was re-specified so both the admitted and
refused lists derive from `KINDS_WITH_UNIT_REFERENCE`, plus a control asserting the two partitions
cover `DOCUMENT_KINDS` and neither is empty — without which an empty refused list would make those
cases vacuous and nothing would say so. Net +1 test, no coverage lost.

*Sensitivity check — eight mutations, every one verified to have applied (`subs=1`):*

| Mutation | Result |
| --- | --- |
| never produce a roll row | **36 of 117 failed** |
| drop the amount positivity check | 3 failed |
| drop the assessment-year range check | 2 failed |
| drop the duplicate-unit detection | 2 failed |
| match duplicates on the raw spelling, not the folded one | 1 failed |
| drop the cycle case-fold | 1 failed |
| drop the NUL guards | 1 failed |
| read the unit column for every kind | **0 failed in scope** — caught only by story 2.5's deposit suite |

**The surviving mutation is the one worth keeping.** The guard this story *widened* — from
`=== 'deposit'` to a set — was covered only by a test file outside the scope I mutated. An assertion
now lives beside the change, so the file that owns the guard also proves it.

*Argus review of the task diff — three findings, each verified against the real file before acting:*

| Finding | Verdict |
| --- | --- |
| `optional()` throws on a `null` cell (high) | **disagree** — pre-existing and unchanged by this diff, and unreachable: `asText()` converts null/undefined to `''` before the rectangle exists, and `parseCsv` only builds strings |
| `normalise()` throws on a nullish header (medium) | **disagree** — same, and same producers |
| `tooLong` spreads the whole string (low) | **confirmed** — my code. An untrusted cell is bounded only by the 25 MiB upload limit, so a hostile cell allocated hundreds of megabytes to answer a question settled after 65 characters. Replaced with an early-exit code-point count behind a free UTF-16 upper bound |

*The `tooLong` fix had no failing-first test, and that is stated rather than glossed.* The finding is
about allocation, not output, so no behavioural test can separate the two implementations. What the
fix got instead is a set of tests pinning the *semantics* it must not change — code points, not
UTF-16 units — which would fail against the obvious "optimisation" of dropping to `.length`.

*Writing those tests found a real inconsistency, recorded as a follow-up.* Through `readRows` a
64-code-point astral unit number is **refused**, because `validate.checkText` bounds text with
`trimmed.length` (UTF-16 units) while the database and `isStorableName` both count code points. So
the application refuses a unit number the column would store. Pre-existing, outside this story, and
listed below. The roll's own guards are therefore tested directly against `readRollRow`, where they
decide — with a control asserting the ordinary case, so the refusals are not satisfied by a function
that refuses everything.

*Follow-ups found and deliberately not fixed here:*

1. **`validate.checkText` measures UTF-16 units where the database counts code points.** Affects
   `vendorName`, `documentNumber` and `unitReference` alike. The fix is the one `isStorableName`
   already uses (`[...value].length`), applied consistently — but it changes vendor-name behaviour
   across epic 1's path, which this story does not cover.
2. **`isStorableName` in `hold-unknown-vendors.ts` has the same unbounded spread** the Argus finding
   raised, on the same untrusted path. Fixing one and not the other is how two implementations of one
   rule come to disagree, so both want the same change together.

**Task 2 — the write port, its adapter and migration 019.** Done. `RollRepository.apply` is the only
thing in this system that may create a unit; both read ports are untouched and their exhaustive tests
still pass (AC5).

*Named `apply`, not `replace`.* The grain differs per table, and a name promising uniform replacement
would be a lie in the signature. Units are upserted and **never deleted**; holders and tenures are
owned by the document (migration 019) and rewritten; assessments upsert at
`(unit_id, assessment_year)`.

*Migration 019 exists because idempotency needed a column.* Re-applying a roll must not duplicate its
tenures, and the only exactly-idempotent formulation is "delete what this document wrote, write it
again" — which needs a way to tell those rows from another roll's. The alternative is matching a
tenure by holder name, which migration 012 forbids in as many words. **The column is deliberately
absent from `unit` and `assessment`**, and that absence is asserted twice: against the migration text
and against the live database, by deleting a roll document and finding the payments still there.

*The membership range is computed, not assumed.* A tenure runs until the earliest other tenure for
that unit beginning after it — whether already recorded or a sibling in the same roll — so a roll
uploaded out of order lands as `[2019-03-01, 2026-07-01)` instead of overlapping.

*Sensitivity check — seven mutations, each verified applied. Two survived the first pass and both
were real coverage gaps:*

| Mutation | First pass | After the gaps were closed |
| --- | --- | --- |
| stop deleting what this document wrote | 3 failed | — |
| stop closing a prior open tenure | 2 failed | — |
| drop the distinct-on tenure dedup | 1 failed | — |
| drop the conflicting-tenure check | 1 failed | — |
| assessment upsert does nothing on conflict | 1 failed | — |
| **match units on the raw number, not the folded one** | **0 failed** | 1 failed |
| **drop the sibling upper bound** | **0 failed** | 1 failed |

**Why the raw-match mutation survived is the interesting part.** The upsert rewrites the stored
spelling to the roll's, so a raw lookup finds what it just wrote — the defect is invisible unless one
roll spells the same unit two ways. The new test does exactly that. The other gap was a unit changing
hands *within* one roll, which nothing covered.

*Argus review of the task diff — five findings, each verified against the real file:*

| Finding | Verdict |
| --- | --- |
| `insert into unit` uses `distinct on` with no `order by` (high) | **confirmed** — which spelling wins was arbitrary. Fixed with `order by unit_normalised_number(x), n`, keeping the first spelling in the roll, as vendor names are deduplicated. Also gives concurrent upserts a consistent lock order |
| assessment upsert can raise 21000 on a duplicate unit-year (high) | **confirmed** — unreachable through the reader today, but `apply` is a port boundary and a cardinality violation aborts the whole roll opaquely. Deduplicated deterministically, first row wins |
| `update unit_membership ... from unnest(...)` picks a match arbitrarily (high) | **confirmed and the most serious.** With two new tenures for a unit that already has an open one, closing it at the *later* date leaves the earlier one overlapping and the exclusion constraint takes the document. Now a correlated `min()` per membership |
| `distinct on` silently drops a self-contradictory roll (medium) | **confirmed** — two holders for one unit from one day would have kept whichever sorted first. Now refused with `ConflictingTenureError(..., 'this-roll')`, which has its own sentence because the remedy differs |
| `create index` should be `concurrently` (medium) | **disagree** — `scripts/migrate.mjs` wraps every migration in a transaction, and `create index concurrently` cannot run inside one. The suggested fix would break the runner; the tables are pilot-sized and migrations are applied offline |

All four confirmed findings were fixed test-first: each regression test was watched failing against
the pre-fix adapter.

*One Argus call failed before this one* — `agy` reported success and returned neither structured
output nor prose. Retried once and it returned normally. Recorded rather than hidden: a review that
errors is not a review that passed, and the retry is what makes this gate satisfied.

**Tasks 3 and 4 — the wiring, and the proof.** Done.

*The mutation that matters.* Deleting the `recordRoll` call from `ingest.ts` reproduces the state
this story found — stories 2.1 and 2.2 complete, tested, and reachable from nothing — and fails
**5 of the 7 end-to-end tests**. Recording a roll for every document kind rather than only rolls
fails 3 of 7. That is the check whose absence let this defect survive two stories.

*Tabular only, and the asymmetry is asserted rather than left to drift.* `roll-wiring.test.ts` pins
that `extract-document.ts` does **not** record a roll, with a control asserting it still records
payments — so the assertion cannot be satisfied by a call site that wires nothing. If a scanned roll
should ever create units, that is an AD-8 decision about widening the provider's result type to carry
a person's name, and it should arrive as a failing test beside the reason rather than a quiet edit.

*Ordering.* `recordRoll` runs before `recordPayments` and both run before `extractions.replace`
settles the document. Within one document the two are exclusive, but a treasurer selecting the roll
and the deposits in one submission gets them in the order they chose — and `ingest` processes a batch
sequentially, so roll-first is the order that works when both arrive together.

*Argus review of the diff — two findings:*

| Finding | Verdict |
| --- | --- |
| roll rows skip the NUL validation applied to records (high) | **disagree** — verified: `readRollRow` guards NUL on both text fields a roll row sends to the database, one layer earlier than the cited line. The row is refused, the document reports `unreadable`, and `recordRoll` is never reached. `unstorableUnitReference` exists for the *records* path precisely because `validate` does not check NUL; the roll path does not need it because its own reader does |
| the end-to-end teardown can leak a connection (medium) | **confirmed** — a teardown query that threw would leak the client and replace the real failure with its own. The client is now constructed eagerly (so there is always one to close), the sweep is wrapped in `try`, and `end()` runs in `finally`. `deposit-ingestion.test.ts` shares the shape and is listed as a follow-up |

*A type error the suite could not have caught.* The first fix made `writer` optional, which broke
every helper that used it and moved `tsc` from 8 to 15. Vitest does not typecheck, so all 571 tests
stayed green while the file did not compile. Constructing the client eagerly is the shape that
satisfies both.

### File List

- `core/extraction/roll.ts` — added, Task 1.
- `core/extraction/tabular-roll.test.ts` — added, Task 1.
- `core/extraction/tabular.ts` — modified, Task 1.
- `core/extraction/record.ts` — modified, Task 1 (`KINDS_WITH_UNIT_REFERENCE`).
- `core/extraction/validate.ts` — modified, Task 1.
- `core/extraction/validate.test.ts` — modified, Task 1 (expired premise re-specified).
- `migrations/019_roll_document_ownership.sql` — added, Task 2.
- `migrations/roll-document-ownership.test.ts` — added, Task 2.
- `core/ports/roll-repository.ts` — added, Task 2.
- `core/ports/roll-repository.test.ts` — added, Task 2.
- `adapters/db/roll-repository-postgres.ts` — added, Task 2.
- `adapters/db/roll-repository-postgres.test.ts` — added, Task 2.
- `core/ingestion/record-roll.ts` — added, Task 3.
- `core/ingestion/record-roll.test.ts` — added, Task 3.
- `core/ingestion/roll-wiring.test.ts` — added, Task 3.
- `core/ingestion/ingest.ts` — modified, Task 3.
- `app/upload/actions.ts` — modified, Task 3.
- `adapters/db/roll-ingestion.test.ts` — added, Task 4.

### Change Log

- 2026-08-09 — All four tasks complete. A roll uploaded now creates units, holders, tenures and
  assessments, and a deposit uploaded after it is attributed instead of held. Status -> review.

- 2026-08-09 — Story created. Epic 2 built four tables for the assessment roll across stories 2.1 and
  2.2 and never built the path that fills them, so every deposit on a real installation is held
  `unknown-unit`. Verified by search that outside `migrations/`, only `*.test.ts` files insert into
  `unit`, `unit_holder`, `unit_membership` or `assessment`. Status -> ready-for-dev.
