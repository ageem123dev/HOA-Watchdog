---
baseline_commit: f676fb1
---

# Story 4.3: A vendor who charged more than usual

Status: review

## Why this story exists

The second half of FR-6, and the half that carries AD-6:

> **FR-6** — "Newly uploaded vendor invoices are automatically compared against historical payment data
> and vendor averages. Exact duplicates … are flagged, **as are invoices exceeding a vendor's trailing
> 6-month average by a defined threshold.**"

> **AD-6** — the query returns the **computed percentage over the trailing average**, not the
> ingredients. The spine's phrase is already quoted in migration 021: *"a vendor-spike finding stores
> the computed percentage over the trailing average, not the invoices it averaged."*

Story 4.2 built the machinery this reuses: `InvoiceReader`, `FindingRegister`, `runDuplicateDetection`'s
wiring, and the decision that a finding is keyed on `(document, month)`. **This story is a second
detector on the same rails**, not a second set of rails.

### The two constants, decided in the epic and not by this story

Recorded 2026-08-12:

> **Thresholds are hard-coded, and user-defined options are a later epic.** The 20% figure and the
> six-month window live as named constants in `core/`, not in a settings table. […] **4.3 should read
> its threshold through a single named export rather than inlining the number at the query**, so the
> later epic changes where the value comes from and not what reads it.

Three consequences the epic spells out and this story must honour:

1. Changing one is a code change with a review and a diff — *"on a fiduciary product that is closer to a
   feature than a limitation"*.
2. **The constants must appear in the finding's evidence**, because UX-DR24 forbids reassurance without a
   count of what was checked. A board member has to be able to see *20%* and *six months* without
   reading the source.
3. One named export, read at the query. Not a literal in SQL, and not two copies.

## Story

**As** a board member,
**I want** to be told when a vendor's invoice is well above what they usually charge,
**So that** a price rise is something we decided rather than something we discovered later.

## Acceptance Criteria

**AC1 — An invoice more than the threshold above the vendor's trailing six-month average is flagged.**
The window is the six months **before the invoice's own date**, not before today: re-running detection
next year must produce the same answer for the same invoice, which is what AD-13's no-op means here.

**AC2 — The finding carries the computed percentage, not the invoices it averaged (AD-6).**
Plus the average itself, the threshold, the window length, and **how many invoices went into it** —
UX-DR24's count. A percentage with no denominator is the reassurance that rule forbids.

**AC3 — A vendor with too little history is not flagged.**
An average over one invoice is not an average. Decide the minimum, record why, and test both sides of
it. This is the story's equivalent of 4.2's adjacent-invoice-numbers case: the false positive it is most
likely to ship is a brand-new vendor's second invoice.

**AC4 — What must not be flagged, as its own criterion.**
- An invoice **at** the threshold, not just over it — pick the boundary and pin it.
- An invoice below the average.
- A vendor whose history is all in the *future* relative to the invoice.
- An invoice whose amount could not be read, and one whose vendor could not be read. Story 4.2's null
  trap, in a new place: an average computed over nulls is not an average.
- **A credit.** `total_amount` can be negative (migration 006), and a large credit is not a spike.

**AC5 — Running detection twice yields one finding (AD-13).**
Same key, same rules as 4.2. Proven against a real database.

**AC6 — The finding type says what was found without overclaiming.**
Story 4.2's audit caught `duplicate_invoice` asserting what UX-DR23 forbids, and it shipped as
`possible_duplicate_invoice`. This story picks its type with that already decided — a spike is a
comparison, not an accusation.

**AC7 — One threshold, one window, one export each.**
Inlining either number at the query is what the epic's decision explicitly rules out.

**AC8 — No model, anywhere.** Grow `core/ports/finding.test.ts`'s list again.

**AC9 — Proven against a real database.** `numeric(14,2)` arithmetic, real nulls, and a real window.

## Tasks / Subtasks

- [x] **Task 1 — The rule (AC1, AC3, AC4, AC7)**
  - [x] Threshold and window as named exports in `core/detection/`.
  - [x] A pure function: given an invoice and its prior invoices, return the computed percentage over the
        trailing average, or nothing. **Exact decimal, never a float** — story 2.2's rule, and the reason
        4.2 compares decimal strings.
  - [x] The minimum-history decision, with both sides tested.

