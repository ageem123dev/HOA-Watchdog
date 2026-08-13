---
baseline_commit: b99195e
merge_request: 56
---

# Story 4.4: The dues that did not arrive

Status: review

## Why this story exists

FR-7, and the last of Epic 4's three detectors:

> **FR-7** — "Uploaded bank deposit data is compared against the expected assessment roll to identify
> units with missed or partial payments, without manual reconciliation."

4.2 and 4.3 compared invoices against each other. This one compares **what arrived against what was
owed**, which is a different kind of query: the other side of the comparison is not another document,
it is a schedule Epic 2 already derives.

### The wheel that already exists, and must not be rebuilt

**Story 2.3 built the schedule.** `core/assessment/schedule.ts` is a pure function with no clock, and its
acceptance criteria settled the two things this story would otherwise have to decide badly:

- `deriveSchedule(terms)` turns an annual amount and a cycle into instalments whose amounts **sum
  exactly to the annual figure**, with the remainder placed deterministically on the earliest
  instalments. 1000.00 over twelve months is 83.34 for January through April and 83.33 thereafter.
- `expectedBy(schedule, on)` is the amount a unit should have paid by a date, **including an instalment
  falling due on that date** — dues are collected in advance, so an annual payer owes the full year on
  1 January.

> **Amended 2026-08-07** (story 2.3): *"Matt chose the real-world convention — dues are collected in
> advance, each instalment due on the first day of its period … The surviving point is the one that
> mattered: a difference in cycle must never by itself produce an arrears finding."*

**That sentence is this story's single largest false-positive risk.** A monthly payer and an annual payer
owing the same annual figure must never differ in findings merely because their cycles differ. Under
start-of-period that is expressible as "exactly the instalments already due", and `expectedBy` is what
expresses it. Re-deriving any of this in `core/detection/` would be a second definition of when money is
owed — the defect story 1.6 exists to prevent, in a new place.

`toMinorUnits` / `fromMinorUnits` in `core/assessment/minor-units.ts` are how amounts are compared
exactly. Story 4.3's rule stands: **no float, and no division before a decision.**

### Two findings, not one, and the epic says so

> **Two flags, not one.** FR-7's "missed or partial" resolves to: **paid late**, and **paid the wrong
> amount**. They are distinct findings with distinct evidence.

They are also distinguishable only if this story says how. Both look like "received is less than
expected" at the aggregate, and picking the wrong split is how a board member gets told the same thing
twice in different words.

### Attribution is a fiduciary requirement, not a nicety

> **Dues attach to the unit, not the member.** … a missed payment must be attributed to whoever held the
> unit *in that period*, not to whoever holds it now — attributing an arrears flag to the wrong person is
> the kind of error a fiduciary tool cannot make.

`unit_membership.held_during` is a `daterange` with a gist exclusion constraint (`unit_membership_no_overlap`),
so at most one holder covers any instant. The holder for a period is a containment query, never
"the most recent row".

## Story

**As** a board member,
**I want** to be told which units have not paid what they owed by now,
**So that** arrears are found by the system rather than by someone reading a bank statement line by line.

## Acceptance Criteria

**AC1 — A unit that has paid less than the schedule expects by the evaluation date is flagged.**
Expected comes from `expectedBy`, never from arithmetic written in this story. Received is the sum of
that unit's payments for the assessment year.

**AC2 — A difference in billing cycle never produces a finding on its own.**
The epic's own amendment, as an executable criterion: two units with the same annual amount and
different cycles, evaluated at the same date, each having paid exactly what their own schedule expects,
must both be silent. **This is the story's headline false positive** — get it wrong and every annual
payer is delinquent for eleven months.

**AC3 — The evaluation date is a parameter and never the clock.**
Re-running detection must give the same answer for the same deposit document, which is AD-13's no-op in
this story's terms. Story 2.3 made the schedule clock-free for the same reason; a detector that
reintroduced `now()` would undo it. **Choose the anchor, write down why, and test that two runs agree.**

**AC4 — The two findings are distinguishable, and a unit never gets both for the same thing.**
Decide what separates *paid late* from *paid the wrong amount*, record the reasoning, and test a case of
each that the other does not also fire on. If the answer is that one is a special case of the other, say
so and ship one finding type — but say it.

**AC5 — The finding is attributed to whoever held the unit during the period.**
Via `held_during` containment. Test the case that makes it matter: a unit that changed hands mid-year,
where the arrears belong to the former holder and the current holder must not be named.

