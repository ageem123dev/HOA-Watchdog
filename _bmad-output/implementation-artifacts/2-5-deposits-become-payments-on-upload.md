---
baseline_commit: cffb9e5
merge_request: 29
---

# Story 2.5: A deposit becomes payments when it is uploaded

Status: review

> **Added 2026-08-08, after story 2.4.** 2.4 built the ledger — the `payment` and `held_payment`
> tables, the resolve-or-hold decision, and the repository that replaces both on re-ingest. It did
> not connect any of it to the upload path. This story does, and it exists because 2.4's own AC1 is
> not true end to end without it.

## Why this story exists

Story 2.4's first acceptance criterion reads *"Given an uploaded deposit document, when its records
are extracted, then each payment is stored against a unit"*. Every piece needed for that was built
and tested, and **nothing calls any of it**. Verified by search: the only non-test files mentioning
`createPaymentRepository`, `resolveLine` or `createHeldPaymentQueue` are the three that define them.

Upload a deposit today and you get `extraction` rows and no payment. The gap was not caught by any
review, because every part has tests and they all pass — which is the point worth carrying into this
story: **a set of green units does not add up to a working path, and only something that exercises
the whole path can say otherwise.**

## The three gaps, precisely

| Gap | What it means today |
| --- | --- |
| `core/ingestion/extract-document.ts` takes `{ repository, extractor, quarantine }` and no payment repository | Nothing writes a payment, ever |
| The extractor was never taught to emit `unitReference` | 2.4 added the field to `ExtractionRecord` and to `validate.ts`, but not to the Gemini prompt or the tabular reader, so it is `null` on every row in practice |
| Nothing resolves a reference to a `unit_id` | `resolveLine` takes a lookup as a **parameter**, deliberately, so it stays pure. No adapter implements one. `UnitDirectory` answers "who held 4B", not "which unit is `4b`" |

## Story

As a treasurer,
I want an uploaded deposit to become payments without further action,
So that what arrived is in the ledger by the time I look at it.

## Acceptance Criteria

**AC1**
**Given** a deposit document is uploaded and extracted
**When** ingestion completes
**Then** each line that names a known unit is stored as a payment against that unit, and each line
that does not is held — without anyone invoking a second step

**AC2**
**Given** a deposit line naming a unit in a spelling the roll does not use exactly
**When** it is resolved
**Then** it matches through `unit_normalised_number()` and only through it, and a reference that does
not fold to a known unit is held rather than guessed at

**AC3**
**Given** a document that is not a deposit
**When** it is ingested
**Then** nothing is written to `payment` or `held_payment`, and the vendor path behaves exactly as it
did before this story

**AC4**
**Given** the same deposit uploaded twice
**When** it is ingested the second time
**Then** the payments and held lines it produced are replaced, not duplicated — AD-13, through the
real ingestion path rather than through a repository called directly

## Tasks / Subtasks

- [x] **Task 1 — A unit directory that answers "which unit is this reference"** (AC2)
  - [x] Extend `core/ports/unit-directory.ts` with a read that takes a raw reference and answers with
        a unit id or nothing. It is a **read**; the port stays incapable of creating a unit, which is
        what stops a deposit inventing one.
  - [x] The adapter matches on `unit.normalised_number = unit_normalised_number($1)` — the same
        folding, not a reimplementation of it. Assert the query text, as `unit-directory-connection.test.ts`
        already does for its siblings.
  - [x] **Resolve in one query for the whole document, not one per line.** A CSV bank feed is
        hundreds of lines; a lookup per line is hundreds of roundtrips inside the ingest transaction.
        Fetch the references the document mentions and build the map once.
- [x] **Task 2 — The extractor emits a unit reference for deposit lines** (AC1)
  - [x] Teach the extraction path to populate `unitReference`. `validate.ts` already accepts it and
        already refuses it on any kind but `deposit`, so the contract exists — only the producer is
        missing.
  - [x] Both producers, or say which and why: the Gemini extractor and the tabular reader. A CSV bank
        feed goes through the second, and that is the shape the pilot actually ingests.
  - [x] A deposit fixture end to end: bytes in, records out, with the reference populated.
