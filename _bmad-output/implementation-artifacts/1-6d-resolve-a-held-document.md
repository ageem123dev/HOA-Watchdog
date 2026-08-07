---
baseline_commit: 4be6c9d6c5740605a6a0168e98a40f187632675a
merge_request: 20
---

# Story 1.6d: Resolve a held document

Status: done

> **Last of four stories from epic story 1.6.**
> **1.6a** built the matching rule, **1.6b** held unresolved vendors, **1.6c** made the queue
> visible. This closes it: the treasurer answers, and the document leaves.

## Story

As a treasurer,
I want to say who an unrecognised vendor is — a new one, or one we already know —
So that the document finishes processing against a real identity instead of waiting forever.

## Acceptance Criteria

**AC1 — confirm as a new vendor** *(epic story 1.6 AC3)*

**Given** a quarantined item whose extracted name belongs to a vendor nobody has recorded
**When** the treasurer confirms it as new
**Then** a vendor is created carrying that name, the hold is cleared, and the item leaves the queue

**AC2 — match to an existing vendor** *(epic story 1.6 AC3)*

**Given** a quarantined item whose extracted name is a misspelling of a vendor already recorded
**When** the treasurer matches it to that vendor
**Then** **no vendor is created**, the hold is cleared, and the item leaves the queue

**AC3 — both halves, or neither**

**Given** a resolution that fails partway
**When** the failure occurs
**Then** the system is left either fully resolved or fully unresolved — never with a hold cleared and
no vendor recorded, which would drop the question with nobody having answered it

**AC4 — suggestions rank, they never decide**

**Given** a held name similar to known vendors
**When** the treasurer views it
**Then** candidates are offered most-similar first, and **nothing is preselected or auto-applied** —
`AUTO_RESOLVE_RULE` stays normalised-exact and this surface does not widen it

**AC5 — resolving twice is not an error**

**Given** an item already resolved, in another tab or by another board member
**When** a second resolution is submitted for it
**Then** the treasurer is told it is already resolved rather than shown a failure, and no duplicate
vendor is created

**AC6 — closed by default**

**Given** an unauthenticated visitor
**When** they submit a resolution
**Then** it is refused before anything is written

## Tasks / Subtasks

- [x] **Task 1 — The write port** (AC1, AC2, AC3, AC5)
  - [x] `core/ports/vendor-resolution.ts`. This is the port `core/ports/quarantine-queue.ts` says
        does not exist yet; adding these methods to `QuarantineQueue` would delete that argument, and
        1.6c has a test asserting that port declares exactly `held()`.
  - [x] **Two methods, not one with a flag.** `confirmAsNew(documentId, extractedName)` and
        `matchToExisting(documentId, extractedName, vendorId)`. `VendorDirectory` split `resolve`
        from `suggest` for exactly this reason, and its header says why: a single call that can
        either create or match is how a suggestion silently becomes a resolution.
  - [x] A returned outcome, not a throw, for "already resolved" (AC5) — it is an ordinary race, not
        a fault.
- [x] **Task 2 — The Postgres adapter, on the *writer* connection** (AC1, AC2, AC3, AC5)
  - [x] `adapters/db/vendor-resolution-postgres.ts` using `readWriterDatabaseUrl()`. 1.6c's queue
        adapter uses the reader because it only reads; this writes, and AD-4 puts writes on the
        writer.
  - [x] **No migration is needed.** Verified against the live database: `watchdog_writer` already
        holds INSERT/UPDATE/DELETE/SELECT on both `vendor` and `quarantine_item`, granted by
        migration 002's `alter default privileges`, which exists precisely so later tables inherit
        the split. Do not add a migration to grant what is already granted.
  - [x] **One transaction per resolution** (AC3). Create-or-match the vendor, then delete the hold,
        then commit. A crash mid-way must not clear a hold without recording a vendor.
  - [x] Handle `23505` on the vendor insert: two treasurers confirming the same new name race, and
        the loser should resolve *to the winner's row* rather than fail. `on conflict … do nothing`
        plus a re-select, or `on conflict … do update` returning the id.
  - [x] Deleting zero rows means somebody already resolved it — return that outcome (AC5), do not
        treat it as success.
  - [x] Database tests scoped per test, as `quarantine-queue-postgres.test.ts` does. Its first
        version scoped per *file* and the tests stopped being independent.
