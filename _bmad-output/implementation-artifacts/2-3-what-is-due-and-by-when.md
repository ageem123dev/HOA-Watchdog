---
baseline_commit: 42b368f5409334dc06e41ddcfd2df36720af05b1
merge_request: 25
---

# Story 2.3: What is due, and by when

Status: done

> **Third of four stories in epic 2, the dues ledger.** 2.1 built the unit and who held it, 2.2 what
> it owes for a year. This turns that annual figure into the instalments it is actually paid in. 2.4
> records what arrived, and epic 4 compares the two.

## Story

As a treasurer,
I want the annual amount turned into the instalments it is actually paid in,
So that lateness and shortfall are measurable rather than matters of opinion.

## Acceptance Criteria

**AC1**
**Given** an annual amount and a cycle
**When** the schedule is derived
**Then** the instalments sum to exactly the annual amount, with any remainder placed
deterministically rather than lost to rounding

**AC2**
**Given** a monthly cycle and an annual cycle for the same annual amount
**When** each is evaluated part-way through the year
**Then** each is expected to have paid exactly the instalments that have already fallen due, and the
two schedules still sum to the same annual total — the cycle changes *when* money is owed, never
*how much* is owed for the year

**AC3**
**Given** the derivation
**When** it runs
**Then** it is a pure function over the assessment, with no I/O and no clock of its own — the
evaluation date is a parameter

## Two decisions taken before implementing

Both were settled by Matt on 2026-08-07, because each changes what the function computes and one of
them contradicted an acceptance criterion.

### Instalments fall due at the **start** of the period they cover

Dues are collected **in advance** — the real-world convention. A monthly instalment for March is due
1 March; the single annual instalment is due 1 January.

**This contradicted AC2 as originally written**, which said the annual unit "is not yet expected to
have paid anything" part-way through the year. That is only true if instalments fall due at period
*end*. AC2 in epics.md was amended, carrying the reasoning; the surviving point is that a difference
in cycle must never by itself produce an arrears finding.

*A consequence worth knowing:* every due date is the **first of a month**, so leap years and
short months never arise. Had instalments been due at period end, February would have needed a
day-count rule and 29 February a special case.

### The remainder goes onto the **earliest** instalments

1000.00 over twelve months is 83.33 each and leaves 0.04. One extra cent is added to each of the
first four instalments:

| | |
| --- | --- |
| Jan–Apr | 83.34 |
| May–Dec | 83.33 |
| **sum** | **1000.00** |

Chosen over "last instalment absorbs it" so the association is never short early in the year, and
over "first instalment absorbs it" so no single instalment carries a visibly odd figure.

## Verified while writing this story

| Fact | Why it matters here |
| --- | --- |
| `assessment.annual_amount` is `numeric(14,2)`, crossing as a **decimal string** | The input is a string like `'1000.00'`, never a number |
| `pg` returns `numeric` as a string; `Number()` on it is a float | `Number('1000.00') * 100` is the obvious way to get cents and is exactly the trap this story must not fall into |
| `BILLING_CYCLES` is `['monthly', 'six_monthly', 'annual']`, frozen, a union type | The switch over it can be exhaustive at compile time |
| `core/` imports nothing outward (`core/ports/boundary.test.ts`) | This is pure logic and belongs entirely in `core/` |

## Tasks / Subtasks

- [x] **Task 1 — Exact decimal arithmetic, without a float and without a dependency** (AC1)
  - [x] Parse a `numeric(14,2)` decimal string to an integer count of minor units **by string
        manipulation**, never through `Number()` or `parseFloat`. `Number('1000.00') * 100` is
        `100000.00000000001`-class arithmetic waiting to happen and is the single most likely defect
        in this story.
  - [x] Format an integer count of minor units back to a decimal string with exactly two decimal
        places — `100000` → `'1000.00'`, and `4` → `'0.04'`, not `'0.4'` or `'.04'`.
  - [x] **Reverse-it:** parse then format returns the input for every amount tested, including ones
        with a trailing zero (`'1200.00'`), no fractional part, and the maximum the column admits.
  - [x] Reject an input that is not a well-formed two-decimal amount rather than coercing it. Say
        which error and prove it — a silent `NaN` here becomes a wrong instalment downstream.