- [x] **Task 3 — Ingestion writes payments** (AC1, AC3, AC4)
  - [x] Thread a `PaymentRepository` into `extract-document.ts` as a dependency, beside `quarantine`.
        It is the same shape as the vendor hold, which is the precedent to follow rather than invent
        around.
  - [x] **Only for `deposit` documents.** AC3 is the guard: an invoice must write nothing to either
        table, and the vendor path must be untouched. Assert it — a change that quietly wrote empty
        payment sets for every document would pass every other test here.
  - [x] The payment write and the extraction write must both land or neither. Decide and record
        whether they share a transaction or are ordered so a failure between them is recoverable —
        `extraction-repository-postgres.ts` records the same hazard for its own state write.
  - [x] **An entirely-held deposit is a success, not a failure.** Every line unresolved is an ordinary
        outcome, and the document's extraction state must reflect that it was read.
- [x] **Task 4 — Prove the path, not the parts** (AC1, AC4)
  - [x] One test that starts at an uploaded deposit and ends with rows in `payment` and
        `held_payment`, going through the real ingestion entry point. This is the test whose absence
        let story 2.4 ship a complete set of green units and no working path.
  - [x] Re-ingest the same document through that same entry point and assert the counts do not double
        — AD-13 proved where it actually has to hold, not at the repository.
  - [x] A deposit mixing resolvable and unresolvable lines, since that is the ordinary case and the
        one where a partial write would be least visible.

## Dev Notes

### The lesson this story is built around

Story 2.4 shipped `payment`, `held_payment`, `resolveLine`, a repository and a queue — all tested,
all green, all unreachable. No review caught it: Argus, CodeRabbit's IDE round and two MR rounds each
looked at code that was correct in itself.

**A green unit test proves a part works. Only a test that runs the path proves the parts are
connected.** Task 4 exists before Tasks 1–3 in importance, and if time runs short it is the one to
keep.

### What 2.4 hands over

- `payment`, `held_payment` (migrations 015–018), both `numeric(14,2)`, both cascading from
  `document`.
- `resolveLine(line, lookup)` — pure, holds rather than guesses, and holds rather than crashing on an
  amount `payment` cannot store.
- `PaymentRepository.replace(documentId, lines)` — one transaction, both tables, locks the parent
  `document` row, refuses an entirely empty reading.
- `HeldPaymentQueue` — read-only, on the reader connection.
- `HOLD_REASONS`: `unknown-unit`, `missing-reference`, `missing-amount`, `missing-date`,
  `unsupported-amount`.

### Learnings that apply directly

Twelve guards that proved nothing were found across epic 2, most written while fixing a previous one.
The shapes most likely here:

1. **A test that counts rather than checks.** Row counts pass against an insert that wrote nulls into
   every column.
2. **`toThrow(SomeType)` cannot tell a contract from a crash.** Assert the message.
3. **A guard nothing can reach.** If no test can force a branch, delete the branch.
4. **Choose values that discriminate.** `Number('83.34') * 100` is exactly 8334; `0.29` is not.
5. **Read the file count in the test summary.** The suite silently under-ran twice in this project,
   reporting green with three files uncollected.

### Testing standards

- Gate: `npm run lint`, `npm run build`, `npm test`, `npm run test:db`, and
  `npx --no-install tsc --noEmit` against its **baseline of 8**. Quote the numbers from the run, not
  from memory — three commit messages in epic 2 carried counts that were wrong.
- Per-file `RUN_PREFIX` on anything writing to a shared table.

### References

- `_bmad-output/implementation-artifacts/2-4-deposits-become-payments.md` — the predecessor and the
  source of everything this story wires up.
- `core/ingestion/extract-document.ts` — the orchestration this story extends.
- `core/ingestion/hold-unknown-vendors.ts` — the precedent for a hold path inside ingestion.