- [x] **Task 2 — Reading the history (AC1, AC4, AC9)**
  - [x] Extend `InvoiceReader` rather than adding a port: it already answers "this vendor, earlier
        documents" and this needs "this vendor, a date window". Keep the read-only shape and the reason
        for it.
  - [x] `vendor_normalised_name`, never a second rule. Bound parameters, never interpolation (AD-8).
  - [x] `test:db` for the window boundary, the nulls, and the credit.

- [x] **Task 3 — Raising it (AC2, AC5, AC6)**
  - [x] The same `(document, month)` key and the same grouping-before-raising that 4.2 arrived at —
        one finding per document per month, evidence listing each spike.
  - [x] Evidence: percentage, average, threshold, window, and the count of invoices averaged.

- [x] **Task 4 — Wiring (AC8)**
  - [x] `run-detection.ts` runs both detectors. Its docblock already explains why detection runs after
        the records are stored and why a failure must not un-read a document; **one failing detector must
        not stop the other**, and that is a decision to make and test.
  - [x] Grow the AC7/AC8 model-path list.

- [x] **Task 5 — The gate**
  - [x] `npm run lint`, `npm run build`, `npm test`, `npm run test:db`, `npx --no-install tsc --noEmit`
        against the 8-error baseline.

## Dev Notes

### What story 4.2 learned, and what it costs to ignore

- **Probe the database before deciding anything about keys or types.** Both obvious answers for 4.2's
  `subject_id` were wrong, and only a query showed it.
- **A guard nothing can break is a guard to delete.** Three turned up in 4.2's review, and the third was
  written *by the fix for the second*. Fix diffs are the highest-risk diffs in a story.
- **A source-matching test can match a line that was already there.** 4.2's wiring test passed with its
  own subject removed. If this story writes one, mutate it before believing it.
- **The AC audit before the merge request has caught something on four consecutive stories.** Run it.
- **Anything carrying a backslash goes through the editing tool**, never a shell heredoc — this bit twice
  more in 4.2, once through the Write tool because the character was typed directly.

### The shapes to copy

- `core/detection/duplicate-invoice.ts` — a pure rule with its refusals tested as their own criterion.
- `core/detection/detect-duplicates.ts` — grouping before raising, and why.
- `adapters/db/invoice-reader-postgres.ts` — the null semantics that fall out of SQL, and `to_char` for a
  calendar day.
- `core/ingestion/run-detection.ts` — the wiring contract and the swallowed-failure decision.

### Arithmetic is the new risk

4.2 compared values; this one computes them. `numeric(14,2)` averaged over six months does not divide
evenly, so **where the rounding happens is a decision**, not a detail: a percentage computed from a
rounded average differs from one computed from the exact sum. Decide it in SQL or in TypeScript, say
which, and test a case where the two would disagree.

### References

- [Source: epics.md] — FR-6's trailing-average half; the hard-coded-thresholds decision of 2026-08-12;
  UX-DR23 and UX-DR24
- [Source: ARCHITECTURE-SPINE.md] — AD-6, AD-8, AD-13
- [Source: migrations/021_finding.sql] — the register, and the sentence about what a vendor-spike finding
  stores
- [Source: 4-2-the-same-invoice-twice.md] — the review record this story's learnings come from

## Dev Agent Record

### Test Design

**Task 1 — the rule.** Behaviours: read an amount, refuse an unusable one, compare against a trailing
average, report the comparison. Failure modes classified GUARD: an amount that will not parse, a
negative amount (a credit is not a spike), priors that will not parse, priors summing to zero (a
divisor), too little history. PROPAGATE: none — the function returns `null` rather than throwing,
because "nothing to say about this invoice" is an answer and not an error. OUT-OF-SCOPE: selecting the
window, which is the reader's job, the way ordering is in `duplicatesAmong`.

**Task 2 — the reader.** The behaviour is a window, and it is arithmetic Postgres does rather than
this process. GUARD: none in TypeScript — see the deleted guard below. What the tests force instead is
each SQL semantic that looks like an omission: a null date, a null vendor, a date on the far edge, a
date one day outside it, a month end that has no counterpart six months earlier.

### Debug Log

**Where the rounding is allowed to happen (Task 1).** `numeric(14,2)` over six months does not divide
evenly, so a percentage from a rounded average is a different number from one off the exact sum. The
decision: never compute the average before comparing. With `n` priors summing to `s`, `amount /
average = amount * n / s`, so the test is `(amount * n - s) * 100 > threshold * s` — integer `BigInt`
cents, no division, no rounding. Rounding enters only when formatting for a board member, where it
cannot change what was flagged.

