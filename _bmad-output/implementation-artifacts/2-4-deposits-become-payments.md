---
baseline_commit: e09cd82f4d6b1f3e34a343c9195acce43a5c878f
---

# Story 2.4: Deposits become payments

Status: in-progress

> **Last of four stories in epic 2, the dues ledger.** 2.1 built the unit and who held it, 2.2 what it
> owes for a year, 2.3 the instalments that fall due. This records what actually arrived — the other
> side of every arrears finding epic 4 will make. It is also the only story in this epic that needs a
> document.

## Story

As a treasurer,
I want uploaded deposit records stored as payments against units,
So that what arrived can be compared with what was owed.

## Acceptance Criteria

**AC1**
**Given** an uploaded deposit document
**When** its records are extracted
**Then** each payment is stored against a unit, with its date and amount

**AC2**
**Given** a payment whose unit cannot be identified
**When** it is processed
**Then** it is held for a human in the same manner as an unrecognised vendor, and no unit is invented
**And** nothing is attributed to a unit on a guess

**AC3**
**Given** the same deposit document uploaded twice
**When** it is processed the second time
**Then** its payments replace rather than duplicate, as AD-13 requires of every derived row

## What epic 1 already provides, and what it does not

Checked against the code before this story was written, because two of the three ACs turned out to
depend on capabilities that either already exist or do not exist at all.

| Already there | Evidence |
| --- | --- |
| **Many extraction records per document** | `migrations/006_extraction.sql`: *"Many records per document, deliberately… the pilot ingests bank feeds as CSV, where a single upload is hundreds of lines."* No unique constraint on `document_id` |
| **AD-13 set-replacement on re-ingest** | `replaceDerivedRows(documentId, records)` deletes the document's rows and inserts the new reading in one transaction. **AC3 is largely already satisfied** — this story must extend it to payments, not invent it |
| **A human-resolution pattern** | `quarantine_item` + `core/ports/quarantine-queue.ts` (read-only) + `app/quarantine/actions.ts`. AC2 says "in the same manner as", and this is the manner |

| Missing | Consequence |
| --- | --- |
| **No `deposit` document kind** | `DOCUMENT_KINDS` is `invoice, statement, assessment_roll, other`. A deposit is none of them |
| **No unit field on an extracted record** | `ExtractionRecord` is `documentKind, vendorName, documentNumber, issuedOn, totalAmount, currency`. Nothing says *which unit a line pays for* |
| **No `PAYMENT` table** | Named in the ERD since planning; never built |

## The two decisions taken before implementing

Settled by Matt on 2026-08-07, because each changes the schema and one of them re-opens a separation
story 2.1 deliberately made.

### A deposit line carries its unit in a new `unit_reference` column on `extraction`

Nullable, and populated only for deposit lines — most document kinds have no unit.

**The alternative that was refused:** reusing `vendor_name` to hold the unit number. It needs no
migration at all, and it feeds unit identity through `vendor_normalised_name()` — which is precisely
the coupling story 2.1 refused, in as many words: *"a later change to how vendor names are matched
would silently change which units are considered the same unit. Nobody making that change would look
here."*

The reference is resolved to a `unit_id` when the payment is written. `extraction` keeps the raw
reference; `payment` keeps the resolved unit.

### Payments that cannot be resolved go to a parallel `held_payment` table