## Dev Agent Record

### Agent Model Used

### Test Design

#### Scope correction found before writing anything

**Task 3 names `extract-document.ts`. That path cannot see a deposit CSV.** It returns
`no-provider-path` for the three tabular content types; a spreadsheet is read at upload time in
`ingest.ts`. Since the pilot's deposits are CSV bank feeds, implementing Task 3 as literally written
would produce payments for scanned deposit slips and none for the format actually ingested — the same
"complete and unreachable" outcome this story exists to correct.

AC1 says *uploaded and extracted*, without naming a parser, so both paths are in scope. Following the
precedent in `hold-unknown-vendors.ts`, whose docblock makes this exact argument for quarantine:
*"a rule that lived in only one of them would make 'upload the invoices as CSV' a way to put vendors
into the system with nobody asked about them."* One shared module, two call sites.

#### Behaviour 1 — `UnitDirectory.unitIdsFor(references)`

1. *How would I know it ran correctly?* A map from reference to unit id, with unmatched references
   absent.
2. *How do I test it?* The adapter needs a `pool` seam to count queries; `createPaymentRepository`
   already established that shape. Matching itself needs the real database, because
   `unit_normalised_number` is the thing under test.
3. *What else can go wrong?* Below.
4. *Siblings?* Every other adapter loops per item — the N+1 already recorded against
   `extraction-repository-postgres.ts` and `payment-repository-postgres.ts`.

**The key decision: the database decides *which unit*, core decides *the map key*.** The adapter
matches on the raw reference through `unit_normalised_number()` and returns a map keyed by the raw
string; the caller re-keys with core's `fold`, the same `fold` `resolveLine` applies. The two foldings
therefore never have to agree — which matters, because **they do not**: JavaScript's `\s` matches
`　` and migration 011's character set does not.

| # | Failure mode | Class |
| --- | --- | --- |
| 1 | Empty reference list — a document with no deposit lines | GUARD: answer an empty map without querying |
| 2 | The same reference on many lines | GUARD: one entry, and still one query |
| 3 | A reference matching no unit | GUARD: absent from the map, never a null entry |
| 4 | A reference containing NUL — `text` cannot store one, so the parameter raises 22021 and aborts the surrounding transaction | GUARD: skip it, so the line is held rather than the document lost |
| 5 | One query per line inside the ingest transaction | GUARD: assert the query count, not just the answer |
| 6 | The reader connection is down | PROPAGATE: ingestion's own catch owns it |
| 7 | Two raw references that core folds together but the database matches to different units | GUARD: drop the key rather than let last-write-win attribute money to whichever line came second |

Failure mode 7 is the one that only exists because of the two-folding design, and it is why the
re-keying is a fold-and-check rather than a fold-and-assign.

### Debug Log References

**One flaky run, not reproduced, recorded rather than buried.** During Task 2's gate the first
`npm test` reported 2 *files* failing (1477/1888); the next twelve runs were identical at 1479/1888.
The failing run was the first after `cp` restored two source files from the mutation harness, and the
two files that failed were the extractor pair — both of which `readFileSync` the module they test. A
stale transform cache disagreeing with freshly-read source produces exactly that shape. Consistent
with the evidence and with an artifact of the harness rather than of the committed code, but not
proven, so it is written down here rather than called fixed.


### Review Findings

**MR round 1 — 1 actionable, and it was a real defect this story introduced.**

**[major] The payment write was not fenced by the extraction claim.** Confirmed against the code, and
the sequence is exact: run A claims and its provider call outlives the 300s TTL; run B claims, writes
payments, and its *fenced* extraction write settles the document as `read`; run A returns, calls
`recordPayments`, and — with no fence — replaces B's payments with its own. A's `extractions.replace`
then correctly throws `StaleExtractionClaimError`, so A's *records* are discarded. The document is
`read`, so nothing polls it again: extraction rows from B, payment rows from A, permanently.

