---
baseline_commit: 1859d7c
merge_request: 54
---

# Story 4.2: The same invoice, twice

Status: review

## Why this story exists

Story 4.1 built the register and put nothing in it. This is the first detector — the first code that
looks at what the association has ingested and says *this looks wrong*. It is also the story SM-2 is
measured against:

> **SM-2 claims *100%* of mathematically exact duplicates are flagged; that is a claim only a
> deterministic detector can be held to.**

That number is the reason there is no model anywhere in this story. A reasoning model cannot be held
to 100%, and the epic's independence from Epic 3 is *"a property to protect, not an accident"*. It
holds only while SQL identifies the finding and templated prose describes it.

> **FR-6** — "Newly uploaded vendor invoices are automatically compared against historical payment
> data and vendor averages. **Exact duplicates (matching amount and date) and fuzzy duplicates
> (similar invoice number, identical amount) are flagged**, as are invoices exceeding a vendor's
> trailing 6-month average by a defined threshold."

The trailing-average half is **story 4.3**. This story is duplicates only.

### The thing to know before writing any code

**There is no invoice table, and this story does not add one.** An invoice is a row in `extraction`:

| column | what it holds |
| --- | --- |
| `document_kind` | `'invoice'` — the vocabulary is in migration 014, not 006 |
| `vendor_name` | the vendor **as the document spelled it**, nullable, never folded |
| `document_number` | the invoice number, nullable |
| `issued_on` | the invoice date, nullable |
| `total_amount` | `numeric(14,2)`, nullable, **negative means a credit to the association** |

Three consequences the dev agent must carry:

1. **Every field this detector compares is nullable.** An extraction with no `issued_on` and no
   `total_amount` is a legitimate row — it is what the extractor produces when it could not read
   them. A comparison that treats null as a value will match two unreadable invoices to each other
   and report a duplicate that is really two failures to read. Decide what null does, and test it.
2. **There is no `vendor_id` anywhere.** `extraction.vendor_name` is raw text; the `vendor` table is
   populated separately by story 1.6's quarantine resolution and nothing links the two. "The same
   vendor" therefore means `vendor_normalised_name(vendor_name)` — migration 009's function, which
   `vendor` and `quarantine_item` both already generate their comparison keys from. Using it is what
   makes "the same vendor" mean the same thing here as it does everywhere else; inventing a second
   rule is the defect the whole of epic story 1.6 exists to prevent, wearing a new hat.
3. **`total_amount` can be negative.** Migration 006 says so explicitly: *"Negative means a credit to
   the association […] Stated here so the anomaly detection that reads it later reads a decision
   rather than an accident."* That sentence was written for this story. Two matching credits are not
   a duplicate payment, and whatever is decided must be decided out loud.

### Deterministic, and what that forbids

No import may reach `core/answer`, `adapters/agent`, the catalog, or a model SDK. Story 4.1 asserts
this over the two files it shipped, in `core/ports/finding.test.ts` under `epic 4 does not depend on
epic 3` — two constants named `PORT` and `ADAPTER`, with specifiers resolved to paths rather than
matched as text, because `'core/answer'` as a substring misses `'../answer/grounded-answer'`.

That test's own comment says *"When 4.2 adds one, this list grows with it."* **Grow it.**

## Story

**As** a board member,
**I want** to be told when the association is about to pay an invoice it appears to have paid already,
**So that** the money leaves once.

## Acceptance Criteria

**AC1 — An exact duplicate is flagged: same vendor, same amount, same date.**
Two invoices from one vendor for the same amount on the same day. This is the case SM-2's 100% is
about, so it is the case that must never be missed.

**AC2 — A fuzzy duplicate is flagged: same vendor, identical amount, the same invoice number written
differently.**
`INV-1001`, `inv 1001`, `INV1001` and `INV-0001001` are one invoice number typed four ways. The amount
must be *identical* — FR-6 says so, and it is what keeps this from firing on a vendor's ordinary
billing.