- [x] **Task 2 — The schedule** (AC1, AC3)
  - [x] `core/assessment/schedule.ts` — a **pure function** over `{ annualAmount, billingCycle,
        assessmentYear }`. No I/O, no imports outside `core/`, and **no clock**: it must not call
        `new Date()`, `Date.now()` or read any ambient time.
  - [x] Instalment counts: monthly 12, six_monthly 2, annual 1. Due dates are the first of the
        period — monthly `YYYY-01-01` … `YYYY-12-01`, six-monthly `YYYY-01-01` and `YYYY-07-01`,
        annual `YYYY-01-01`.
  - [x] Dates are `YYYY-MM-DD` **strings**, matching `UnitHolding.heldFrom` from story 2.1 and for
        the same reason: a JS `Date` is an instant at local midnight and shifts the day west of UTC.
  - [x] **The sum property is the assertion this task exists for.** Assert it across many amounts and
        all three cycles, not one worked example — a single case can pass against an implementation
        that drops the remainder.
  - [x] The switch over the cycle must be **exhaustive at compile time**. A fourth cycle added to
        `BILLING_CYCLES` should fail the type check here, not fall through to a default.
- [x] **Task 3 — What is expected by a given date** (AC2, AC3)
  - [x] A second pure function: given a schedule and an evaluation date, the total expected to have
        been paid by then — the sum of instalments whose due date is on or before it.
  - [x] **The evaluation date is a parameter.** Assert it, and assert the module reads no clock.
  - [x] Boundaries: the day before the first due date (nothing expected), **exactly on** a due date
        (that instalment *is* expected — due in advance), the day after, the last due date, and a
        date after the year ends (the whole annual amount).
  - [x] A date before the assessment year and one after it, since epic 4 will evaluate historical
        years.
- [x] **Task 4 — AC2, as the property it actually is** (AC2)
  - [x] Two cycles, one annual amount, evaluated on the same date: each expects exactly the
        instalments already due, and both schedules sum to the same annual total.
  - [x] Assert **both halves**. "Same total for the year" alone passes against a function that
        expects the full amount immediately for every cycle; "different expected-to-date" alone
        passes against one that scales the annual figure by the cycle.

## Dev Notes

### What stories 2.1 and 2.2 hand over

- `core/assessment/billing-cycle.ts` — `BILLING_CYCLES` frozen, `BillingCycle` a union of the three
  literals. Import it; do not restate the list.
- `core/ports/assessment-directory.ts` — `UnitAssessment` carries `annualAmount: string`,
  `billingCycle: BillingCycle`, `assessmentYear: number`. That is this story's input shape.
- Dates cross as `YYYY-MM-DD` strings throughout (`UnitHolding.heldFrom`, `heldUntil`).
- `migrations/executable-sql.ts` exists and is shared. Not needed here — this story adds no
  migration — but do not write a local copy of anything that already exists.

### Learnings that apply directly

Seven guards that proved nothing were found across 2.1 and 2.2, and **three of them were written
while fixing a previous one**. The ones whose shape applies here:

1. **A test whose comment claims more than the code checks.** 2.2's type assertion was documented as
   preventing a widening it could not detect. If a comment here says "pure", something must fail when
   it stops being pure.
2. **A property asserted with one example.** The sum property is exactly the kind that passes for
   `1200.00 / 12` and fails for `1000.00 / 12`. Choose amounts that do not divide evenly.
3. **Mutate one thing at a time.** 2.2 found a check constraint whose removal *nothing* could
   detect, because the mutation had dropped two constraints together.
4. **A "control" that asserts the absence of something never present.** If a test asserts this module
   reads no clock, confirm it fails when a clock is added.

### Testing standards