This is a direct consequence of the ordering decided in Task 3. Writing payments *before* the fenced
write is what makes a mid-way failure recoverable — and it is also what leaves the payment write
outside the fence. Both halves of that are worth stating together, because the fix is not to reorder.

Fixed by giving `PaymentRepository.replace` an optional fence and checking it **in the same statement
as the row lock**, exactly as `extraction-repository-postgres.ts` does and for the reason its comment
gives: checked before `begin` there is a window in which the claim expires between the check and the
write. Optional because the upload path has no claim to fence against — a CSV is read synchronously
inside the request that uploaded it, and there is no second runner to race.

*Sensitivity check — three mutations:*

| Mutation | Result |
| --- | --- |
| drop the fence check (the defect as reported) | 1 of 536 failed |
| fence refuses everything | 1 of 536 failed |
| call site stops passing its claim | 1 of 5 failed |

The middle one is the discriminator: a fence that refused every write would satisfy the first test
and stop the deferred path recording any payment at all.

*`tsc` earned its place in the gate a second time.* The `vi.fn()` fake was inferred from a
zero-argument implementation, so `replace.mock.calls[0]` was a zero-length tuple and every assertion
about the new third argument was a **type error rather than a test** — while the suite ran green.
The baseline moved 8 to 12 and named all four. The fake is now typed from the port's own signature.


**Argus, second run — on the fix commit, after `argus_ingest` wrote its lessons.** The first run found
nothing; this one found three, one critical. The ingest is the difference, and it is the clearest
evidence so far that the memory loop does something.

**[critical] A NUL in a unit reference reached the write path.** `unitIdsFor` already refused to
*send* one — and that read-path guard is exactly what made the write path look covered. Nothing
stopped it being *stored*: `text` cannot hold a NUL, so the `held_payment` insert raises 22021, which
aborts the transaction, takes every payment in the document with it, and reports as an outage rather
than a bad document — so it retries forever. `validate` does not close it either; `checkText` refuses
null, wrong types, blank and too-long and says nothing about control characters. **Migration 017's
shape for the fourth time in this epic.**

Fixed as `unstorableUnitReference`, reported rather than repaired, matching `unstorableName` beside
it: both call sites turn it into `unreadable`. Stripping the NUL would store a reference the document
does not contain, and might match a unit the payer never named.

*Writing the test corrected the finding.* The first end-to-end attempt asserted `unreadable` on the
CSV path and got `rejected` — `assess` refuses an upload containing a NUL before the bytes are even
stored, so **that path was already safe**. The guard earns its place on the provider path, where the
bytes are a valid PDF and the model supplies the reference. The CSV test now asserts what is true
rather than what was expected, and the guard is proved where it actually bites.

**[high] NUL guards on `heldBy`/`historyFor` — declined again, and re-verified.** Still no production
caller: `unitIdsFor` is the only method this story wired, and the other two remain unreachable. A
guard nothing can force is the shape this project deletes.

**[low] A comment describing code that does not exist.** The note claimed `deposit` was compared
against the record's vocabulary rather than a literal; it never was. Corrected rather than deleted —
a comment describing absent code is worse than no comment, because it is the version a reader
believes. My error, and the second of this kind in this story.

**Local round (Argus + CodeRabbit IDE, on `c487ebe`).** Argus: **zero findings** on the whole-story
diff — recorded rather than celebrated, since Argus also passed story 2.4, the story that shipped a
complete and unreachable ledger. When the defect is *absence*, a clean second opinion is weak
evidence. `argus_ingest` scored it against the review: recall **0**, three misses written to memory.

CodeRabbit: 4 actionable. Two in scope, both fixed; two on uncommitted files that belong to another
branch.

**[major] The provider path lost whole documents to a stray unit reference.** The response schema
permits `unitReference` on every kind, `validate` refuses it on anything but a deposit, and this
adapter turns *any* validation failure into `null` — which the caller reports as `unreadable`. So a
provider hallucinating a unit on an invoice did not lose the field, it lost **the entire document**,
and told the treasurer their scan was bad.