- [x] **Task 3 — Suggestions for the queue** (AC4)
  - [x] Extend the read so each held item can carry ranked candidates from
        `VendorDirectory.suggest()`. Trigram similarity, most similar first.
  - [x] **Nothing preselected.** `suggest`'s own doc comment says a caller treating the first entry
        as an answer has reintroduced automatic near-matching. The surface shows a score so the
        ordering is explainable, and requires an explicit choice.
  - [x] Decide and record where suggestions are fetched — per item inside the queue read, or a
        second call. Watch the N+1: a queue of thirty items must not make thirty round trips.
- [x] **Task 4 — The surface** (AC1, AC2, AC4, AC6)
  - [x] Server actions in `app/quarantine/`, following `app/upload/actions.ts` for the established
        `'use server'` shape.
  - [x] Each row gains: confirm-as-new, and a choice among suggestions. Tokens only —
        `core/design/no-raw-values.test.ts` scans everything under `app/`.
  - [x] **The action re-checks the session itself.** A server action is a separate entry point from
        the page; the page's guard does not cover it (AC6). Assert the write is refused before
        anything is written, as `app/quarantine/page.test.tsx` asserts for the read.
  - [x] Rendering tests via the harness 1.6c added: `// @vitest-environment jsdom`, and explicit
        `afterEach(cleanup)` — there is no `globals: true`, so renders otherwise accumulate.
- [x] **Task 5 — Retire the expired assertion** (AC1)
  - [x] `app/quarantine/queue-list.test.tsx` asserts `offers no control that could resolve
        anything` — zero buttons, forms, inputs, links. **This story makes that premise false**, and
        it is the exact case `_bmad/custom/review-gate.md` calls an *expired* test: it will fail
        loudly, look like a regression, and tempt a weakening.
  - [x] Replace it, do not delete it. The property worth keeping is that the queue offers exactly
        the controls this story adds and no others — an allow-list, since story 1.6c's review showed
        a deny-list passes anything nobody listed.
  - [x] Say so in the commit body. A reviewer seeing a deleted "no controls" test needs to know it
        was superseded rather than dropped.

## Dev Notes

### What this story does not do

**It does not add `extraction.vendor_id`.** The architecture says vendors are referenced by id and
never by extracted name, so linking extraction rows to the vendor looks like the natural finish. It
is deliberately out of scope, for a concrete reason: **the ingest path already discards the resolved
id.** `resolve()` returns `{outcome: 'resolved', vendorId}` and stories 1.6a/1.6b use it only to
decide whether to quarantine — nothing persists it. Adding the column here would populate it *only*
for documents that were once held, leaving a column that is set on one path and empty on the other,
which is worse than no column: every later reader has to know which half to trust.

Recorded as a follow-up naming both paths — whoever needs vendor identity downstream (epic 3's
anomaly detection is the first that will) adds the column and fills it from ingestion **and**
resolution in one change.

**It does not keep a record of the decision.** The hold is deleted rather than marked resolved. That
satisfies "leaves the queue" without touching 1.6c's query, which is a file merged hours ago. If an
audit trail of who confirmed what is wanted, NFR-5's provenance table is where it belongs, not a
`resolved_at` column bolted to a queue.

### What the previous three stories hand over

- **`vendor`**: `id`, `display_name`, generated `normalised_name`, unique index on the normalised
  form. Creating a vendor means inserting a `display_name` — the folded form follows.
- **`quarantine_item`**: unique on `(document_id, normalised_name)`. Resolution deletes by
  `document_id` plus the name, not by id alone, so a stale id from a rendered page cannot delete
  something else.
- **`VendorDirectory.suggest(name, limit)`** already exists and is unused so far. This story is its
  first caller — check it behaves as documented rather than assuming. It **throws `RangeError`** on a
  limit that is not a non-negative integer, so the limit is a decision this story makes explicitly,
  not a value threaded through from a request.
- **`QuarantineQueue.held()`** returns `documentId`, `filename`, `extractedName`. No id. If Task 3
  needs the quarantine row's id, that is a port change with a test to update (1.6c pins the field
  set exactly).

### Learnings that apply directly

- **A deny-list fails open.** 1.6c's port test listed forbidden names; `archive()` and `storage_key`
  both walked through. Every "must not contain" assertion in this story should be "must equal".
- **Check what lost cover.** Task 5 exists because of this. Story 1.6c's review found a control
  deleted by a rewrite, and separately a control that had never tested anything.
