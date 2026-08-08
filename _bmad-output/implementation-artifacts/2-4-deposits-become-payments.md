---
baseline_commit: e09cd82f4d6b1f3e34a343c9195acce43a5c878f
merge_request: 26
---

# Story 2.4: Deposits become payments

Status: review

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

- [x] **Task 1 — Migration 014: a deposit is a kind of document, and a line can name a unit** (AC1)
  - [x] Add `deposit` to the `extraction_kind_known` check constraint **and** to `DOCUMENT_KINDS` in
        `core/extraction/record.ts`. `core/extraction/record.test.ts` already reads migration 006 and
        compares the lists both ways — it will fail until both sides agree, which is the point.
  - [x] **The parity test reads migration 006.** Adding the value in 014 means the parser must find
        the constraint's *current* definition, not 006's text. Decide and record how: either read
        `pg_constraint` (the live truth) or have 014 restate the whole constraint. A test that keeps
        reading 006 after 014 changes the constraint is a test that has stopped watching anything.
  - [x] `alter table extraction add column unit_reference text`, nullable, with a length check in the
        two-part shape migration 009 arrived at (`char_length(x) <= n` **and**
        `char_length(btrim(x, …)) >= 1` when present).
  - [x] Migration-text test using the shared `executable()` from `migrations/executable-sql.ts`.
- [x] **Task 2 — Migration 015: the payment** (AC1, AC3)
  - [x] `payment`: `unit_id` referencing `unit(id)`, `document_id` referencing `document(id)` **on
        delete cascade**, `paid_on date`, `amount numeric(14,2)`.
  - [x] `numeric(14,2)`, matching `extraction.total_amount` and `assessment.annual_amount` exactly.
        This is the column epic 4 compares against an assessment, and the whole money decision of
        story 2.2 exists so that comparison needs no conversion.
  - [x] A positive-amount check. A deposit of zero is not a payment; a negative one is a reversal and
        is **out of scope** — record that rather than allowing it silently.
  - [x] `on delete cascade` from `document`, matching `extraction`: a payment without its document is
        debris that still satisfies a foreign key.
  - [x] `grant select on payment to watchdog_reader` — SELECT only, per AD-4.
- [x] **Task 3 — Migration 016: what could not be attributed** (AC2)
  - [x] `held_payment`: `document_id` (cascade), `unit_reference text not null`,
        `normalised_reference` generated from **`unit_normalised_number(unit_reference)`**, `paid_on`,
        `amount`, `created_at`.
  - [x] Deliberately **not** unique on `(document_id, normalised_reference)`: one deposit document can
        legitimately carry two unresolved lines for the same unknown reference on different dates.
        Say so, and prove it with a test that inserts both.
  - [x] `grant select` to `watchdog_reader`. No write grant — AD-4.
- [x] **Task 4 — Resolving a line to a unit, or holding it** (AC1, AC2)
  - [x] A **pure** function in `core/` deciding, for one extracted deposit line, whether it resolves:
        it takes the line and a lookup result, never a database. No I/O, testable without one.
  - [x] **Nothing is attributed on a guess.** Matching is exact on `unit_normalised_number`, the same
        folding migration 011 defines. No fuzzy matching, no nearest-match, no "one candidate so it
        must be it". If the fold does not match exactly, it is held.
  - [x] A line missing a unit reference, an amount, or a date is held rather than dropped — a payment
        the system silently forgot is worse than one waiting for a human.
- [x] **Task 5 — Writing them, and replacing them on re-ingest** (AC1, AC3)
  - [x] One transaction per document: delete this document's payments **and** its held payments, then
        insert the new reading of both. AD-13 is set-shaped, and a partial replacement that dropped
        one table and not the other would leave a document half-described.
  - [x] **Prove the replacement from outside**: ingest twice, assert the counts do not double and the
        second reading's values are the ones present.
  - [x] Prove a failure midway leaves the previous reading intact, not a document holding nothing.
        `extraction-repository-postgres.ts` records this hazard for its own path.
  - [x] Reader-connection read port for held payments, following
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

**The under-collection anomaly recurred, and this time it was caught.**