The same shape as all three defects story 2.4 found: *the schema refusing something the pipeline can
still produce*. Fixed by dropping the field on non-deposit kinds, which is what the tabular reader
already did — the two producers now agree, where before the same document read two ways gave two
answers.

The fix is deliberately narrow: it clears one field on exactly the kinds that cannot carry it and
leaves an unrecognised `documentKind` for `validate` to judge. A broader version would be this
adapter quietly correcting an untrusted answer instead of finding out it was wrong. Mutation
confirms the narrowness matters — nulling unconditionally fails 2 tests, because that "fix" would
have silently undone the whole story.

**[minor] The split test pinned the payment side and not the held side.** `toEqual` fixed the
payments exactly, while the held side inspected only `[0]`, so extra held rows would have passed.
Now counted. Proved by writing a duplicate held row: 3 tests fail.

**Two findings triaged out, not fixed here.** The machine-specific Argus path in `.mcp.json`, and
`git diff HEAD` omitting untracked files in `.claude/commands/argus-review.md`. Both are real, both
are already open action items in `sprint-status.yaml`, and both live in files this branch does not
touch — the IDE extension ignores `path_filters` and picks up uncommitted work whatever the scope
says. Fixing them here would put unrelated changes in this MR.

The untracked-files one deserves a note: it means **Argus has been reviewing without seeing new
files**, which is a plausible contributor to the zero-findings result above and to story 2.4's ledger
going unnoticed.


### Completion Notes List

**Task 4 — the path itself.** Done. `adapters/db/deposit-ingestion.test.ts` starts where a treasurer
starts — bytes and a filename handed to `ingest`, the entry point the upload action calls — and ends
by reading `payment` and `held_payment` directly. Everything between is production code; the only
fake is the object store, because an S3 bucket is not what is under test.

*Written against the CSV path deliberately.* `extract-document.ts` refuses a CSV outright with
`no-provider-path`, so an end-to-end test written there would have proved nothing about the documents
the pilot actually uploads — the same blind spot in a new place.

*The mutation that matters:* deleting the `recordPayments` call from `ingest.ts` reproduces story
2.4's exact state — every part correct, nothing connected — and fails **5 of these 7 tests**. Story
2.4 shipped that state past Argus, one IDE round and two MR rounds, with a fully green suite. This is
the check that was missing.