**A bare `0001001` is not one of them**, and the correction is worth keeping: an earlier draft of this
story claimed it was. Any rule that folds `0001001` onto `INV-1001` has to discard a leading
non-numeric prefix, and that same rule folds `CR-1001` — a credit note — onto the invoice it credits.
A false positive that pairs an invoice with its own reversal is worse than the one AC3 guards against,
because the two documents genuinely are about the same money.

**AC3 — What must not be flagged, asserted as its own criterion.**
- **Adjacent invoice numbers.** `INV-1001` and `INV-1002` are one character apart and are certainly
  two different invoices. Any rule based on edit distance flags them; that is why the rule is
  normalisation, not distance. This is the false-positive case the story is most likely to ship.
- Same amount and date, **different vendors**.
- Same vendor and number, **different amounts**.
- An invoice compared **against itself** — one row is not a pair.
- Two invoices whose amount or date could not be read. Null is not a value that matches another null.

**AC4 — Running detection twice yields one finding (AD-13).**
The key is `(finding_type, subject_id, period)` and story 4.1 made re-raising a no-op at the database.
This story has to choose a `subject_id` and a `period` that *make that guarantee mean something* — see
Dev Notes. Proven against a real database, not asserted.

**AC5 — The finding carries what was compared, as derived values (AD-6).**
Not the invoice rows: the vendor as displayed, the amount, the two dates, the two document ids, and
the two invoice numbers as written. UX-DR24 forbids reassurance without a count of what was checked,
so the evidence has to support a sentence that says what was compared. AD-8: extracted strings are
data, escaped on output, **never interpolated into SQL or into prose**.

**AC6 — The copy says "possible", and the detector's own vocabulary says it too.**
UX-DR23 forbids implying certainty the system lacks. *"These two rows match on amount and date"* is
not the claim *"you paid twice"* — an association can legitimately pay one vendor the same amount on
the same day. No surface is built here, but the `finding_type` and the evidence keys are read by 4.5
and 4.8 and will become that copy.

**AC7 — Detection runs when an invoice is ingested, and the production call site is proven to wire it.**
A detector nothing calls flags nothing. `core/ingestion/extract-document.ts` takes its collaborators
by injection, and `payment-wiring.test.ts` and `roll-wiring.test.ts` are the precedent: an optional
dependency whose absence is *"a real gap rather than a neutral default"*, with a test asserting the
production call site supplies it.

**AC8 — No model, anywhere.**
Extend story 4.1's assertion to this story's files rather than writing a second one.

**AC9 — Proven against a real database.**
`test:db`. The comparison is SQL over real rows with real nulls and real `numeric(14,2)` values, and a
mock cannot be wrong about any of those.

## Tasks / Subtasks

- [x] **Task 1 — The invoice-number rule (AC2, AC3)**
  - [x] A pure function in `core/`, no I/O, exhaustively tested. Case, whitespace, punctuation and
        leading zeros fold; **nothing else does**.
  - [x] Tests that name the trap: `INV-1001` vs `INV-1002` must **not** match, and a test comment
        should say why edit distance was refused. This is the assertion that stops a later
        "improvement" from introducing the false positive.
  - [x] Decide what an absent or empty `document_number` does. A null invoice number cannot make a
        fuzzy match; whether it can still make an *exact* one is a separate question with a separate
        answer.

- [x] **Task 2 — The detector (AC1, AC2, AC3, AC5, AC9)**
  - [x] The comparison as **SQL with bound parameters**, never interpolation (AD-8). Vendor identity
        through `vendor_normalised_name`, not a second rule.
  - [x] A port for it, following `core/ports/finding.ts`'s shape: the capability a caller holds is the
        design. The detector needs to *read* invoices and *raise* findings — those are two ports it
        already has or can be given, not one new one that does both.
  - [x] `test:db` with fixture rows covering every AC3 case, because a detector is only as good as
        what it declines to flag.