**AC6 — What must not be flagged, as its own criterion.**
- A unit that has paid **exactly** what is expected — the boundary, pinned.
- A unit that has **overpaid**. Paying early or in advance is not a finding.
- A unit with no assessment for the year. Nothing is owed, so nothing is missing; this is not the same
  as owing zero, and it must not be treated as a shortfall of the whole amount.
- A unit whose only payments fall in a different assessment year.

**AC7 — Running detection twice yields one finding (AD-13).**
Same rules as 4.2 and 4.3. Proven against a real database.

**AC8 — The finding type says what was found without overclaiming.**
UX-DR23. A shortfall against a schedule is arithmetic; "delinquent" is a judgement about a person, and
the roll may simply be out of date. 4.2's audit caught this after the code was written and 4.3 avoided it
by deciding first.

**AC9 — The evidence carries the numbers a board member needs to check the claim.**
Expected, received, the shortfall, the evaluation date, the cycle, and how many instalments were due —
UX-DR24's count. A figure with no denominator is the reassurance that rule forbids.

**AC10 — No model, anywhere.** Grow `core/ports/finding.test.ts`'s list again.

**AC11 — Proven against a real database.** `numeric(14,2)` sums, real `daterange` containment, and a
real mid-year change of holder.

## Tasks / Subtasks

- [x] **Task 1 — The rule (AC1, AC2, AC4, AC6)**
  - [x] A pure function in `core/detection/`: given an assessment, that unit's payments, and an
        evaluation date, return the shortfall or nothing. **Call `deriveSchedule` and `expectedBy`** —
        do not re-derive instalments.
  - [x] Exact decimal via `toMinorUnits`. No float, no division before a decision (story 4.3).
  - [x] AC2 as a test with two cycles side by side, because it is the criterion most likely to regress.
  - [x] The *late* versus *wrong amount* decision, argued in prose before it is coded.

- [x] **Task 2 — Reading what arrived and who held it (AC5, AC11)**
  - [x] A read-only port, following `InvoiceReader`'s shape and the reason for it: payments for a unit
        and year, and the holder covering a date. Bound parameters, never interpolation (AD-8).
  - [x] `held_during @>` for the holder, never "the latest membership row".
  - [x] `test:db` for the year boundary, the mid-year change of holder, and a unit with no assessment.

- [x] **Task 3 — Raising it (AC7, AC8, AC9)**
  - [x] Reuse `core/detection/detection-run.ts` for the period helpers rather than adding a third
        definition of a period.
  - [x] Pick `subject_id` and `period` by **probing what is stable across re-ingest**, the way 4.2 had
        to. A unit id is stable where an extraction id is not, but check rather than assume.
  - [x] Evidence per AC9.

- [x] **Task 4 — Wiring (AC10)**
  - [x] `run-detection.ts` runs three detectors. The isolation contract is already there and already
        tested — one failing detector must not stop the others — so this grows it rather than deciding
        it again.
  - [x] Note: the other two detectors key on a *document*; this one keys on a *unit*, and runs off a
        deposit document. Check the wiring still reads naturally with a detector that is not
        document-shaped, and say so if it does not.
  - [x] Grow the AC10 model-path list.

- [x] **Task 5 — The gate**
  - [x] `npm run lint`, `npm run build`, `npm test`, `npm run test:db`, `npx --no-install tsc --noEmit`
        against the 8-error baseline.

## Dev Notes

### The schema, probed rather than assumed (2026-08-13)

| Table | Shape that matters here |
| --- | --- |
| `assessment` | `(unit_id, assessment_year, annual_amount numeric, billing_cycle text)`, unique on `(unit_id, assessment_year)`; cycle is `monthly` / `six_monthly` / `annual` |
| `payment` | `(unit_id, document_id, paid_on date, amount numeric)`, `amount > 0`, cascades from `document` |
| `unit_membership` | `(unit_id, holder_id, held_during daterange)` with a gist exclusion on `(unit_id, held_during)` — **at most one holder at a time**, which is what makes containment the right query |
| `unit_holder` | `full_name` |

`payment.amount > 0` is a check constraint, so a refund does not arrive as a negative payment the way a
vendor credit does in 4.3. Do not write the credit guard again; write down that it is not needed here.

### What stories 4.2 and 4.3 learned

- **Probe the database before deciding a key.** Both obvious answers for 4.2's `subject_id` were wrong.
- **A guard nothing can break is a guard to delete.** Five have gone this way across 4.2 and 4.3, two of
  them in 4.3 alone.
- **A test can pass for the wrong reason, and a mutation will not always tell you.** 4.3 shipped two:
  eleven db tests sharing a fixture they all narrowed on, and a refusal case where "refused" and "found
  nothing" were the same observable. **Ask of every refusal test: what would this look like if the
  refusal did not happen?**