| Mutation | Result |
| --- | --- |
| disconnect the ledger from the upload path (2.4's state) | **5 of 7 failed** |
| record every kind, not only deposits (AC3) | 1 of 7 failed |
| stop deleting on re-ingest (AD-13) | 1 here, plus 2 in the repository suite |
| stop reading the `unit` column (task 2 undone) | 5 of 7 failed |

*A type error the test suite could not have caught.* The store fake was written with `put(key, bytes)`
against a port whose signature is `put(document)`. Vitest does not typecheck, so all seven tests
passed while the fake did not implement the port — `tsc` moved 8 to 11 and named it. Fixed rather
than cast away.

**Task 3 — the wiring, in both paths.** Done, as one shared module rather than two copies.

*The scope correction, carried out.* `core/ingestion/record-payments.ts` is called from
`extract-document.ts` **and** `ingest.ts`. Wiring only the first — which is what the task text said —
would have recorded payments for scanned deposit slips and none for CSV, the format the pilot
actually uploads, because a CSV is refused by the deferred path with `no-provider-path` before it
gets anywhere near a provider.

*Ordering, decided and proved.* Payments are written **before** `extractions.replace`, which is what
settles the document. A settled document is never re-read, so payments missing after it is silent and
permanent; payments missing before it leaves the document unsettled, re-read on the next poll, and
healed. AD-13 makes the retry safe. `payment-ordering.test.ts` asserts it by consequence — the
extraction write is made to fail and the payment write has already happened — because a comment
saying "call this first" constrains nothing.

*The collision guard from failure mode 7, now real.* `byFoldedReference` drops a key rather than
assigning it when two raw references fold together but name different units. Last-write-wins would
put real money against whichever line arrived second.

*The wiring is itself under test.* `units` and `payments` are optional on both dependency types, so
their absence means "record nothing" and **nothing fails** — the exact shape of story 2.4.
`payment-wiring.test.ts` reads both call sites and asserts each passes the real adapters; removing
them fails 3 of 7, and setting them to `undefined` fails 1 of 7. That second mutation is why the
test checks the constructor call and not merely the property name.

*Lint caught a silent no-op edit.* Two `units:`/`payments:` insertions failed against CRLF files
while their imports succeeded, so the call sites had the adapters imported and unused. An unused
import is exactly the signal that wiring is missing, and it is the only reason this was noticed
before the end-to-end test.

*Sensitivity check — nine mutations across the module, the ordering and the wiring:*

| Mutation | Result |
| --- | --- |
| record every document kind, not only deposits | 1 of 12 failed |
| assign on a fold collision instead of dropping | 1 of 12 failed |
| look up by the raw reference, not the folded one | 2 of 12 failed |
| drop unreferenced lines instead of holding them | 1 of 12 failed |
| skip the write when every line was held | 5 of 12 failed |
| settle the extraction before writing payments | 2 of 3 failed |
| remove the wiring from the upload action | 3 of 7 failed |
| wire the collaborators as `undefined` | 1 of 7 failed |
| (one invalid mutation produced a parse error and was redone) | — |

**Task 2 — the producers.** Done, both of them.

*A new `unit` column, not a second meaning for `reference`.* `reference` already lands in
`documentNumber` as the transaction reference, and a deposit line commonly carries both. A column
whose meaning depends on a sibling cell is a rule nobody can read off the header row.

*Read only when the row is a deposit.* `validate` refuses `unitReference` on every other kind, and
one invalid row fails the whole document here — so reading the column unconditionally would turn a
stray `unit` column on an invoice export into a refusal of the entire upload. Ignored rather than
refused: a unit means nothing on an invoice.

*The provider schema needed the field at all.* Structured output answers the schema it is given, so
`unitReference` absent from it was `unitReference` null on every document a provider ever read —
which is why story 2.4's field was dead in practice even though the record and the validator both
carried it. Bounded by `UNIT_REFERENCE_MAX_LENGTH` rather than a hand-written `64`, nullable, and
deliberately not `required`.

*A second exhaustive guard fired*, as Task 1's did: `permits null on exactly the fields the table
allows null (B7)`. Widened deliberately — migration 014 declares `unit_reference text` without
`not null`, so the field belongs on that list.

*Sensitivity check — six mutations, each verified to have actually applied:*

| Mutation | Result |
| --- | --- |
| read the unit column for every kind | 1 of 9 failed |
| never read the unit column | 3 of 9 failed |
| read `reference` as the unit instead | 3 of 9 failed |
| drop `nullable` from the provider schema | 2 of 86 failed |
| drop the provider's value before validation | 1 of 86 failed |
| stop normalising the `unit` header | 5 of 9 failed |

**The `nullable` mutation is the one worth keeping.** Its first attempt reported *zero* failures — and
that was a multi-line replacement against a CRLF file, so it never applied at all. A mutation that
silently no-ops is indistinguishable from a test that fails to catch it, and reads as the more
reassuring of the two. Every mutation in this story now prints its substitution count.

*A stub with no assertion was written and deleted.* It reached the file during an edit and would have
counted toward the suite's total while proving nothing.

**Task 1 — the lookup.** Done. `unitIdsFor(references)` on `UnitDirectory`, one `unnest` query per
document, keyed by the caller's own string.

*The design decision worth keeping:* **the database decides which unit, core decides the map key.**
The adapter matches through `unit_normalised_number()` and echoes `r.reference` back; the caller
re-keys with core's `fold`. The two foldings therefore never have to agree — and they do not, since
JavaScript's `\s` matches U+3000 and migration 011's character set does not. Aliasing the database's
normalised spelling instead makes that disagreement a silent miss, which is what the mutation below
demonstrates.

*Corrected during the task, from Argus:* the port's note claimed this "runs inside the ingest
transaction". It does not — this is the reader connection (AD-4) and the payment write opens its own
transaction on the writer. The claim originated in the story's own Task 1 wording and had propagated
into three files. The cost being avoided is latency before the write, not a lock held during it, and
the wrong version invites someone to widen the parameter to `PoolClient` to "fix" it.

*Two Argus findings declined, verified first:*

- *NUL guards on `heldBy`/`historyFor`.* Both are unreachable: `createUnitDirectory` has **no
  production caller at all** today. A guard nothing can force is the shape this project deletes.
  Worth recording that story 2.1's directory has been sitting unreachable for the same reason 2.4's
  ledger was — `unitIdsFor` is about to become its first production caller.
- *Reader/writer replication lag in the tests.* No replica exists: both URLs resolve to
  `altaria.proxy.rlwy.net:46548/railway`, differing only by role.

*One test renamed rather than kept as written.* `keys the answer by the reference given` could not
prove what its name claimed — a fake pool returns whatever it is told, so aliasing the SQL column
left all seven green. It does pin the map construction, so it survives under an honest name, and the
alias is pinned where it can be: against a real database.

*Sensitivity check — six mutations:*

| Mutation | Caught by |
| --- | --- |
| drop the NUL filter | fake-pool suite, 1 failed |
| alias the normalised spelling as the key | **database suite, 4 failed** — fake-pool suite green |
| drop the dedup | fake-pool suite, 1 failed |
| drop the empty-list guard | fake-pool suite, 2 failed |
| match `unit_number` raw instead of folding | fake-pool suite, 1 failed |
| build the map from the id column | fake-pool suite, 1 failed |

*The port guard fired, as designed.* `unit-directory.test.ts` asserts the declared method list
exhaustively, so adding a third method failed it. Widened deliberately and still exhaustive; all
three remain reads, which is what stops a deposit inventing a unit.


### File List

- `core/ports/unit-directory.ts` — modified, Task 1.
- `core/ports/unit-directory.test.ts` — modified, Task 1.
- `adapters/db/unit-directory-postgres.ts` — modified, Task 1.
- `adapters/db/unit-directory-references.test.ts` — added, Task 1.
- `adapters/db/unit-directory-reference-queries.test.ts` — added, Task 1.
- `core/extraction/tabular.ts` — modified, Task 2.
- `core/extraction/tabular-deposit.test.ts` — added, Task 2.
- `adapters/extraction/extractor-gemini.ts` — modified, Task 2.
- `adapters/extraction/extractor-gemini.test.ts` — modified, Task 2.
- `adapters/extraction/extractor-gemini-unit.test.ts` — added, Task 2.
- `core/ingestion/record-payments.ts` — added, Task 3.
- `core/ingestion/record-payments.test.ts` — added, Task 3.
- `core/ingestion/payment-ordering.test.ts` — added, Task 3.
- `core/ingestion/payment-wiring.test.ts` — added, Task 3.
- `core/ingestion/extract-document.ts` — modified, Task 3.
- `core/ingestion/ingest.ts` — modified, Task 3.
- `core/payment/resolve-line.ts` — modified, Task 3 (`fold` exported).
- `app/upload/actions.ts` — modified, Task 3.
- `app/api/documents/[id]/extract/route.ts` — modified, Task 3.
- `adapters/db/deposit-ingestion.test.ts` — added, Task 4.

### Change Log

- 2026-08-08 — All four tasks complete. Status -> review.
- 2026-08-08 — Story created, after story 2.4 was found to have built the payment ledger without
  connecting it to upload. Verified by search that nothing calls `createPaymentRepository`,
  `resolveLine` or `createHeldPaymentQueue` outside their own tests. Status -> ready-for-dev.