- [x] **Task 3 — Raising the finding (AC4, AC5, AC6)**
  - [x] `subject_id` and `period` decided **with the reasoning written into the code**, the way 4.1
        recorded the `daterange` decision. Re-running detection over unchanged data must produce zero
        new rows, proven.
  - [x] `finding_type` as `verb_noun`, matching `finding_type_is_verb_noun`.
  - [x] Evidence as an object of derived values (AD-6), holding what a board member needs to see the
        comparison.

- [x] **Task 4 — The wiring (AC7)**
  - [x] The dependency added to `ExtractDocumentDependencies` and run when an invoice is written.
  - [x] A wiring test asserting the production call site supplies it, per `payment-wiring.test.ts`.
  - [x] Detection failing must not lose the ingestion. Decide whether a failed detection fails the
        upload or is recorded and moved past — and say why in the code.

- [x] **Task 5 — The gate**
  - [x] `npm run lint`, `npm run build`, `npm test`, `npm run test:db`, `npx --no-install tsc --noEmit`
        against the 8-error baseline.
  - [x] Extend `core/ports/finding.test.ts`'s AC7 assertion to this story's production files (AC8).

## Dev Notes

### The two decisions this story must make, as 4.1 made `period`

**What is a duplicate finding *about*?** `subject_id` is one uuid and a duplicate is two invoices.
Migration 021's comment says *"a duplicate-invoice finding is about a document"* — which is a starting
position, not a settled one, and if it is wrong this story should amend that comment rather than work
around it. Whatever is chosen has to survive AD-13: re-running detection must land on the same key,
and two genuinely different duplicate pairs must not collapse onto one row. Consider what happens when
one invoice duplicates two earlier ones.

**What is its `period`?** It is `not null` and part of the key, and `finding_period_is_bounded` refuses
an empty, unbounded or infinite range. The invoice's month is the obvious answer; check it against the
case where the two invoices fall in *different* months before adopting it.

**Probe the database rather than reasoning about it.** Story 4.1's `period` decision was made with a
live query, and the same probe found the empty-range collapse that reasoning had missed. That is the
recommended method here too.

### The shapes to copy

- **`core/ports/finding.ts`** — a port whose absent methods are the design, with the reasoning
  written down. `FindingRegister.raise()` is what this story calls; `RaisedFinding.wasAlreadyKnown`
  is how it can tell a new finding from a re-raise without a second query.
- **`adapters/db/finding-postgres.ts`** — the upsert, and `writerPool()` from `adapters/db/pool.ts`.
  **Do not create a new pool.**
- **`core/ingestion/record-payments.ts` and `payment-wiring.test.ts`** — a derived-record writer and
  the test that proves production wires it.
- **`core/vendor/name.ts`** — how this project already normalises a vendor name in TypeScript, if a
  TypeScript-side fold is needed at all.
- **`migrations/009_vendor.sql`** — `vendor_normalised_name`, the SQL function that defines vendor
  identity for the whole system.

### Learnings that apply directly, from 4.1 and its review

- **A property held by the application's habits is not held.** Eight review findings on 4.1 were one
  shape: the port could not do the wrong thing, so nobody checked whether the *table* could. A
  detector that "only ever writes findings one way" is the same claim.
- **A test that accepts two answers names neither.** 4.1 asserted an error code as `23514 or P0001`;
  it reads as thoroughness and cannot say which gate fired.
- **Controls can pass on prose.** 4.1's "did we read any imports?" control was satisfied by a comment
  containing the word `from` followed by a quoted string. If this story adds a scanning test, blank
  comments first with `neutralise` from `core/ports/declared-members.ts`.
- **Look for the sibling.** Two 4.1 findings were the same defect in a second file, found only because
  a reviewer looked again. When something is fixed, grep for its shape.
- **Anything carrying a backslash** goes through the editing tool, never a shell heredoc.