- Pure logic, so `npm test` alone covers it — no database, no `test:db` additions.
- Gate: `npm run lint`, `npm run build`, `npm test`, and `npx --no-install tsc --noEmit` against its
  **baseline of 8** pre-existing errors. `npm run test:db` still runs because this story must not
  break it, though it adds nothing to it.
- **No new dependency.** A decimal library would solve Task 1 and needs approval this story has not
  been given; integer minor units computed by string manipulation is exact and is the intended route.

### Project Structure Notes

| Path | Kind |
| --- | --- |
| `core/assessment/minor-units.ts` | NEW — parse and format exact decimal strings |
| `core/assessment/minor-units.test.ts` | NEW |
| `core/assessment/schedule.ts` | NEW — the two pure functions |
| `core/assessment/schedule.test.ts` | NEW |

`core/` imports nothing outward — enforced by `core/ports/boundary.test.ts`.

### References

- `_bmad-output/planning-artifacts/epics.md` — Epic 2, Story 2.3 (AC2 amended 2026-08-07), and the
  "Domain detail: how dues actually work" note.
- `ARCHITECTURE-SPINE.md` — Consistency Conventions (Money, amended 2026-08-07; Dates).
- `_bmad-output/implementation-artifacts/2-2-what-each-unit-owes-this-year.md` — the predecessor, and
  the money decision this story consumes.

## Dev Agent Record

### Agent Model Used

### Test Design

### Debug Log References

### Review Findings

## CodeRabbit, MR !25

**The local IDE round never ran.** No record appeared in 75 minutes and it needs a manual start, so
this MR was CodeRabbit's first look at the code. Recorded rather than left as an absence: a round
that never happened and a round that found nothing are indistinguishable afterwards, and only one of
them is evidence.

**Round 1 — 2 findings, both mine, both tests that could not fail.**

| Finding | What was true |
| --- | --- |
| Two tests assert only inside a `catch` | **Confirmed.** With no assertion outside, a test whose code stops throwing passes with **zero assertions**. Both now assert the throw first |
| One of them aimed at an unreachable path | **Confirmed, and the sharper half.** It passed an *amount* carrying a newline — but `AMOUNT` rejects newlines, so `toMinorUnits` threw first and `describeValue` in `schedule.ts` was never reached. A well-formed amount **cannot** contain a newline, so the path is unreachable by construction. Repointed at `billingCycle`, which is the input that actually arrives unvalidated |
| A duplicated source reader with no control | **Confirmed.** The second copy asserted only *absences*, so it would have passed with both `.replace` calls deleted — story 2.2's shape in a new place. One reader now, with `Date.parse` folded into the guarded list beside the control |

*Sensitivity, each restored:* adding `Date.parse` to the module fails `does not call Date.parse`;
removing the cycle guard fails the four hostile-cycle cases **and** the newline test, which now has
an assertion outside its catch to fail with.

**Round 2 — clean.** The incremental review of the fix commit (`d46ed3d..e9d95e9`) reports
"No actionable comments were generated", and both threads are resolved.

*A note-ordering trap worth recording.* The **newest** note by `created_at` was a re-statement of the
original review of the *previous* head, showing 2 actionable. The clean review of the fix was posted
six minutes earlier. Keying on "newest review note" would have read this MR as unconverged
indefinitely. Convergence was decided by reading each note's stated commit **range**, not its
timestamp.

*Self-inflicted, and caught by a count rather than a failure.* Three string literals were mangled
into real newlines while editing and stopped the file parsing. The suite went **123 -> 54 -> 123**,
and nothing *failed* at 54 — the file simply stopped being collected. This is the second time in two
epics that a silently-uncollected file was caught by reading the count.

### Completion Notes List

**Tasks 3 and 4 — what is expected by a date, and AC2 as a property.** Done.

`expectedBy(schedule, on)` sums every instalment already due, **including one falling due on the
date itself**, because dues are collected in advance. That boundary is the whole due-date decision,
and the sensitivity check confirms it: making the comparison exclusive fails five tests.

