---
baseline_commit: 4be6c9d6c5740605a6a0168e98a40f187632675a
---

# Story 1.6d: Resolve a held document

Status: ready-for-dev

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
- [ ] **Task 3 — Suggestions for the queue** (AC4)
  - [ ] Extend the read so each held item can carry ranked candidates from
        `VendorDirectory.suggest()`. Trigram similarity, most similar first.
  - [ ] **Nothing preselected.** `suggest`'s own doc comment says a caller treating the first entry
        as an answer has reintroduced automatic near-matching. The surface shows a score so the
        ordering is explainable, and requires an explicit choice.
  - [ ] Decide and record where suggestions are fetched — per item inside the queue read, or a
        second call. Watch the N+1: a queue of thirty items must not make thirty round trips.
- [ ] **Task 4 — The surface** (AC1, AC2, AC4, AC6)
  - [ ] Server actions in `app/quarantine/`, following `app/upload/actions.ts` for the established
        `'use server'` shape.
  - [ ] Each row gains: confirm-as-new, and a choice among suggestions. Tokens only —
        `core/design/no-raw-values.test.ts` scans everything under `app/`.
  - [ ] **The action re-checks the session itself.** A server action is a separate entry point from
        the page; the page's guard does not cover it (AC6). Assert the write is refused before
        anything is written, as `app/quarantine/page.test.tsx` asserts for the read.
  - [ ] Rendering tests via the harness 1.6c added: `// @vitest-environment jsdom`, and explicit
        `afterEach(cleanup)` — there is no `globals: true`, so renders otherwise accumulate.
- [ ] **Task 5 — Retire the expired assertion** (AC1)
  - [ ] `app/quarantine/queue-list.test.tsx` asserts `offers no control that could resolve
        anything` — zero buttons, forms, inputs, links. **This story makes that premise false**, and
        it is the exact case `_bmad/custom/review-gate.md` calls an *expired* test: it will fail
        loudly, look like a regression, and tempt a weakening.
  - [ ] Replace it, do not delete it. The property worth keeping is that the queue offers exactly
        the controls this story adds and no others — an allow-list, since story 1.6c's review showed
        a deny-list passes anything nobody listed.
  - [ ] Say so in the commit body. A reviewer seeing a deleted "no controls" test needs to know it
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

### Debug Log References

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

### Completion Notes List

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

### Change Log

- 2026-08-06 — Story created. Scope is epic AC3: confirm as new, or match to existing, atomically.
  Three decisions recorded ahead of implementation — a separate write port, no `extraction.vendor_id`
  while the ingest path still discards the resolved id, and no migration because migration 002's
  default privileges already cover the writes. Status -> ready-for-dev.