Finding a case where the two readings disagree took a calculation, not an intuition: against priors of
100.00 / 100.00 / 100.02 the exact threshold is 120.008 so **120.01 is flagged**, while rounding the
average to 100.01 first puts the threshold at 120.012 and 120.01 falls short. The first version of that
test asserted a pair both readings answer identically, and failed.

**Minimum history is three.** The false positive most likely to ship is a brand-new vendor's second
invoice, where the "average" is a single opening bill — the least typical invoice a vendor ever sends.
With two, one unusual bill still sets half the baseline. A judgement, not a derivation, so it is named,
tested on both sides, and carried into the evidence.

**Two assumptions in the reader's first test were wrong, and the database said so.** `vendor_normalised_name`
does *not* strip a legal suffix — `, Inc.` survives the fold — and `extraction_kind_known` permits only
invoice / statement / assessment_roll / deposit / other, so the `bank_statement` control violated a check
constraint. Both were probed and corrected rather than asserted.

**Test isolation, found by eleven failures.** The window query narrows on the vendor and the window and
nothing else — that is the point of it — so a vendor shared across tests is a window shared across tests.
The vendor is now scoped per test rather than per run.

**A guard nothing could break, deleted.** A `subject.issuedOn === null` early return stood in
`trailingInvoices` until the sensitivity check removed it and all fourteen tests still passed: `null::date
- interval` is null, every comparison against null is null, so SQL already returns an empty window. The
second such guard deleted from this file — `priorCandidates` lost `e.document_id <> $1` for the same
reason in 4.2.

### Completion Notes

Sensitivity checks run, all mutations caught except the one that led to a deletion:

| Mutation | Result |
| --- | --- |
| boundary comparison loosened (`<=` for `<`) | caught |
| minimum history dropped | caught |
| credits treated as positive | caught |
| unreadable priors counted as zero | caught |
| average rounded before comparing | caught |
| window far edge `>=` becomes `>` | caught (3 tests) |
| window near edge `<` becomes `<=` | caught |
| vendor fold replaced with raw equality | caught |
| window widened to 7 months | caught (3 tests) |
| `document_kind` filter dropped | caught |
| null-date early return removed | **survived — guard deleted** |
| grouping removed (raise per invoice) | caught |
| `invoicesChecked` counts only spikes | caught |
| threshold dropped from evidence | caught |
| window dropped from evidence | caught |
| amended counted as raised | caught |
| priors leaked into the evidence | caught (8 tests) |
| month taken from the upload, not the invoice | caught (4 tests) |
| a failing detector stops the other | caught |
| the error no longer names its detector | caught (3 tests) |
| threshold put back per spike | caught |

### The acceptance-criteria audit

It has now found something on five consecutive stories.

**AC2/AC7 — the threshold was stored twice.** `EvidenceSpike extends VendorSpike`, so each spike carried
`thresholdPercent` *and* the evidence carried it at the top level: a document with three spikes wrote the
same constant four times. The threshold describes the run, not each spike, so it is recorded once per
finding and `spikeAgainst` no longer returns it.

**A test's premise expired with that fix.** `reports the threshold it used, so a surface need not import
it` asserted exactly the behaviour that turned out to be the defect. It was not vacuous — breaking the
code failed it — which is why a mutation could never have found it. Rewritten as the record of the
change rather than deleted.

**AC1 — what can still change the answer.** Anchoring the window to the invoice's own date makes the
*window* stable, not the *contents* of the window: a backdated invoice uploaded next month falls inside
a window already computed. That is the better-informed answer and `raise` amends evidence in place, so
AD-13 holds and no board member sees a duplicate alert. Recorded in the port because the opposite
assumption is what a later story would be tempted to build a cache on.

## Review Findings

_To be filled by the review._

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-13 | Tasks 1-5 implemented test-first across ec9f1ea, 4d33461 and 9c62dd5. Acceptance-criteria audit found the threshold stored once per spike and once per finding, and one test whose premise expired with the fix. |
| 2026-08-13 | Story created after 4.2 merged as f676fb1. Written to reuse 4.2's rails — reader, register, wiring, and the `(document, month)` key — rather than build a second set. |