The comparison is a string comparison. Parsing either side into a `Date` would make it an instant at
local midnight and shift the day west of UTC — story 2.1 recorded the same hazard for membership
dates — so the module is asserted against `new Date(` and `Date.parse` as well as the clock calls.

AC2 is asserted as **both halves**, because either alone passes a wrong implementation: "same annual
total" alone is satisfied by a function expecting the full amount immediately for every cycle, and
"different to date" alone by one that scales the annual figure by the cycle.

**The eighth guard that proved nothing, and this one was a comment of mine.**
`sums an uneven schedule exactly` carried the note "a float sum drifts here and a naive one is off by
a cent". It does not. Mutating the sum to `Number(amount) * 100` left **every test passing** —
`Number('83.34') * 100` is exactly 8334, and so is every other amount that schedule produces. The
comment asserted a property the chosen values could not exercise.

The value that does discriminate is `0.29`, and a total of `3.48` over twelve months is twelve
instalments of exactly that. `Number('0.29') * 100` is 28.999999999999996, so five of them sum to
144.99999999999997 — not an exact count of minor units, and unformattable. Verified before the test
was written; the float mutation now fails precisely that test, and `3.48` was added to the
sum-property table too.

*Sensitivity checks, each restored:*

| Mutation | Tests that failed |
| --- | --- |
| Due-date comparison made exclusive | 5, including the on-the-day boundary and AC2 |
| Sum routed through floats | `sums instalments a float would get wrong` — and **nothing at all** before that test existed |
| Evaluation-date validation removed | all five malformed-date cases |

*One thing caught by the gate rather than by a test:* lint went from 1 warning to 2 — an unused
binding I had left in the test file. Removed, restoring the baseline. Worth recording because a
warning count that drifts upward one at a time is how a baseline stops meaning anything.

*Gates:* lint 0 errors and **1 warning** (pre-existing, in `tsconfig-coverage.test.ts`),
`tsc --noEmit` **8** (= baseline), build clean, `npm test` **75 files / 1389 passed**,
`npm run test:db` **22 files / 423 passed**.

**Task 2 — the schedule.** Done. `deriveSchedule` is pure: no I/O, no imports outside `core/`, and
the module is asserted against `new Date(`, `Date.now(`, `performance.now(` and `process.hrtime`,
because a behavioural test cannot catch a clock read that happens to agree with the expected answer.

*The sum property is asserted across eight amounts × three cycles, not demonstrated once* — and the
sensitivity check shows why that matters: removing the remainder distribution fails only the amounts
that **do not** divide evenly. Every `1200.00` case still passes. A test suite built from round
numbers would have shipped the bug.

Moving the remainder to the *last* instalments instead fails exactly two tests and leaves the sum
property green — correctly, since both placements are exact and only the recorded decision
distinguishes them.

The cycle table is `Record<BillingCycle, readonly number[]>` rather than a switch, so the instalment
count is the list length and the two cannot disagree. Exhaustive at compile time, **verified**:
adding a fourth cycle takes `tsc --noEmit` from 8 to 9, pointing at `schedule.ts` and naming the
missing key.

*Review — four findings, three fixed, one not reproducible:*

| Finding | Disposition |
| --- | --- |
| `DUE_MONTHS[cycle]` with an unvalidated key | **Fixed.** This is story 1.6d's defect exactly. Probed: `DUE_MONTHS.constructor` is a function with `length` 1 and no `map`, `.__proto__` an object with neither, `.toString` a function with `length` 0 — none is `undefined`, so the failure surfaces three lines later as "months.map is not a function" |
| The year is not zero-padded | **Fixed.** `'999-01-01' < '2024-01-01'` is **false**, checked — a short year silently breaks the string ordering these dates exist to provide. A non-integer year is refused outright |
| The error message repeats the raw amount | **Fixed**, through the `describeValue` helper task 1 grew, now exported so one fix reaches both |
| `total <= 0` lets `NaN` through | **Not reproducible.** `toMinorUnits` validates with a regex and `Number.isSafeInteger`, so it cannot return `NaN`. Reported as checked rather than fixed |

