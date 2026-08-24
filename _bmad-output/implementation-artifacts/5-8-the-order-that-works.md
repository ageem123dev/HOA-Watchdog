---
Status: review
baseline_commit: 2f8df62
merge_request:
---

# Story 5.8 — the order that works

## Story

As a treasurer setting up a new association,
I want the system to stop me uploading deposits before the assessment roll,
So that I do not end up looking at a screen of held payments and conclude the product is broken.

## The trap, stated exactly

`docs/upload-contract.md` has carried a section called **"Order matters on a fresh install"** since
epic 2. It says, correctly:

> Upload them the other way round and every deposit line is held with `unknown-unit`. That is the
> system working correctly — it will not invent a unit to make a payment fit — but on a fresh install
> it looks like a failure, so the order is worth following.

The epic is blunter about what that costs (Story 2.6's notes): *"The system is behaving correctly and
looks broken, so a sample deposit shipped without that warning is worse than no sample."*

**This story turns the warning into a refusal.** A document is worth reading only if the thing it
refers to can exist yet, and until a roll has produced units, a deposit file cannot produce anything
but questions.

### Why a warning was never enough

The order is currently enforced by a paragraph in a document. Three things follow, and each one is a
reason this story exists rather than a nicer hint:

1. **Nobody reads the contract before their first upload.** It is the reference you reach for after
   something has gone wrong.
2. **The failure is silent and total.** Every line held, no error, no red text — the upload reports
   success, and the damage is a screen the treasurer has to interpret.
3. **The recovery exists but nobody is told about it.** Verified while writing this story, because
   the first draft asserted the recovery was manual and that was wrong:

   - A roll arriving later does **not** re-attribute existing holds. `HeldPaymentQueue` exposes only
     `held()`, a read; nothing re-resolves a held line.
   - **Re-uploading the same deposit file does.** `PaymentRepository.replace` moves `payment` and
     `held_payment` together for a document -- AD-13's replace semantics -- so a second upload after
     the roll re-resolves every line and clears the holds.

   So the treasurer is one re-upload away from correct, and nothing tells them that. The screen of
   holds does not say "upload your roll, then send these again"; it says nothing, and each hold reads
   as a line needing individual attention.

## Acceptance Criteria

1. **A deposit upload is refused while the association has no units.** The refusal happens before any
   file is read, names the roll as the thing to upload first, and is a property of the association's
   own data rather than of the file.

2. **"Has a roll been uploaded" is not the test — "do units exist" is.** A roll that was uploaded and
   could not be read creates no units, and deposits after it must still be refused. Asserted with a
   roll document present and no units.

3. **Nothing else is refused.** An assessment roll, an invoice, a bank statement and `other` upload
   exactly as they do today, on an association with no units. The refusal is scoped to the one kind
   whose lines need units to mean anything.

4. **The refusal is server-side, and the surface reflects it rather than implementing it.** The upload
   action refuses the submission whether or not the page ever rendered; the form additionally tells
   the treasurer the order *before* they choose, so the refusal is not the first they hear of it.

5. **The check is scoped to the uploader's association.** Derived from the authenticated member in
   SQL, never taken as a parameter — 5.1's rule. One association's units must not satisfy another
   association's upload.

6. **The re-import path is unaffected.** Story 5.7 gave `ingest` a second caller: a mapping change
   re-imports deposits. That path must not acquire this refusal — by then units exist, and a guard
   that reached it would make a mapping change fail for a reason that has nothing to do with mapping.
   Asserted structurally, not assumed.

7. **The contract document says what the system now does.** `docs/upload-contract.md`'s "Order matters
   on a fresh install" stops describing a convention the reader must follow and describes a rule the
   system enforces. A document that still says "the order is worth following" after this ships is
   wrong in the direction that matters — it understates the system.

## Tasks / Subtasks

- [x] **Task 1 — Ask whether the association has any units.** A narrow port and its adapter, scoped
      by the member in SQL. Read-only. (AC1, AC5)
- [x] **Task 2 — Refuse the submission.** In `app/upload/actions.ts`, before a byte is read, when the
      kind is `deposit` and the association has no units. (AC1, AC2, AC3, AC4)
- [x] **Task 3 — Say it before they choose.** The upload form states the order, so the refusal is a
      backstop rather than the first the treasurer hears of it. (AC4)
- [x] **Task 4 — Prove the re-import is untouched.** Structurally, because a behavioural test cannot
      prove a path does *not* acquire a guard. (AC6)
- [x] **Task 5 — Correct the contract.** `docs/upload-contract.md`, and any test that guards it. (AC7)

## Dev Notes

### What exists — read before writing anything

| File | Why it matters |
| --- | --- |
| `app/upload/actions.ts` | The submission-level refusals already live here (`{ outcomes: [], error }`). Two exist: no session, no files |
| `core/ingestion/acceptance.ts` | `assess` and `RejectionReason`. **Not the place for this** — see below |
| `core/payment/resolve-line.ts:125` | Where `unknown-unit` is actually produced: `if (typeof unitId !== 'string') return held('unknown-unit')` |
| `core/ports/unit-directory.ts` | `heldBy`, `historyFor`, `unitIdsFor`. **No existence read** — Task 1 adds one |
| `core/ingestion/ingest.ts` | `rolls` is what turns a roll into units; its own comment describes this exact trap |
| `app/ingestion-dependencies.ts` | Story 5.7's shared composition. Both `ingest` callers go through it |
| `app/onboarding/mapping/reimport-actions.ts` | The second caller of `ingest`, from 5.7. AC6 is about this |
| `docs/upload-contract.md` | The "Order matters" section this story makes obsolete as written |

### The decision most likely to be got wrong

**This is not a `RejectionReason`.** `assess(candidate)` takes a content type and bytes and answers
whether *that file* is acceptable — `unsupported-type`, `too-large`, `empty`, `unreadable`. Every one
is a property of the file itself.

"Your association has no units yet" is a property of the **association**, not of the file, and it is
the same answer for every file in the submission. Threading it through `assess` would mean either
passing association state into a pure byte-level check, or reporting a per-file rejection for a
condition no file could ever fix.

It belongs where the other submission-level refusals already are: `uploadDocuments` returns
`{ outcomes: [], error }` for "no session" and "no files chosen", and this is the third of that
family.

### The second-order trap, and it is the interesting one

**Do not put this check in `ingest`.** It looks like the safer place — closer to the data, harder to
bypass — and it is wrong, for a reason that only exists as of last story.

Story 5.7 gave `ingest` a second caller: `changeMapping` re-imports every affected document through
it when a treasurer edits a column mapping. A guard in `ingest` would fire on that path too. It would
not fire *wrongly* today, because units exist by the time anyone is re-mapping — but the coupling is
the defect, not the symptom. A re-import failing because of a rule about first-time setup is a
failure nobody could diagnose from the message.

AC6 asks for this to be proven structurally. `core/mapping/reimport-boundary.test.ts` is the pattern:
a prohibition needs a test shaped like a prohibition, because a behavioural test can only show what
did happen.

### Tenancy

5.1's rule, stated in `adapters/db/document-repository-postgres.ts` and repeated in every adapter
story 5.7 added: **the association is read from the member in SQL, never passed in.** A scalar
subquery inside the query, not `insert ... select`. Story 5.7's `mapping-store-postgres.ts` and
`reimport-candidates-postgres.ts` are the two nearest examples, and both have text-assertion tests
that fail if the derivation is replaced by a parameter.

### What "no units" must mean

**Units, not documents.** The temptation is to ask "has an `assessment_roll` document been ingested",
because it reads like the same question and the document table is already to hand. It is not the same
question:

- A roll uploaded as the wrong kind creates no units.
- A roll whose columns did not match creates no units (`unreadable`).
- A roll that read cleanly but whose rows were all invalid creates no units.

In each case a document exists and the trap is still open. Asking the question the deposits will ask —
*are there units?* — is the only form that cannot drift from what it is protecting.

### Testing notes

The suite is Vitest. `.tsx` render tests are per-file opt-in with jsdom (story 1.6c). Adapter tests
in `adapters/db/` are `describe.skip` without a database — **and there is no database configured on
the machine this project is currently built on**, so a rule proven only in a database half is proven
nowhere. Story 5.7 established the split: text assertions on the SQL that always run, plus a database
half that skips.

`app/upload/upload-form.test.tsx` exists and is the place for Task 3.

### Previous story intelligence — 5.7

Story 5.7 (`5-7-the-mapping-is-remembered.md`) is worth reading in full before starting; its Dev Agent
Record is long because the reviewers found a great deal. The parts that bear on this story:

- **The AC audit found two ACs implemented by nothing**, on a story whose tasks were all complete and
  whose tests were all green. Run it here, and audit *both halves* of any AC with an "and" in it —
  that is exactly how AC8's first clause survived.
- **The integration pass found what four reviewers missed**: nothing proved the re-import applied the
  *changed* mapping. Per-task tests were each complete on their own terms. AC6 here is the same
  shape — a claim about the interaction between two stories.
- **A guard that cannot fail is this project's most repeated defect.** Twelve instances so far,
  several inside guards written to prevent it. The most recent: a control test using empty bytes,
  which `assess` rejects before the branch under test is entered.
- **`tsc` catches what the suite cannot.** Twice on 5.7: an import that did not resolve, and backticks
  in a SQL template literal — both while every test passed, because text-assertion tests read files
  rather than execute them.
- **Mutations must be proven to apply.** Verify the anchor count before running one; a no-op mutation
  is indistinguishable from a caught one.

### Git intelligence

Last five commits are all story 5.7 — the MR round, the close-out, and the merge. The patterns
established there and directly reusable here:

- A narrow port per capability (`reimport-candidates.ts`), not a method bolted onto a large one. When
  `importedUnder` was first added to `DocumentRepository`, `tsc` immediately named four unrelated
  fakes that would have had to grow a method none of them calls.
- Text-assertion tests over adapter SQL, with `neutralise` from `core/ports/declared-members` rather
  than a hand-rolled comment stripper — story 5.6 consolidated four private copies of that scanner
  after they drifted, and 5.7 added a fifth by accident.
- Every review finding recorded in the story with what it would have cost, not just that it was fixed.

## Dev Agent Record

### Test Design

#### Task 1 - does this association hold any units?

**Behaviour A: the port.** One question, one answer.

1. *If it ran correctly, how would I know?* It answers `true` for a member whose association holds at
   least one unit, and `false` for one whose association holds none.
2. *How am I going to test it?* Text assertions over the adapter's SQL, which always run, plus a
   database half that skips without a connection - story 5.7's split. **No database is configured on
   this machine**, so the text half is the only half that will execute here, and it is where the
   tenancy rule has to be pinned.
3. *What else can go wrong?* Below.
4. *Could this happen elsewhere?* Yes - `mapping-store-postgres.ts` and
   `reimport-candidates-postgres.ts` are the two nearest adapters and both derive the association the
   same way. Their text assertions are the model for this one's.

| # | Failure mode | Class |
| --- | --- | --- |
| 1a | The association taken as a parameter rather than derived from the member, so a caller can name another board and satisfy the check with their units | GUARD - scalar subquery over `board_member`, asserted in text and killed by mutation |
| 1b | An unknown member: the subquery yields NULL, `association_id = NULL` matches nothing, and the answer is `false` | GUARD - and `false` is the right answer, because refusing the upload is the safe direction. It must not throw |
| 1c | `count(*)` over the whole table where existence is the question - a scan that grows with the association | GUARD - `exists`, so Postgres stops at the first row |
| 1d | The reader pool, which cannot answer this at all | GUARD - see below. `writerPool`, and the reason is not preference |
| 1e | A `true` answer for units belonging to *any* association - the join written but not applied | GUARD - the same assertion as 1a from the other side |

**1d is the one worth writing down.** The instinct is that a read belongs on `readerPool`: it is
SELECT-only, and AD-4 separates roles by pipeline stage. It cannot work here. Migration 003 revokes
**all** on `board_member` from `watchdog_reader` - deliberately, so *"the LLM-driven query path has no
business with credentials"* - and deriving an association from a member requires reading
`board_member`. A reader-pool version of this query fails at runtime with a permission error, on a
path that only executes when somebody uploads.

`unit-directory-postgres.ts` uses `readerPool` and does **not** scope by association, which is why it
has never hit this. That is a pre-existing gap AD-4 names itself - *"SELECT-only is a capability
control, not an isolation one"* - and it is not this story's to fix; noted under sibling defects.

**Cross-check (required by the workflow for a behaviour that reads persisted data):** the answer
agrees with `unitIdsFor`. If `hasUnits` says `false`, `unitIdsFor` returns an empty map for any
reference; if it says `true`, at least one unit exists to be found. Asserted against the fake in the
core test, since the two must not be able to disagree about the same association.

#### Task 2 - the refusal

**Behaviour: `uploadDocuments` refuses a deposit submission while the association holds no units.**

1. *If it ran correctly, how would I know?* A deposit submission on an association with no units
   returns `{ outcomes: [], error }` naming the roll, and nothing is stored. The same submission after
   a roll has produced units behaves exactly as it does today.
2. *How am I going to test it?* Through the action, with `createUnitCensus` mocked - the pattern
   `actions.test.ts` in `app/onboarding/mapping/` already uses for `createMappingStore`. The action is
   the seam; no new one is needed.
3. *What else can go wrong?* Below.
4. *Could this happen elsewhere?* The extract route (`app/api/documents/[id]/extract/route.ts`) is the
   other ingestion entry point, but it re-extracts a document already held rather than accepting a new
   one - there is no first upload to order. Checked, not assumed.

| # | Failure mode | Class |
| --- | --- | --- |
| 2a | The refusal placed after the files are read, so a large batch is held in memory to be rejected | GUARD - before the size checks, alongside the kind check, which is the position the file's own comments already argue for |
| 2b | Every kind refused, not just deposits - a roll could not be uploaded, so the trap becomes permanent and unescapable | GUARD - the *worst* failure here, because it locks the only way out. Asserted for all five kinds |
| 2c | The census throwing (a database blip) taking the upload down with a generic 500 | GUARD - caught, and the submission refused with a message the treasurer can act on. `actions.ts` in the mapping wizard set this precedent last story |
| 2d | The refusal applied when units *do* exist, blocking ordinary uploads forever | GUARD - the positive case is asserted, and it is the control: without it every other assertion here passes against an action that refuses everything |
| 2e | The census asked for someone other than the uploader | GUARD - asserted on the argument |
| 2f | The check running for every submission, costing a query on paths that cannot need it | NOTE - it runs only when the declared kind is `deposit`, which is also what 2b requires. One query on a path that is about to read files and write rows |

**Cross-check:** the refusal fires exactly when `hasUnits` is `false` - so a test that flips only the
census answer, holding the submission identical, must flip only the outcome. That is the inverse
relation this behaviour has instead of a round trip.

#### Task 3 - saying it before they choose

**Behaviour: the kind hint states the order.**

1. *If it ran correctly, how would I know?* A treasurer reading the form before choosing a kind is
   told the roll comes first. The refusal then confirms a rule they already knew rather than
   announcing one.
2. *How am I going to test it?* `upload-form.test.tsx` renders it already - jsdom, per-file opt-in
   (story 1.6c). Queried through the accessible description, not by scanning the document for a
   string, so the test fails if the text is present but not announced.
3. *What else can go wrong?* Below.
4. *Could this happen elsewhere?* The mapping wizard has the same hint-beside-a-control shape, and
   `heading-problems.test.tsx` is the nearest example of asserting one through its association.

| # | Failure mode | Class |
| --- | --- | --- |
| 3a | The sentence rendered but not associated with the control, so a screen-reader user reaches the select without it | GUARD - asserted through `aria-describedby`, which is what makes it a description rather than nearby text |
| 3b | The hint and the refusal drifting into two wordings of one rule | NOTE - not a shared constant. The two are different sentences on purpose: one is advice before a choice, the other is a refusal after it, and forcing them to share text would make both worse. The risk is real but small, and a constant would be the wrong fix |
| 3c | The existing sentence replaced rather than extended, losing "every file you choose is uploaded as this kind" | GUARD - that assertion already exists (`says the declaration applies to every file chosen`) and must stay green |
| 3d | The order stated as advice a treasurer may ignore, when it is now a refusal | GUARD - the wording says the upload will be refused, not that the order is "worth following". A hint that undersells an enforced rule is how somebody plans a session around uploading deposits first |

**Cross-check:** the form's claim and the action's behaviour must agree. The action refuses deposits
without units; the form must not promise anything the action does not do. Asserted by keeping both
assertions in one story and running the full suite - there is no shared symbol to bind them, which is
why 3b is recorded as an accepted risk rather than solved.

#### Task 4 - the re-import must not inherit this

**Behaviour: `core/mapping/reimport.ts` and its actions never reach the unit census.**

1. *If it ran correctly, how would I know?* A mapping change re-imports deposits and is unaffected
   by whether the census would answer yes - because it never asks.
2. *How am I going to test it?* Structurally. A behavioural test cannot prove a path did **not**
   acquire a guard: it can only show that today, on this input, the guard did not fire.
   `reimport-boundary.test.ts` already exists for exactly this shape of claim.
3. *What else can go wrong?* Below.
4. *Could this happen elsewhere?* The extract route is the other ingestion entry point; it
   re-extracts a document already held, so there is no first upload to order. Checked.

| # | Failure mode | Class |
| --- | --- | --- |
| 4a | The guard moved into `ingest` during a later tidy-up, so a mapping change fails for a reason about first-time setup | GUARD - the boundary test forbids the import, and `ingest` is where a well-meaning refactor would put it |
| 4b | The census reached through the shared `ingestionDependencies`, which both callers use | GUARD - asserted absent from the composition; adding it there would hand it to `ingest` and therefore to the re-import |
| 4c | The assertion written against a symbol no code would use, so it passes against everything | GUARD - a mutation adds the import to prove the test sees it. This is story 5.7's twelfth-instance defect, and the reason that check exists |

**Cross-check:** the upload path *does* reach the census and the re-import path does not - the same
assertion over both files, expecting opposite answers. A rule asserted only as an absence can pass
because the matcher is wrong; running it where the answer should be *present* proves the matcher
works.

### Review Findings

### Completion Notes List

**What this story does.** A deposit upload is refused while the association holds no units, before
any file is read, with a message naming the assessment roll. `docs/upload-contract.md` carried that
order as advice for two epics; it is now a rule the system keeps.

**The check is "do units exist", not "was a roll uploaded".** A roll uploaded as the wrong kind, or
unreadable, or with no valid rows, leaves a document behind and creates nothing - and the trap stays
open. Asking the question the deposits will ask is the only form that cannot drift from what it
protects.

**Only deposits are refused, and that is the load-bearing part.** Refusing every kind would refuse
the assessment roll, which is the only thing that creates units, and the situation would become
permanent rather than removed. Asserted across all five kinds.

**What the pool taught.** A SELECT belongs on `readerPool` by instinct, and cannot work here:
migration 003 revokes all on `board_member` from `watchdog_reader`, so deriving an association from
a member is not something the reader may do. A reader-pool version throws a permission error at
upload time rather than answering wrongly.

**Sibling defect found, not fixed.** `unit-directory-postgres.ts` uses the reader and does not scope
by association at all. That is pre-existing and is the gap AD-4 names about itself - "SELECT-only is
a capability control, not an isolation one" - and out of scope here. Recorded because question 4 of
the failure-mode analysis asks for it.

**`app/upload/actions.ts` had no test file.** `upload-form.test.tsx` mocks it away, so its session,
kind and file-count guards were argued for in comments and asserted nowhere. They are asserted now,
alongside the new one.

**Reviews.** Argus ran on Tasks 1, 2 and 3 and was clean each time. **Tasks 4 and 5 were exempt**:
their diff is entirely test files and `docs/upload-contract.md`, with no production change. Stated
explicitly, because a skipped check nobody mentions reads exactly like a check that passed.

**Eighteen mutations, eighteen killed.** Including two that a plain "disable the line" mutation
cannot reach: the ordering claim was tested by physically moving the guard below the size limits,
and the two prohibitions in Task 4 were tested by *adding* the forbidden import, since a prohibition
passes by construction and its only real red is the mutation.

**Not verified.** No database is configured on this machine, so `unit-census-postgres.test.ts`'s
four database assertions skipped. The SQL is asserted as text and has never executed.

### File List

**Added (4)**

- `adapters/db/unit-census-postgres.test.ts`
- `adapters/db/unit-census-postgres.ts`
- `app/upload/actions.test.ts`
- `core/ports/unit-census.ts`

**Modified (8)**

- `app/ingestion-dependencies.test.ts`
- `app/upload/actions.ts`
- `app/upload/upload-form.test.tsx`
- `app/upload/upload-form.tsx`
- `bmad-output/implementation-artifacts/5-8-the-order-that-works.md`
- `core/mapping/reimport-boundary.test.ts`
- `docs/upload-contract.md`
- `docs/upload-contract.test.ts`

`_bmad-output/**` is excluded: the story document and sprint status are this workflow's
bookkeeping, not the story's code.

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-24 | Story created from the epic row and `docs/upload-contract.md`'s "Order matters on a fresh install" |
| 2026-08-24 | `UnitCensus` port and its Postgres adapter — writer pool, because the reader may not read `board_member` |
| 2026-08-24 | `uploadDocuments` refuses a deposit submission while the association holds no units |
| 2026-08-24 | The upload form states the order, as an enforced rule rather than advice |
| 2026-08-24 | The re-import path and the shared composition asserted free of the census |
| 2026-08-24 | `docs/upload-contract.md` rewritten: the order is enforced, and the recovery is named |


## Questions for the author

These are recorded rather than guessed at, and none of them blocks Task 1.

1. **Should the held-payments screen tell the treasurer how to fix it?** Answered while writing this
   story: a roll arriving later does not clear existing holds, but re-uploading the deposits does,
   through AD-13's replace. That recovery is currently undocumented and unmentioned in the product.

   This story prevents the situation for *new* installs. It does nothing for an association already
   sitting on a screen of holds, and a sentence on that screen -- "these lines named units that did
   not exist yet; upload your assessment roll, then send this file again" -- may be worth more per
   line of code than the refusal itself. Deliberately out of scope here; raised because it is the
   other half of the same problem and this is the moment it is understood.

2. **Should the refusal be absolute, or overridable?** The story assumes absolute. A treasurer who
   genuinely wants deposits held — testing, or a roll that will arrive next week — has no way past it.
   An override would need a deliberate affordance and its own record, which is a larger story.

3. **Does anything else depend on the order?** Invoices and statements do not reference units, so
   they are unaffected as far as this analysis found. If a later feature attributes invoices to units,
   this refusal's scope becomes a decision rather than an obvious one.