### What this story deliberately does not build

No dashboard, no detail page, no email — 4.5, 4.6 and 4.8. No trailing-average or threshold logic;
that is 4.3, and the epic's decision that thresholds are hard-coded named constants in `core/` belongs
to that story. If this story renders anything or reads a settings table, it has grown past its purpose.

### If this has to be cut

The fuzzy rule (AC2) could ship separately from the exact rule (AC1) if the story proves too large —
AC1 alone is what SM-2's 100% is measured against, and AC3's false-positive guards belong with
whichever half ships. Nothing else here is severable: a detector that is not wired flags nothing, and
one that re-raises on every upload is the defect story 4.1 was ordered first to prevent.

### References

- [Source: epics.md] — Epic 4's story spine; FR-6; SM-2 and why determinism is a testability property;
  the two decisions of 2026-08-12 on hard-coded thresholds; UX-DR23 and UX-DR24 on the voice
- [Source: ARCHITECTURE-SPINE.md] — AD-13 (keying and idempotency), AD-6 (derived values, not
  ingredients), AD-8 (extracted strings escaped, never interpolated)
- [Source: migrations/006_extraction.sql, 014_deposit_kind_and_unit_reference.sql] — what an invoice is
- [Source: migrations/009_vendor.sql] — `vendor_normalised_name`, and what "the same vendor" means
- [Source: migrations/021_finding.sql] — the register, its key, and its one-way lifecycle
- [Source: _bmad-output/implementation-artifacts/4-1-a-finding-and-the-life-it-leads.md] — the review
  record this story's learnings come from

## Dev Agent Record

### The identity decision, settled by probe — both obvious answers are wrong

`subject_id` is one uuid and a duplicate is a pair. The two candidates each fail, and the database
said so rather than reasoning:

```
{"multiInvoiceDocuments": [{"document_id": "019fe8de…", "invoice_rows": "3"}],
 "extractionIdDefault":   {"column_default": "uuidv7()"},
 "documentHasStableKey":  ["content_hash", "uploaded_at"]}
```

- **`extraction.id` is not stable.** It defaults to `uuidv7()`, and migration 006 replaces a
  document's rows set-shaped on re-ingest — *"every record this document produced is deleted and the
  new reading inserted"*. So the same invoice gets a new id every upload, the key changes, and
  re-ingestion raises **a second finding for a finding already raised**. That is the sentence AD-13
  forbids, and the reason story 4.1 was ordered first. An id that looks like the natural subject is
  the one that breaks the guarantee the epic is built on.
- **`document_id` alone collapses.** A real document in this database carries **three** invoice rows,
  and migration 006 says that is the design, not an accident. Three duplicates on one upload would
  key onto one row and two would be lost.

**Decided: the subject is the document, the period is the calendar month of the invoice's
`issued_on`, and the collapse is the design.** One finding per document per month, whose evidence
lists *every* matching pair. Nothing is lost — the pairs are in the evidence — and it is also the
truer sentence for a board member: "this upload contains invoices you appear to have paid already" is
one thing to review, not three. It keeps migration 021's comment (*"a duplicate-invoice finding is
about a document"*) correct rather than needing an amendment.

`document_id` and `uploaded_at` are both stable across re-ingest, so re-running detection lands on the
same key and AD-13's no-op holds — which is the property that has to be proven, not assumed.

**Where an invoice carries no date**, the period falls back to the month the *document* was uploaded.
FR-6's fuzzy rule is "similar invoice number, identical amount" and names no date, so requiring one
would narrow the criterion; and "when this was noticed" is an honest answer for a window the invoice
refuses to state. The fallback is a decision to write down, not a default to slip in.

### Test Design — Task 1, `normaliseInvoiceNumber`

One behaviour: fold an invoice number to a comparison key. No I/O, total on any string.