- **`tsc --noEmit` sees what `npm run build` does not.** 1.6c added seven type errors in test files
  that lint and build both passed. Run it; the baseline is 8.
- **"That cannot happen" is the moment to measure.** Twice in 1.6b a guard was dismissed as
  unreachable and twice it was reachable.

### Project Structure Notes

- `core/` imports nothing outward (`core/ports/boundary.test.ts`).
- Server actions live beside the page, as `app/upload/actions.ts` does.
- Route `/quarantine` already exists and is closed by default — `PUBLIC_ROUTES` is an allow-list.

### Testing standards

- **"Tested" = `npm run lint` + `npm run build` + `npm test`**, plus `npm run test:db` for Task 2.
  Neither ESLint nor Vitest type-checks.
- Database tests take a fresh scope per test in `beforeEach`, not per file.
- Every new test faces the sensitivity check: break the code it covers, confirm it fails, restore.

### Verified while writing this story

- `watchdog_writer` holds `SELECT, INSERT, UPDATE, DELETE` on `vendor` and `quarantine_item` — read
  from `information_schema.table_privileges` against the live database, not inferred.
- `extraction` has `vendor_name text` and **no** `vendor_id`; no migration references one.
- `VendorDirectory` declares `resolve` and `suggest` only — there is no create path today.
- `QuarantineQueue` declares exactly `held()`, pinned by an allow-list test.
- `app/quarantine/queue-list.test.tsx` currently asserts zero buttons, forms, inputs and links, at
  line 83.
- `app/upload/actions.ts` is the `'use server'` composition-root pattern to follow — it is where the
  adapters and the domain meet, and the only place they do.

### References