*And a third assertion in two stories that could not tell a contract from a crash.* The cycle tests
first asserted `toThrow(TypeError)` — and the crash throws a `TypeError` of its own, so they passed
**before the guard existed**. They now assert the message. The same shape appeared in task 1, where
`String()` throws a `TypeError`, and in story 2.2.

*Sensitivity checks, each restored:*

| Mutation | Tests that failed |
| --- | --- |
| Remainder not distributed | the placement test and every **unevenly divisible** sum case |
| Remainder moved to the last instalments | placement and the fencepost case only; the sum property stayed green |
| A fourth cycle added to `BILLING_CYCLES` | `tsc` 8 → 9, at `schedule.ts` |
| `Object.hasOwn` guard removed | all four hostile-cycle cases |
| Year padding removed | the short-year case |
| Year integer guard removed | all three non-integer cases |

*Gates:* lint 0 errors, `tsc --noEmit` **8** (= baseline), build clean, `npm test`
**75 files / 1369 passed**.

**Task 1 — exact decimal conversion.** Done. `core/assessment/minor-units.ts`, the only place the
decimal-string and integer representations meet.

*The defect it exists to prevent is one line:* `Math.trunc(Number('0.29') * 100)` is **28**. What
makes it dangerous is that `'1000.00'` and `'1234.56'` both survive it, so it is correct in testing
and wrong in a ledger. `'0.29'` is therefore the value the tests are built around, with a control
asserting the float route really does break on it and really does not break on `'1000.00'` — a fact
about JavaScript, stated so the chosen value is shown to be able to fail rather than claimed to be.

Both directions work on digits: parsing concatenates rather than multiplies, formatting pads before
slicing so `4` is `'0.04'`. The only arithmetic is one integer parse. No dependency added.

*Review — three findings, all in the error path, all confirmed by reproducing them.* `argus_review`
raised that both messages interpolated the rejected value raw:

| Finding | Reproduced | Fixed by |
| --- | --- | --- |
| A newline in the input reaches the message, forging a log line in a project that logs JSON | yes — the message contained a raw `
` | `JSON.stringify` escaping, in a shared `echo()` |
| An unbounded echo repeats the whole input | yes — a 10,000-character input produced a 10,056-character message | truncation at 40 characters |
| A `Symbol` makes `${…}` throw, masking the intended error | yes — `TypeError: Cannot convert a Symbol value to a string` instead of `RangeError` | explicit symbol handling plus a `try/catch` for null-prototype objects |

These are not theoretical: **story 2.4 feeds amounts read off uploaded documents through this
function**, which makes the input untrusted in the strict sense.

*And a test that passed for the wrong reason, caught while fixing them.* `still reports a TypeError
for a value that cannot be stringified` asserted only `toThrow(TypeError)` — and `String()` throws a
`TypeError` of its own, so it passed whether the error came from the contract or from the error path
falling over. It now asserts the message.

*Sensitivity checks, each restored:*

| Mutation | Tests that failed |
| --- | --- |
| Parsing routed through a float | `converts an amount the float route gets wrong` and `round-trips 0.29 unchanged`, and nothing else |
| Zero-padding dropped from the formatter | all four sub-unit cases and the `0.00` round trip |
| `echo()` reverted to plain interpolation | all four error-path tests |
| Only the `try/catch` inside `echo()` removed | the two unstringifiable-value tests — so the catch is falsifiable rather than decorative |

*Gates:* lint 0 errors, `tsc --noEmit` **8** (= baseline), build clean, `npm test`
**74 files / 1320 passed**, `npm run test:db` **22 files / 423 passed**.

### File List

### Change Log

- 2026-08-07 — Ready to merge. MR !25 reviewed clean on `e9d95e9`. Status -> done.

- 2026-08-07 — All four tasks complete. Status -> review.

- 2026-08-07 — Story created. Two domain decisions were settled before implementation rather than
  during it: instalments fall due at the start of the period (dues in advance), which required
  amending AC2 in epics.md; and the rounding remainder is spread onto the earliest instalments.
  Status -> ready-for-dev.