Task 4's gate run reported **`68 passed | 11 skipped (76)`, 1410 tests** and exited **green**. Three
consecutive runs immediately afterwards, on an unchanged tree, reported **`(79)`, 1432 tests** — and
a JSON-reporter run confirmed **79 files collected, 0 missing** against the 78 tracked on disk plus
the new one.

So three files and twenty-two tests silently did not run, and the summary still said green.

This is the **second** occurrence. Story 2.1 recorded the first: `49 passed | 9 skipped (58)`, 1167
tests, where the true figure was `(62)` and 1192. Two epics apart, same shape, still unreproduced on
demand.

**Practical consequence, restated because it has now paid off twice:** read the *file count*, not
only pass/fail. It is what caught this. With no CI, a green run that executed three fewer files is
indistinguishable from a green run — except by the number.

The figures quoted for tasks 1-3 were taken from runs whose counts were consistent with the files
present at the time, so they stand.

### Review Findings

### Completion Notes List

**Task 5 — writing them, and replacing them on re-ingest.** Done.

*The replacement follows `extraction-repository-postgres.ts` deliberately, including the part that
is easy to leave out.* It locks the parent `document` row before touching anything — because the
deletes only serialise two replacements when there are rows to lock, and on a document holding none
both transactions would delete nothing, both insert, and both commit, leaving it holding two
readings. The `document` row exists either way.

*Both tables move together, and that is the assertion the signature exists for.* A line either became
a payment or was held; they are one reading. Clearing `payment` and not `held_payment` would leave a
document described half by this reading and half by the last — and after a treasurer names a unit,
the same money would appear twice: once as a payment, once as an open question.

*The empty-set bar is the **combined** set.* A deposit whose every line was held is an ordinary
outcome — an unfamiliar reference format, a new roll — and refusing it would reject a real document.
`replace(id, [])` is still refused, for the reason the extraction repository records.

*Sensitivity, each restored:*

| Mutation | Tests that failed |
| --- | --- |
| `held_payment` not cleared | the re-ingest count **and** `clears held payments too when the second reading resolves them` |
| `where document_id` dropped from the payment delete | 4, including the cross-document case |
| Empty-set refusal removed | `refuses an entirely empty reading` |

A failure midway is proved to leave the previous reading intact, not a document holding nothing: a
treasurer can see that last month's figures are old, and cannot see figures that are absent.

*Gates, from three consecutive unit runs rather than one:* lint 0 errors and 1 pre-existing warning,
`tsc --noEmit` **8** (= baseline), build clean, `npm test` **81 files / 1440 passed**,
`npm run test:db` **27 files / 491 passed**.

**Task 4 — resolving a line, or holding it.** Done. A pure function; the directory lookup is a
parameter, so it is testable without a database and cannot consult one by accident.

*The decision is deliberately dull, and the tests exist to keep it that way.* Every helpful-looking
variant is a way of attributing money to the wrong person: nearest match, prefix match, "only one
candidate so it must be that one", folding a leading zero. Each has its own test asserting the line
is **held** instead.

*Story 1.6d's defect, guarded against explicitly.* A directory implemented as a plain object answers
`constructor` with a function and `__proto__` with an object, and `?? null` catches neither — which
is exactly what `suggestions[key] ?? []` did in 1.6d. The guard is `typeof unitId !== 'string'`, and
replacing it with a truthiness check fails both cases.

*And an inert case in my own parameterised test, caught by the sensitivity check.* The list was
`['__proto__', 'constructor', 'toString']`, and the mutation failed only **two** of the three.
`toString` folds to `tostring`, which is not a prototype key, so that case resolved to null through
the ordinary path and could not fail whatever the code did. Removed, with the reason recorded — the
two that remain survive folding precisely because they are already lower-case.

*Sensitivity, each restored:*

| Mutation | Tests that failed |
| --- | --- |
| Truthiness instead of `typeof` | both prototype-key cases |
| Leading zeroes folded | `holds a reference differing only by a leading zero` |
| Blank-reference early return dropped | both missing-reference cases **and** `never consults the directory` |

**Task 3 — migration 016, what could not be attributed.** Done. `held_payment` folds its reference
with **`unit_normalised_number()`**, the function migration 011 defines for unit identity.