- [Source: epics.md#Story-1.6] — AC3 is this story's whole contract; AC1, AC2, AC4 and AC5 belong to
  the three stories before it
- [Source: ARCHITECTURE-SPINE.md#AD-8] — unknowns route to a human and never auto-create
- [Source: ARCHITECTURE-SPINE.md#AD-4] — writes go on `watchdog_writer`
- [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions] — "Vendors are referenced by id, never by
  extracted name", which is why the missing `extraction.vendor_id` is recorded rather than ignored
- [Source: EXPERIENCE.md] — *Sarah confirms an unknown vendor*, steps 3 and 4
- [Source: core/ports/quarantine-queue.ts] — states that the write port belongs to this story
- [Source: migrations/002_roles.sql] — `alter default privileges`, which is why no migration is needed

## Dev Agent Record

### Agent Model Used

### Test Design

## Task 1 - the write port

Like story 1.6c's read port, this is a type declaration with no runtime presence, so `npm run build`
proves the positive shape and a comment-stripped source test proves the negatives no compiler checks.
Story 1.6c's review established the form those assertions take: **allow-lists**, because a deny-list
passes anything nobody thought to list -- `archive()` and `storage_key` both walked through one.

### Behaviour A - `VendorResolution` declares two operations and no third (AC1, AC2)

1. **Correct-run signal:** the file declares exactly `confirmAsNew` and `matchToExisting`, and a
   result type that can express "already resolved" without throwing.
2. **How to test it:** read the source, strip comments, compare the declared method set to an exact
   allow-list.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| A1 | A third method appears that can both create and match -- a `resolve(documentId, name, vendorId?)` with an optional id is exactly how a suggestion becomes a resolution, and it is what `VendorDirectory`'s header warns against | GUARD - exact allow-list |
| A2 | `matchToExisting` grows a "create if missing" fallback, which makes AC2's "no vendor is created" untrue while the method name still says otherwise | GUARD - the outcome type has no create-on-match case, so the caller cannot be told one happened |
| A3 | The source test matches the file's own prose rather than its declarations | GUARD - strip comments, plus a control that exercises stripping through a block comment whose inner lines begin with identifiers. Story 1.6c's first two attempts at this control tested nothing |
| A4 | An operation smuggled in via an index signature or declaration merging | OUT-OF-SCOPE - recorded. A source-text test cannot see through those; review is the backstop |

### Behaviour B - the outcome type distinguishes four endings (AC1, AC2, AC5)

1. **Correct-run signal:** a caller can tell apart *created a vendor*, *matched an existing one*,
   *somebody already resolved this*, and can do so without catching an exception.
2. **How to test it:** the same source read for the declaration; the meanings are exercised by
   Task 2's adapter tests.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| B1 | "Already resolved" is modelled as a thrown error, so the surface has to catch to render an ordinary outcome -- and a caller that forgets shows a treasurer a crash for a race that is expected (AC5) | GUARD - it is a returned variant |
| B2 | The outcome carries the created vendor's *name* rather than its id, inviting a caller to compare names -- the architecture says vendors are referenced by id, never by extracted name | GUARD - assert the declared field names exactly |
| B3 | Success and already-resolved are the same value, so the surface cannot tell a treasurer which happened | GUARD - distinct variants, asserted |


## Task 2 - the adapter, and the transaction

One behaviour with two entry points. Both must leave the database in one of exactly two states, and
the interesting failure modes are all about the space between the two writes.

### Behaviour C - `confirmAsNew` (AC1, AC3, AC5)

1. **Correct-run signal:** a `vendor` row exists carrying the extracted name, the matching
   `quarantine_item` row is gone, and the outcome names the new vendor's id.
2. **How to test it:** against the real database, seeded through the writer and read back — the
   reverse-it test this behaviour needs. Per-test scoping in `beforeEach`, as
   `quarantine-queue-postgres.test.ts` arrived at after its per-file version made the tests
   dependent on each other.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| C1 | The hold is deleted but the vendor insert fails -- the document silently leaves the queue with nobody having answered, and no surface will ever ask again. **The worst outcome in this story** | GUARD - one transaction; proven by forcing the insert to fail and asserting the hold survives |
| C2 | The vendor is created but the delete fails, leaving the item in the queue with a vendor already recorded. Recoverable, because a second attempt now matches, but it must not report success | GUARD - same transaction |
| C3 | Two treasurers confirm the same new name; the unique index on `normalised_name` rejects the second with `23505` and the loser sees a constraint violation instead of an answer | GUARD - `on conflict do nothing` plus re-select, returning `matched` |
| C4 | The item was already resolved, so the delete removes zero rows, and the code reports success anyway -- creating a second vendor for a name somebody already answered | GUARD - check the delete's row count *before* committing, return `already-resolved` |
| C5 | A name that normalises to something an existing vendor already owns, submitted as "new" -- not a race, just a treasurer who did not spot the near-match | GUARD - the same `23505` path as C3; the honest answer is `matched`, not a duplicate row |
| C6 | The connection dies mid-transaction | PROPAGATE - Postgres rolls back; nothing to write here beyond releasing the client in a `finally` |
| C7 | A client is checked out of the pool and never released on the error path, exhausting the pool at five | GUARD - `finally { client.release() }` |

### Behaviour D - `matchToExisting` (AC2, AC3, AC5)

1. **Correct-run signal:** the hold is gone, the outcome names the vendor asked for, and the
   `vendor` table has exactly as many rows as before.
2. **How to test it:** as above. The **cross-check** is a count of `vendor` taken before and after:
   AC2's "no vendor is created" is a conservation property, and asserting the count is independent of
   asserting the outcome.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| D1 | It creates the vendor when the given id does not exist -- the "create if missing" fallback AC2 forbids | GUARD - the id is verified to exist and a missing one is an error, never an insert |
| D2 | A vendor id that does not exist is accepted and the hold cleared anyway, so the document leaves the queue pointing at nothing | GUARD - verify inside the transaction, before the delete |
| D3 | Already resolved, as C4 | GUARD - same row-count check |
| D4 | The caller passes a well-formed but wrong-shaped id and Postgres raises `22P02` invalid text representation rather than a clean answer | PROPAGATE - a malformed id is a programming error at the call site, not a treasurer's mistake; it must not be swallowed into "not found" |

**Cross-check (required):** every resolution asserts both the vendor-table row count *and* the
quarantine row's absence. The two are independent readings of "resolved", and a bug that satisfied
one while breaking the other -- creating a duplicate vendor, or clearing the wrong hold -- is exactly
what a single assertion would miss.

## Task 3 - suggestions

**Where they attach, decided before writing any.** Not on `HeldItem`, and not as a new method on
`QuarantineQueue`: story 1.6c pins both with allow-lists, and widening them would make this story
edit assertions that are still true. Suggestions ride on the *view* instead, keyed by normalised
name — `toQueueView(items, suggestions)` gains a lookup, and `view.items` keeps the exact shape 1.6c
asserts.

**The N+1 is answered by deduplication, not by batching.** Two documents held for the same vendor
name are one question asked twice, so the page asks `suggest()` once per *distinct normalised name*.
On a queue where every name differs this is still one call per item, which is the honest cost; the
queue is a human work list and if it ever grows past that, the fix is a batched query, not a cache.

### Behaviour E - `distinctNamesForSuggestions(items)` (AC4)

1. **Correct-run signal:** one entry per distinct normalised name, carrying the first spelling seen.
2. **How to test it:** a pure function over plain data, node-tested.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| E1 | Deduplicates on the raw name, so `Acme` and `ACME  ` ask twice for one question — and the two answers arrive under different keys, so one row silently shows none | GUARD - dedupe on `normaliseVendorName`, the same rule the database indexes |
| E2 | Returns the normalised form as the name to look up, so `suggest()` ranks against a folded string rather than what the document said | GUARD - keep the first spelling, return it verbatim |
| E3 | An empty queue produces a call with an empty list, or `undefined` | GUARD - zero-one-many |

### Behaviour F - the view carries suggestions (AC4)

1. **Correct-run signal:** a row can find its candidates; a row with none renders without them.
2. **How to test it:** `toQueueView` with a supplied map, node-tested.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| F1 | Suggestions are looked up by raw name, so a row whose spelling differs from the key finds nothing and quietly offers no candidates (the same defect as E1, one layer down) | GUARD - look up by normalised name on both sides |
| F2 | The view re-sorts candidates, so the ranking `suggest()` computed is replaced by an alphabetical one that looks equally plausible | GUARD - order preserved, tested with a deliberately non-alphabetical input |
| F3 | Omitting the argument changes `view.items`, breaking story 1.6c's assertions on a shape that is still correct | GUARD - suggestions live beside `items`, not inside them; 1.6c's tests must keep passing untouched |
| F4 | A candidate is marked selected or defaulted | GUARD - the view carries no selection at all, so there is nothing for a surface to preselect |

## Tasks 4 and 5 - the surface, and the assertion it invalidates

Taken together because they are one change: the queue gains controls, and story 1.6c's
`offers no control that could resolve anything` is the assertion that says it has none. Splitting
them would leave a commit where the suite is red on purpose.

### Behaviour G - the resolve action (AC1, AC2, AC6)

1. **Correct-run signal:** a signed-in member's submission reaches the port and returns its outcome;
   an unauthenticated one is refused with nothing written.
2. **How to test it:** the action is a module import, so `vi.mock` supplies `auth` and the
   resolution port. The assertion that matters for AC6 is *ordering* - refused before the port is
   touched, exactly as `app/quarantine/page.test.tsx` asserts for the read.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| G1 | The action trusts the page's guard. A server action is its own entry point and is reachable without ever rendering the page, so a page-only check protects nothing | GUARD - assert the port is never called when there is no session |
| G2 | The session is checked *after* the resolution, so an unauthenticated caller still writes | GUARD - assert call ordering, not merely the refusal |
| G3 | A vendor id arrives from the form and is passed through unchecked, letting a caller match a document to any vendor id they care to type | GUARD-at-the-boundary is the adapter's `select id from vendor` - this is data from a trusted-but-authenticated user, and the adapter already refuses an id that names nothing. Recorded here so the next reader does not add a second check in a third place |
| G4 | `already-resolved` is rendered as a failure, so a treasurer who double-clicks is told something went wrong | GUARD - the outcome is surfaced as an ordinary result |
| G5 | The action throws on a port error and the surface shows a stack trace | PROPAGATE - Next renders the error boundary; nothing here should swallow a genuine fault into a friendly message that hides it |

### Behaviour H - the queue offers exactly these controls (AC1, AC2, AC4)

1. **Correct-run signal:** each row renders a confirm-as-new control and one control per candidate,
   and nothing else.
2. **How to test it:** rendering tests through the 1.6c harness.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| H1 | A candidate is preselected, or the most similar is marked as the default | GUARD - AC4; assert no control is checked, selected or marked default |
| H2 | The retired assertion is *deleted* rather than replaced, losing the only check on what the queue offers | GUARD - Task 5; replaced with an allow-list of exactly the controls this story adds |
| H3 | The allow-list is written as another deny-list ("no `select`"), which passes anything nobody listed - the failure story 1.6c's review found | GUARD - count the controls, do not enumerate the forbidden ones |
| H4 | The empty state grows a control | GUARD - assert zero controls when nothing is waiting |

### Debug Log References

**Tasks 4-5 red.** An action with no session check failed five assertions, all of the form "the port
was called anyway". The replacement control assertion failed on counts, because no controls existed.

**The component stopped being testable, and the suite said so.** Importing the actions into
`QueueList` pulled `next-auth` in through `'use server'`, and the whole rendering file failed to load
with `Cannot find module 'next/server'`. The actions became props: the page supplies them, the
component stays presentational, and the tests need no server at all. That is the test-design
reference's rule applied literally — when the honest answer is "I cannot test this without standing
up the world", the design is wrong, and the fix is the design.

**Sensitivity, and one that did not bite.** Checking the session *after* resolving failed the
ordering assertions immediately. Preselecting the top candidate with
`autoFocus={candidate.score > 0.5}` **passed** — because React sets `autoFocus` as a DOM property and
the test queried the `[autofocus]` attribute. A guard that proved nothing, inside the test written to
catch exactly that. Rewritten against `document.activeElement` and element properties; the same
mutation now fails with `expected <button …> to be <body>`.

**Two type errors of my own after the refactor.** `tsc` went 8 -> 14: four test call sites my edit
missed, and a `ResolveAction` returning `Promise<unknown>` where React's `formAction` accepts only
`void`. Both fixed; back to 8. Lint and build were green throughout, which is the third story running
where `tsc --noEmit` was the only gate that saw the problem.


**Task 1 red.** All five structural assertions failed on empty sets; the comment-stripping control
passed, correctly, since it runs against a sample string rather than the file.

**Task 2 red.** A deliberately non-transactional stub — delete the hold, then insert the vendor, no
`begin` — failed six assertions: the race returned `created` twice, already-resolved returned
`matched`, the hold did not survive a failed insert, an unknown vendor id resolved anyway, and
answering one of two names on a document cleared both.

**Task 2, my test was wrong before the code was.** `leaves the hold in place when the vendor cannot
be created` held one name and confirmed a different one, so the run stopped at `already-resolved`
before ever reaching the insert it meant to break. Forcing the real path needs a name that *matches
the hold* and still fails the vendor write: 300 trailing spaces normalise away, so the hold matches,
while `display_name` is measured before folding and lands past 200 characters. That asymmetry is the
one story 1.6b's guard was rebuilt around.

**Task 2 sensitivity, twice.** Removing `begin` failed exactly the C1 test, with the hold gone
(`expected +0 to be 1`). Removing the already-resolved check failed exactly the C4 test
(`expected 'matched' to be 'already-resolved'`).


### Review Findings

**Converged after one merge-request round.** CodeRabbit resolved all seven threads itself; pipeline
green on `a558949`. As on story 1.6c the clean line arrived inside the summary comment rather than a
standalone review note, so convergence was taken from the thread resolutions — an unambiguous
service-account statement about the current head — rather than from the summary.


**Merge-request round 1** on `f41cea9` — **7 findings, all on this story, all fixed.** Pipeline green.

Three were the same defect this project keeps meeting, in three new places. A `rejects.toThrow()`
with no argument passed for *any* rejection — a missing function, a wrong column, a dead connection —
while the two state assertions beside it still held, because nothing was written in those cases
either; it is now constrained to the length violation it was built around. A `revalidatePath` mock
created inside the factory was reachable by no test, so deleting the call from the action left every
test passing while a resolved row kept rendering from cache. And a concurrency `limit` of zero made
`Math.min` create no workers, so `Promise.all([])` resolved at once and returned a sparse array of
`undefined` as though the work had succeeded.

Two more were narrower but real: the database suite gated on `WATCHDOG_READER_DATABASE_URL`, which it
never uses, so an environment with only the writer skipped the whole file while the run reported
success; and the XSS test asserted only that no `role="status"` existed, passing against a regression
that rendered the value elsewhere. It now asserts the text is absent from the page entirely.

The remaining two: a client whose `rollback` failed is now released with an error so `pg` destroys it
rather than returning a possibly-in-transaction connection to the pool, and the swallowed adapter
error is logged before `refused` is reported — a deleted vendor, an exhausted pool and a statement
timeout otherwise reach the treasurer as one sentence with no trace of which happened.

**One finding from the fix-diff gate did not reproduce, and the fix was reverted.** Argus reported
that workers failing after the first would produce unhandled rejections. `Promise.all` attaches a
handler to every promise it is given, so a later rejection is handled — merely not reported — and the
sensitivity check confirmed it: removing the guard changed nothing, because the test written for it
could not fail. Both the guard and its test were removed. A guard no test can force is the thing this
workflow's Prime Directive forbids, and keeping it because a reviewer suggested it would have been
the same mistake with better manners.


**IDE round 1** on `06e51c0` — 17 comments, **8 on this story**. Six fixed, one skipped, three belong
to another branch.

*Two concurrency defects in the adapter, both real and both invisible to a runtime test.* The vendor
check was a bare `select`, proving only that the row existed when read — a concurrent delete before
commit clears the hold pointing at a vendor that is gone, which is the failure the check exists to
prevent arriving one step later. Now `for key share`, the weakest lock that blocks deletion. And
`begin` inherited `default_transaction_isolation`: `confirmAsNew`'s conflict-then-select is only
correct under `read committed`, and under `repeatable read` it would roll back a correct
confirmation. Now stated in the SQL. Neither can be forced deterministically from a test — the
interleaving that exposes them is the one the database is free not to produce — so both are asserted
in the query text, the same two-instrument answer story 1.6c reached for its ordering tiebreak.

*A thrown adapter error reached the treasurer as a framework error page.* A vendor deleted between
render and submit makes `matchToExisting` throw, and the throw skipped the redirect that AC5's
sentence depends on. The port call is now wrapped and reported as `refused` — the catch is around
`run()` only, because `redirect` signals control flow by throwing and wrapping it would turn every
success into a reported failure.

*Unbounded suggestion queries.* `Promise.all` opened one per distinct name against a pool of five, on
every render. Now bounded at four, leaving one spare for the queue read.

**And the fix contained the next defect**, which is the pattern this project keeps meeting: the
bounded helper did not stop its remaining workers when one failed, so after `Promise.all` had already
rejected the others kept taking work, and a second failure would have become an unhandled rejection
with nobody left to receive it. Reproduced (`expected 6 to be less than or equal to 2`), fixed, and
the guard verified by removing it.

**Skipped, with the reason already recorded before implementation:** persisting a document-to-vendor
link. The story's Dev Notes explain it — the ingest path discards the resolved id today, so a column
written only here would be populated for documents that were once held and empty for every other,
leaving each later reader to guess which half to trust. It belongs in one change that fills it from
both paths.

**Ingest:** 4 reviews compared cumulatively, recall 0.12, confirmed_rate 0.67, 11 lessons written.


### Completion Notes List

**Tasks 4 and 5.** The action checks the session itself and asserts the port is never touched without
one (G1, G2) — a server action is its own entry point and the page's guard does not reach it. Missing
form fields are a refusal rather than a coerced string (`String(null)` is `"null"`, which would have
deleted a hold for an impossible document id and reported success). A submission with no candidate
chosen is refused, never guessed at: guessing is the automatic near-matching this epic exists to
prevent, wearing a form's clothes.

Story 1.6c's `offers no control that could resolve anything` was **replaced, not deleted** (H2). Its
premise expired the moment resolving became possible. The replacement counts the controls a row
offers rather than enumerating forbidden ones (H3), because 1.6c's own review showed a deny-list
passes anything nobody listed.

**Review findings, all three acted on.** The inline `'use server'` wrappers moved out of the page and
into `actions.ts`, which declares it at file scope — the lint failure Argus attributed to them did not
reproduce here, but a module-scope inline directive is a shape Next.js does not promise to support.
The `as never` cast in the mocks was replaced with mocks typed against the port's own outcomes, since
a cast that admits `already-resolved` would equally admit a wrong shape. And the match path gained
the session cases the confirm path already had — two entry points to one guard need the same
coverage, or the untested one is where it rots.

**AC5's wording, finished rather than waived.** An earlier pass stopped at "the row disappears",
which is feedback of a sort and is indistinguishable from somebody else having answered first — so it
met AC5's substance and not its words. The wrappers now redirect with the outcome and the page renders
a sentence for it. No client component was needed; `useActionState` would have been the heavier
answer to a question a query parameter settles.

The message mapping is a pure function with an allow-list of four outcomes, because the parameter
arrives from a URL anybody can type. An unrecognised value renders nothing rather than being echoed
back onto the page above the association's records — covered by a test using a `<script>` payload.

**One process slip, recorded.** `resolution-message.ts` was written before its test, so no red was
ever observed for it. Verified after the fact by mutation instead: replacing the mapping with
`return outcome ?? null` fails four of the six cases, including the URL-injection one. That is
evidence the tests discriminate, but it is not the same as having watched them fail first.


**Task 3.** Suggestions ride beside `items`, not inside them, so story 1.6c's allow-list on the held
item shape stays true and untouched — this story had no business editing an assertion that is still
correct (F3). Lookups fold on both sides using the same rule the database indexes under (E1, F1); a
row whose spelling differs by a space would otherwise offer no candidates, which on the page is
indistinguishable from a name resembling nothing. Ranking is preserved, not re-sorted (F2), and the
view carries no selection at all, so there is nothing for a surface to preselect (F4, AC4).

The N+1 is answered by deduplicating on the folded name — two documents held for one vendor are one
question — and where every name differs the cost is one call per row. Recorded rather than hidden:
if the queue outgrows that, the answer is a batched query, not a cache.

**Review finding, confirmed and fixed test-first.** `suggestions[key] ?? []` on a plain object
returns `Object.prototype` members for a name folding to `constructor`, `toString` and friends — a
function where the caller expects an array, and `?? []` never fires because the value is not nullish.
Reproduced (`expected [Function Object] to deeply equal []`), fixed with `Object.hasOwn`, and covered
for every prototype member rather than the one that was named. "No vendor is called that" is the
reasoning this project has been wrong about twice, and AD-8 is explicit that an extracted name is
untrusted data.


**Task 1.** Two operations and no third, with the outcome type doing the work a comment would
otherwise do: `matchToExisting` cannot return `created`, so AC2's "no vendor is created" is a
property of the type rather than a promise. `already-resolved` is a returned variant, not a throw
(B1) — a race between two tabs is ordinary, and as an exception every caller would have to catch it
to render something expected.

**Task 2.** One transaction per resolution. The dangerous half-state is a hold cleared with no vendor
recorded: the document leaves the queue and no surface asks again (C1). The reverse is merely untidy,
because the next attempt matches. Guarded: the race between two confirmations of one name (C3/C5, via
`on conflict do nothing` and a re-select), the already-answered item (C4), an unknown vendor id
(D1/D2, checked before the hold is cleared), a pool client leaked on the error path (C7, `finally`),
and answering one of two names on a document without answering the other.

Propagated deliberately: a malformed uuid raises `22P02` and is left to escape (D4). That is a fault
at the call site, and reporting it as "no such vendor" would hide a bug in whatever built the form.

Adversarial review (Argus) clean on both task diffs.


### File List

- `core/ports/vendor-resolution.ts` (new)
- `core/ports/vendor-resolution.test.ts` (new)
- `adapters/db/vendor-resolution-postgres.ts` (new)
- `adapters/db/vendor-resolution-postgres.test.ts` (new)
- `core/quarantine/suggestions.ts` (new)
- `core/quarantine/suggestions.test.ts` (new)
- `core/quarantine/queue-view.ts` (modified — suggestions beside `items`)
- `core/quarantine/queue-view.test.ts` (modified — suggestion cases appended)
- `app/quarantine/actions.ts` (new)
- `app/quarantine/actions.test.ts` (new)
- `app/quarantine/queue-list.tsx` (modified — controls, actions as props)
- `app/quarantine/queue-list.test.tsx` (modified — expired assertion replaced)
- `app/quarantine/page.tsx` (modified — suggestions fetched, actions passed, outcome reported)
- `app/quarantine/page.test.tsx` (modified — outcome-reporting cases)
- `core/quarantine/resolution-message.ts` (new)
- `core/quarantine/resolution-message.test.ts` (new)
- `core/quarantine/bounded.ts` (new)
- `core/quarantine/bounded.test.ts` (new)
- `adapters/db/vendor-resolution-sql.test.ts` (new)

### Change Log

- 2026-08-06 — One IDE round (8 findings) and one merge-request round (7 findings), all fixed or
  answered. Three of the merge-request findings were the same defect in new places: a bare
  `rejects.toThrow()`, a mock no test could reach, and a concurrency limit of zero returning a sparse
  array as success. One finding from the fix-diff gate did not reproduce and its fix was reverted,
  because the test written for it could not fail. Status -> done. Closes epic story 1.6.
- 2026-08-06 — Story created. Scope is epic AC3: confirm as new, or match to existing, atomically.
  Three decisions recorded ahead of implementation — a separate write port, no `extraction.vendor_id`
  while the ingest path still discards the resolved id, and no migration because migration 002's
  default privileges already cover the writes. Status -> ready-for-dev.