| Failure mode | Class | Forced by |
| --- | --- | --- |
| Two invoices with **no** number fold to equal keys and fuzzy-match each other | GUARD | `''` in, `''` out; the caller must never match on an empty key, and a test says so |
| Punctuation-only (`---`, `#`) folds to `''` — the same fact as absent, reached differently | GUARD | asserted equal to the empty case |
| An all-zero number (`0`, `000`) is stripped to `''` and silently becomes "no number" | GUARD | keeps one digit |
| Non-ASCII case folding: `'İ'.toLowerCase()` is **two** code points, so a key can grow | GUARD | folds `A`–`Z` only, exactly as `normaliseVendorName` does |
| Edit-distance thinking: `INV-1001` vs `INV-1002` | GUARD | asserted **not** equal |
| Prefix stripping: `0001001` vs `INV-1001`, and worse, `CR-1001` vs `INV-1001` | GUARD | asserted **not** equal |
| Leading zeros inside the number: `INV-0001001` vs `INV-1001` | GUARD | asserted equal |
| Full-width digits from a PDF extractor never match their ASCII twins | OUT-OF-SCOPE | recorded: a *missed* duplicate, not a false one. Conservative in the safe direction |
| A 64-character bound and longer input | OUT-OF-SCOPE | `extraction_document_number_length` bounds it at the database |

**The fold is deliberately narrower than "alphanumeric only".** Characters outside ASCII are kept
rather than dropped, so `ÁBC-1001` and `ABC-1001` stay different. Dropping them would fold unknown
characters together and manufacture matches; keeping them can only miss one. For a detector whose
false positives cost a board member's trust, and where SM-2's 100% is promised on the *exact* rule
(AC1) rather than this one, missing is the right direction to fail.

Separators come from `NAME_FOLD_WHITESPACE` in `core/vendor/name.ts` rather than a second list —
the same argument migration 010 makes for generating `quarantine_item.normalised_name` from
migration 009's function.

## Review Findings

### Argus, round 1

Clean over the whole branch diff. No correctness, security or maintainability findings.

### The AC audit, which found AC6

**AC6 was satisfied by half the vocabulary.** The evidence reasons hedged correctly from the start —
`same-amount-and-date` states what was compared rather than what happened — and the `finding_type` did
not: `duplicate_invoice` asserts the thing UX-DR23 forbids asserting.

The AC names the type explicitly as the thing that must carry the hedge, because 4.5 renders it as a
heading and 4.8 puts it in an email subject. A type that claims a duplicate puts the claim in front of
a board member however carefully the surrounding copy hedges. Renamed to
`possible_duplicate_invoice`, with the reason at the constant.

Cheap now, expensive later: three stories read this value, and one of them mails it.

### AC audit — the rest

| AC | Verdict |
| --- | --- |
| AC1 exact duplicate | pure matcher and `test:db`, the case SM-2's 100% is measured against |
| AC2 fuzzy duplicate | both, including `INV-0002002` against `inv 2002` through the database |
| AC3 what must not be flagged | six refusals, each its own case, plus a positive control |
| AC4 running twice yields one | proven to be `finding_identity`'s doing: dropping it fails the case |
| AC5 evidence as derived values | count checked, rule named, pairs as written; SQL fully parameterised |
| AC6 the copy says possible | **gap found and closed** — see above |
| AC7 detection runs, wiring proven | both call sites, read as source; removing either fails |
| AC8 no model anywhere | story 4.1's list grown to this story's six production files |
| AC9 real database | 752 `test:db` |

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-12 | Story created after 4.1 merged as 1859d7c. Written against the discovery that there is no invoice table — an invoice is an `extraction` row — and that every field this detector compares is nullable. |
| 2026-08-12 | Implemented. `period` and `subject_id` decided by probe — both obvious answers fail. The invoice-number rule is normalisation rather than edit distance, because `INV-1001` and `INV-1002` are one character apart and certainly different invoices. Gate green: 2357 tests, 752 `test:db`. |