- **An expired premise fails loudly when you break the code, so it looks healthy.** 4.3 retired one that
  no mutation could have found. The test-value pass is what catches those.
- **The AC audit before the merge request has found something on five consecutive stories.** Run it.
- **A comment can assert something false about Postgres.** 4.3's migration 022 claimed an expression index
  requires an `IMMUTABLE` function; measured, Postgres accepted `stable` and `volatile` too, because a
  SQL-language function is inlined and the body is what is checked. Measure before asserting.
- **Anything carrying a backslash goes through the editing tool**, never a shell heredoc.

### The shapes to copy

- `core/assessment/schedule.ts` — the pure rule this story consumes, and the docblock style for a
  decision that had to be made rather than derived.
- `core/detection/vendor-spike.ts` — exact-decimal comparison with the rounding placed deliberately.
- `core/detection/detect-vendor-spikes.ts` — grouping before raising, and evidence carrying derived
  values only (AD-6).
- `core/ports/invoice-reader.ts` — a read-only port and the argument for why it has no write method.
- `core/ingestion/run-detection.ts` — the isolation contract, now with two detectors under it.

### Where this story differs from its two predecessors

4.2 and 4.3 both answer "is there something wrong with this document?". This one answers "is there
something missing?" — and **absence has no document to hang off**. The subject is a unit, the trigger is
a deposit upload, and the evaluation date is whatever this story chooses. Every one of those is a place
the two earlier detectors offer no precedent, which is why AC3 and Task 3 ask for the reasoning in
writing rather than a matching implementation.

### References

- [Source: epics.md] — FR-7; the domain detail of 2026-08-07; story 2.3 and its amendment; UX-DR23, UX-DR24
- [Source: ARCHITECTURE-SPINE.md] — AD-6, AD-8, AD-13
- [Source: core/assessment/schedule.ts] — `deriveSchedule`, `expectedBy`
- [Source: 4-3-a-vendor-who-charged-more-than-usual.md] — the review record this story's learnings come from

## Dev Agent Record

_To be filled by the dev agent._

## Review Findings

Reviewed as a whole-story diff (`main...HEAD`) by Argus three times and once by the CodeRabbit CLI, plus
the acceptance-criteria audit. Every finding verified against the real file before being acted on.

### Taken

| From | Finding |
| --- | --- |
| AC audit | **The reader selected units from the uploaded deposit's own payments, so a unit that had paid nothing was never checked** — the first case FR-7 names. The roll is now the driving table. |
| Argus | A count of the whole roll (`unitsChecked`) stored inside a finding about one unit, under a comment describing the instalment count. It would also have amended every finding whenever the roll grew. |
| Argus | **A late payment never corrected the finding it settled.** Only the upload year was evaluated, and findings are one-way, so paid-off arrears stayed on the register. Every year a deposit's money is for is now evaluated. |
| CodeRabbit | `instalmentsDue` spelled its own `dueOn <= evaluatedOn`, duplicating `expectedBy`'s boundary. One predicate now, shared. |
| CodeRabbit | `subjectsChecked` summed per year, double-counting a unit assessed in two. |
| CodeRabbit | `yearRange` accepted any safe integer; `padStart` does not truncate, so `99999` built a period key nothing could match. |

### Refused

| From | Finding | Why |
| --- | --- | --- |
| Argus | **[high]** `limit 1` without an `order by` in `evaluationDateFor` | The query is a primary-key lookup with neither. Hallucinated. |
| Argus | **[high]** uncast amount inside a `json_build_object` | No such call exists; both amounts already carry `::text`. |
| CodeRabbit | the port imports `ReceivedPayment` from the detection module | The shape `invoice-reader.ts` already has. Changing one without the other is worse than either. |
| CodeRabbit | assert `duesForYear`'s argument order | Adds nothing over asserting the periods actually raised. |
| CodeRabbit | indexes for the two dues queries | Worth having, on migration 022's argument. **Recorded as the next thing this path needs** rather than added: a migration written at the end of a story is the diff this project has learned to distrust. |

### Three of my own tests passed for the wrong reason

A float-summing mutation survived because every amount in the file happened to be float-safe. A multi-year
test never asserted the accumulated count, so `+=` to `=` survived. And a year-range guard tested through
the detector was never reached, because with a year no unit is assessed for the loop body never runs.

**Twice on this story, writing a limitation down was mistaken for handling it** — the audit finding and
Argus's late-payment finding are the same mistake in two places.

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-13 | Story created after 4.3 merged as b99195e. Written to consume story 2.3's schedule rather than re-derive it, because a second definition of when money is owed is this story's worst available defect. |