Not into `quarantine_item`. That table's `normalised_name` is `generated always as
(vendor_normalised_name(extracted_name))` — a stored generated column — so holding unit references
there would either apply the vendor normaliser to a unit number, or require dropping and recomputing
a generated column on a table epic 1 already ships.

`held_payment` uses `unit_normalised_number()`, which is what migration 011 built for exactly this and
pinned to `search_path = pg_catalog, pg_temp`.

**The cost, recorded:** epic 3 has two quarantine surfaces to read rather than one. That is the price
of keeping unit identity and vendor identity separate, and 2.1 already paid it once.

## Tasks / Subtasks

- [ ] **Task 1 — Migration 014: a deposit is a kind of document, and a line can name a unit** (AC1)
  - [ ] Add `deposit` to the `extraction_kind_known` check constraint **and** to `DOCUMENT_KINDS` in
        `core/extraction/record.ts`. `core/extraction/record.test.ts` already reads migration 006 and
        compares the lists both ways — it will fail until both sides agree, which is the point.
  - [ ] **The parity test reads migration 006.** Adding the value in 014 means the parser must find
        the constraint's *current* definition, not 006's text. Decide and record how: either read
        `pg_constraint` (the live truth) or have 014 restate the whole constraint. A test that keeps
        reading 006 after 014 changes the constraint is a test that has stopped watching anything.
  - [ ] `alter table extraction add column unit_reference text`, nullable, with a length check in the
        two-part shape migration 009 arrived at (`char_length(x) <= n` **and**
        `char_length(btrim(x, …)) >= 1` when present).
  - [ ] Migration-text test using the shared `executable()` from `migrations/executable-sql.ts`.
- [ ] **Task 2 — Migration 015: the payment** (AC1, AC3)
  - [ ] `payment`: `unit_id` referencing `unit(id)`, `document_id` referencing `document(id)` **on
        delete cascade**, `paid_on date`, `amount numeric(14,2)`.
  - [ ] `numeric(14,2)`, matching `extraction.total_amount` and `assessment.annual_amount` exactly.
        This is the column epic 4 compares against an assessment, and the whole money decision of
        story 2.2 exists so that comparison needs no conversion.
  - [ ] A positive-amount check. A deposit of zero is not a payment; a negative one is a reversal and
        is **out of scope** — record that rather than allowing it silently.
  - [ ] `on delete cascade` from `document`, matching `extraction`: a payment without its document is
        debris that still satisfies a foreign key.
  - [ ] `grant select on payment to watchdog_reader` — SELECT only, per AD-4.
- [ ] **Task 3 — Migration 016: what could not be attributed** (AC2)
  - [ ] `held_payment`: `document_id` (cascade), `unit_reference text not null`,
        `normalised_reference` generated from **`unit_normalised_number(unit_reference)`**, `paid_on`,
        `amount`, `created_at`.
  - [ ] Deliberately **not** unique on `(document_id, normalised_reference)`: one deposit document can
        legitimately carry two unresolved lines for the same unknown reference on different dates.
        Say so, and prove it with a test that inserts both.
  - [ ] `grant select` to `watchdog_reader`. No write grant — AD-4.
- [ ] **Task 4 — Resolving a line to a unit, or holding it** (AC1, AC2)
  - [ ] A **pure** function in `core/` deciding, for one extracted deposit line, whether it resolves:
        it takes the line and a lookup result, never a database. No I/O, testable without one.
  - [ ] **Nothing is attributed on a guess.** Matching is exact on `unit_normalised_number`, the same
        folding migration 011 defines. No fuzzy matching, no nearest-match, no "one candidate so it
        must be it". If the fold does not match exactly, it is held.
  - [ ] A line missing a unit reference, an amount, or a date is held rather than dropped — a payment
        the system silently forgot is worse than one waiting for a human.
- [ ] **Task 5 — Writing them, and replacing them on re-ingest** (AC1, AC3)
  - [ ] One transaction per document: delete this document's payments **and** its held payments, then
        insert the new reading of both. AD-13 is set-shaped, and a partial replacement that dropped
        one table and not the other would leave a document half-described.
  - [ ] **Prove the replacement from outside**: ingest twice, assert the counts do not double and the
        second reading's values are the ones present.
  - [ ] Prove a failure midway leaves the previous reading intact, not a document holding nothing.
        `extraction-repository-postgres.ts` records this hazard for its own path.
  - [ ] Reader-connection read port for held payments, following
        `core/ports/quarantine-queue.ts` — read-only, with the reason in the header.

## Dev Notes

### Learnings that apply directly

**Ten guards that proved nothing were found across epic 2, most of them written while fixing a
previous one.** The shapes that will recur here:

1. **`toThrow(SomeType)` cannot tell a contract from a crash.** Three instances in this epic. Assert
   the message.
2. **A test asserting only inside a `catch`** passes with zero assertions if the throw stops.
3. **A cross-check that matches a *name*** — an index's name, a constraint's name — proves nothing
   about the column it governs. Match `pg_get_constraintdef` or the column in its parentheses.
4. **Mutate one thing at a time.** Story 2.2 found a check constraint whose removal *nothing* could
   detect, because a mutation had dropped two at once.
5. **Choose values that discriminate.** `Number('83.34') * 100` is exactly 8334, so a float bug
   survives it; `0.29` does not. Pick the input that can actually fail.
6. **A source-reading control must assert a phrase that is genuinely present**, on **one line** —
   docblocks wrap, and two stories lost time to a phrase that spanned two lines.

### What the money convention requires here

`amount` is `numeric(14,2)` and crosses every boundary as a **decimal string**. `core/assessment/minor-units.ts`
exists if arithmetic is needed; it converts by string manipulation, never through a float. Epic 4
compares `payment.amount` against `assessment.annual_amount` directly, and story 2.2's decision is
what makes that a comparison rather than a conversion.

### Testing standards

- Database tests prove constraints by violating them and asserting the SQLSTATE; migration-text tests
  prove the statements say what the prose claims, comments stripped with the **shared** helper.
- Per-file `RUN_PREFIX` on every test that writes to a shared table. Four files already write to
  `unit`.
- Gate: `npm run lint`, `npm run build`, `npm test`, `npm run test:db`, and
  `npx --no-install tsc --noEmit` against its **baseline of 8**.

### Project Structure Notes

| Path | Kind |
| --- | --- |
| `migrations/014_deposit_kind_and_unit_reference.sql` | NEW |
| `migrations/015_payment.sql` | NEW |
| `migrations/016_held_payment.sql` | NEW |
| `core/extraction/record.ts` | UPDATE — `deposit` kind, `unitReference` field |
| `core/payment/resolve-line.ts` | NEW — the pure decision |
| `core/ports/held-payment-queue.ts` | NEW — read-only |
| `adapters/db/payment-repository-postgres.ts` | NEW — writer, set-replacement |
| `adapters/db/held-payment-queue-postgres.ts` | NEW — reader |

### References

- `_bmad-output/planning-artifacts/epics.md` — Epic 2, Story 2.4, and the dues domain detail.
- `ARCHITECTURE-SPINE.md` — Money (amended 2026-08-07), Dates, AD-4, AD-13.
- `migrations/006_extraction.sql` — many records per document, and the set-replacement rationale.
- `migrations/010_quarantine_item.sql`, `core/ports/quarantine-queue.ts` — the human-resolution
  pattern AC2 points at.
- `_bmad-output/implementation-artifacts/2-1-units-and-who-holds-them.md` — why unit identity has its
  own normalisation.

## Dev Agent Record

### Agent Model Used

### Test Design

### Debug Log References

### Review Findings

### Completion Notes List

### File List

### Change Log

- 2026-08-07 — Story created. Two gaps in epic 1 were found before writing it: an extracted record has
  no unit field, and there is no `deposit` document kind. Matt chose a new `unit_reference` column on
  `extraction` over reusing `vendor_name`, and a parallel `held_payment` table over generalising the
  vendor-shaped `quarantine_item` — both to keep unit identity separate from vendor identity, as story
  2.1 required. Status -> ready-for-dev.