*The separation is cross-checked two independent ways:* the migration text asserts what the
generated column **calls**, and a database test reads the column's actual expression out of
`pg_attrdef`. A migration saying the right thing and a column doing it are different facts, and only
the second survives someone editing the schema by hand.

*Deliberately not unique on `(document_id, normalised_reference)`.* One deposit can carry two
unresolved lines for the same unknown reference on different dates — a unit paying twice under a
reference nobody recognises yet. A unique constraint would reject the second line and **the money it
represents would vanish from the ledger with nobody told**. Holding a duplicate question is
recoverable; dropping a payment is not. Proved by inserting both.

*Sensitivity, each restored:*

| Mutation | Tests that failed |
| --- | --- |
| Reference folded by `vendor_normalised_name` | the migration-text assertion **and** the `pg_attrdef` cross-check |
| A unique index on `(document_id, normalised_reference)` | the text assertion and both behavioural cases, including the two-lines-one-reference one |

**Task 2 — migration 015, the payment.** Done. `numeric(14,2)`, cascading from the document and not
from the unit, positive amounts only.

*The assertion that protects epic 4* is not the round trip — it is the one comparing
`payment.amount` and `assessment.annual_amount` in `information_schema` **against each other**.
Changing one and not the other fails there, rather than in an arrears finding a year later.

*Two decisions recorded rather than left implicit:* the cascade is from the **document** and
deliberately not from the unit — deleting a unit must not silently erase what it paid — and a
negative amount is refused because **reversals are out of scope**, needing a decision about whether
they offset a payment or stand alone.

*Sensitivity, each restored by dropping the table and re-running the migration:*

| Mutation | Tests that failed |
| --- | --- |
| `amount` at `numeric(20,4)` | 6, including the cross-check **and** the parity test against `assessment.annual_amount` |
| Positive-amount check dropped | the zero and the negative case |
| Document cascade removed | the migration-text assertion and `goes when its document goes` |

**Task 1 — migration 014, the deposit kind and the unit reference.** Done.

*The trap the story predicted, demonstrated rather than assumed.* A check constraint cannot be
extended in place, so 014 drops and recreates `extraction_kind_known` — and from that point
**migration 006 no longer states the vocabulary the database admits**.
`core/extraction/record.test.ts` read 006 to learn it. The sequence was left in the commit history on
purpose: adding `deposit` to the constant failed the parity test, adding it to 014 *still* failed it,
and only pointing the parser at every migration — taking the **last** definition, which is what the
database does — made it pass. Reverting the parser fails both the parity test and its new control.

*And the eleventh guard of this kind in the epic, which is the one worth reading.* The test
`never routes the unit reference through the vendor normaliser` forbade the string
`vendor_normalised_name` anywhere in the executable SQL. It failed immediately — because the
`comment on` literal at the foot of the migration **explains** the separation and names the function
to do it, and `executable()` correctly preserves string literals. A deny-list catching a mention
rather than a dependency.

Story 2.1 shipped that exact mistake and recorded it. **This test's own comment cited that record,
and it was written as a deny-list anyway.** Narrowed to what the column *is* — a plain `text` column
with no generated normalisation — and verified: attaching
`generated always as (vendor_normalised_name(unit_reference))` now fails it.

*Gates:* lint 0 errors and 1 pre-existing warning, `tsc --noEmit` **8** (= baseline), build clean,
`npm test` **76 files / 1398 passed**, `npm run test:db` **23 files / 437 passed**.

### File List

### Change Log

- 2026-08-08 — All five tasks complete. Status -> review.
- 2026-08-08 — MR round 3: a regression test for the rollback-failure release, which until now was an unproven guard. Three mutations confirm it discriminates.

- 2026-08-07 — Story created. Two gaps in epic 1 were found before writing it: an extracted record has
  no unit field, and there is no `deposit` document kind. Matt chose a new `unit_reference` column on
  `extraction` over reusing `vendor_name`, and a parallel `held_payment` table over generalising the
  vendor-shaped `quarantine_item` — both to keep unit identity separate from vendor identity, as story
  2.1 required. Status -> ready-for-dev.
