---
baseline_commit: b57140974ae3b83cac7cb39080362947acca3a55
merge_request: 16
---

# Story 1.6b: Hold unknown vendors for a human

Status: review

> **Second of four stories from epic story 1.6.**
> **1.6a** built the mechanism: a `vendor` table, one normalisation, and a directory whose `resolve`
> decides by normalised-exact equality while `suggest` only ranks.
> **This story is the first thing that calls it**, from ingestion, and holds a document whose vendor
> it does not recognise.
> **1.6c** shows the queue. **1.6d** resolves from it.
>
> **Depends on 1.6a.** Merged in `a314649`.

## Story

As a treasurer,
I want a document whose vendor the system does not recognise to wait for me rather than be guessed at,
so that a misread name never quietly becomes a new vendor and splits that vendor's history in two.

## Acceptance Criteria

Epic story 1.6's **AC1** and **AC4**. AC2 and AC5 are 1.6c; AC3 is 1.6d.

**AC1 — An unresolved vendor holds the document, and creates nothing**

**Given** an extracted invoice whose vendor name does not resolve to a known vendor
**When** extraction completes
**Then** a quarantine item exists for that document, carrying the name as extracted
**And** **no vendor row is created** — not from a near match, not from a first sighting, not ever
without a human

**AC2 — A recognised vendor holds nothing**

**Given** an extracted invoice whose vendor name resolves
**When** extraction completes
**Then** no quarantine item is created
**And** the document reaches `read` exactly as it does today

**AC3 — One held document does not delay any other**

**Given** several documents processed around the same time, one of which has an unresolved vendor
**When** each is extracted
**Then** only that one is held
**And** every other document reaches `read` and stays out of the queue

**AC4 — Holding is not a fifth extraction state**

**Given** a held document
**Then** its `extraction_state` is still `read` — extraction *succeeded*; it is vendor resolution
that is pending
**And** "waiting for a human" is derived from `read` **plus an open quarantine item**, the way 1.5d
derives "extracting" from `held` plus a live claim

**AC5 — Re-reading a document does not accumulate items**

**Given** a document already held for an unresolved vendor
**When** the same document is extracted again (AD-13 re-ingest, or a retry)
**Then** it is still held once, not twice

## Tasks / Subtasks

- [x] **The `quarantine_item` table** (AC: 1, 5)
  - [x] Migration `010_quarantine_item.sql`. `id uuid primary key default uuidv7()`, matching the others
  - [x] `document_id uuid not null references document (id) on delete cascade` — an item without its
        document is debris that still satisfies a foreign key, exactly as migration 006 argues
  - [x] `extracted_name text not null` — the name **as read**, not normalised. 1.6c shows the treasurer
        what the document actually said; the normalised form is a comparison key, not a display value
  - [x] Bound it the way `009_vendor.sql` does, and reuse that reasoning: `char_length(extracted_name)
        <= 200` for how much is stored, plus a trimmed `>= 1` for whether anything is there. **Do not**
        write `char_length(btrim(...)) between 1 and 200` — that shape lets `'x'` plus 300 trailing
        spaces through, which is the defect 1.6a fixed twice
  - [x] AC5 is a **unique constraint**, not application logic: one open item per
        `(document_id, normalised extracted_name)`. Re-extraction must not stack items
  - [x] `grant select on quarantine_item to watchdog_reader;` — explicit, because migration 003
        revoked the default. Say why in a comment: 1.6c reads the queue
  - [x] `comment on table` / `on column` in the house style

- [x] **A port for holding** (AC: 1, 5)
  - [x] `core/ports/quarantine.ts` — `hold(documentId, extractedName)` and enough to read back for
        tests. The queue-reading shape belongs to 1.6c; do not build its surface here
  - [x] `hold` is **idempotent** — AC5 lives in the database, and the port must not defeat it by
        turning a duplicate into an error the caller has to interpret
  - [x] Never returns or accepts a vendor id. This port is for names that have *no* vendor

- [x] **Wire resolution into extraction** (AC: 1, 2, 3, 4)
  - [x] In `core/ingestion/extract-document.ts`, after `extract` succeeds and **before** the outcome is
        returned, resolve each distinct non-null `vendorName` in the validated records
  - [x] Unresolved → `hold`. Resolved → nothing
  - [x] **A statement has no vendor** (`vendorName` is null, and `006_extraction.sql` allows it).
        A null is not an unresolved vendor and must not be held — that would quarantine every bank
        statement the pilot ingests
  - [x] **Order matters.** `replace` moves the state to `read` in one transaction; the hold is a
        separate write. Decide and test what happens if the hold fails *after* records are stored — a
        document silently not held is worse than one held twice, because AC5 makes twice impossible
  - [x] The extractor is still not called for tabular types, and `resolve` must not change that

- [x] **The adapter, and the batch guarantee** (AC: 1, 2, 3, 5)
  - [x] `adapters/db/quarantine-postgres.ts`, following `vendor-directory-postgres.ts`
  - [x] Database tests: an item is created for an unknown name, none for a known one, and a second
        extraction of the same document does not add a second item
  - [x] **AC3 needs a test that would fail if documents were processed as a set** — two documents, one
        unresolved, and the other must reach `read`. Extraction is per-document today, so the risk is
        not that it breaks now but that it is never asserted and a later change makes it a set

## Dev Notes

### The decision that shapes this story

**Quarantine is not a fifth extraction state.** 1.5d fixed four durable states and spent a review round
defending them; `extracting` was deliberately made a *rendered* state — `held` plus a live claim —
rather than a stored one, because a crash mid-extraction would strand documents in a state nothing
clears.

Quarantine is a different axis entirely. Extraction **succeeded**: the provider answered, the records
validated, they are stored, and `extraction_state` is `read`. What is pending is vendor resolution.
Folding that into the extraction vocabulary would say the document was not read, which is false, and
would reopen a decision that was already litigated.

So: **`read` plus an open quarantine item.** UX-DR12's "quarantine-waiting" upload state is derived
from that pair, exactly as "extracting" is derived from `held` plus a claim. Same pattern, same reason.

The architecture's ER model already carries `QUARANTINE_ITEM` as its own entity, so this is the shape
that was planned rather than one invented here.

### What 1.6a hands over

| Thing | Where | Use |
| --- | --- | --- |
| `resolve(extractedName)` | `core/ports/vendor-directory.ts` | Returns `resolved` with an id, or `unresolved`. **Never creates.** |
| `AUTO_RESOLVE_RULE` | `core/vendor/name.ts` | `normalised-exact`. Do not widen it here |
| `vendor_normalised_name()` | `migrations/009_vendor.sql` | The identity rule. Use it for AC5's uniqueness so quarantine and vendor agree on what "the same name" means |
| `suggest` | the same port | **Not used in this story.** It ranks candidates for a human in 1.6c/d and decides nothing |

**`resolve` throws `22021` for text Postgres cannot store, and in this story that path is reachable.**

1.6a recorded the NUL case as unreachable *from stored data* and asked this story to re-confirm it for
its own caller. It does not hold. Checked before this story was written:

```
validate({ vendorName: 'Ever\u0000green', ... })  ->  ok: true
```

`core/extraction/validate.ts` trims and length-checks; a NUL is neither whitespace nor over-long, so it
passes. And this story's caller does not read `extraction.vendor_name` — it holds the **validated
record in memory**, before any column has refused anything. So a provider returning a name with a NUL
reaches `resolve` and raises, where 1.6a's assumption said it could not.

**This needs a decision and a test, not a note.** Two defensible answers:

- **GUARD at the boundary** — a name Postgres cannot store is not a vendor we know, so treat it as
  unresolved and hold it. But then `extracted_name` cannot be stored in `quarantine_item` either, so
  the guard has to reject rather than hold.
- **PROPAGATE** — let it raise and let `extract-document`'s existing catch report
  `provider-unavailable`. That is honest (the document genuinely cannot be processed) but blames
  infrastructure for a content problem, which is the mistake story 1.5b made and 1.5c split the
  refusal in two to fix.

The second reading suggests a third answer worth considering: it is an **`unreadable`** document —
the provider answered and its answer cannot be trusted. Decide in Step 5's failure-mode analysis,
write it down, and make the test force the path rather than assume it.

### Learnings that apply directly

1. **The bound shape.** 1.6a's display-name bound was wrong twice — first measuring the normalised
   value, then the trimmed one. Copy the *fixed* shape, not the one migration 006 uses.
2. **Guards that prove nothing.** "No quarantine item was created" is equally true of a resolver that
   was never called. Assert both directions: an item for the unknown name, none for the known one, in
   the same test run.
3. **A `check`/`unique` constraint beats a validator**, because it holds for anything that writes.
4. **`npm run build` is the only gate that type-checks**; `npx tsc --noEmit` has **8** pre-existing
   errors and that is the baseline. `migrations/` and `scripts/` are now inside `tsconfig.json`.
5. **Database tests run in parallel against one database.** Scope every assertion to the run's own
   rows — a shared-table count or ranking will flake, as 1.6a's did.
6. **`verify:database` does not run in CI** without the two protected variables. Say so plainly.

### Project Structure Notes

```
migrations/010_quarantine_item.sql          NEW
migrations/quarantine-item.test.ts          NEW   constraints, grants, idempotency
core/ports/quarantine.ts                    NEW   hold, and enough to read back
adapters/db/quarantine-postgres.ts          NEW
adapters/db/quarantine-postgres.test.ts     NEW
core/ingestion/extract-document.ts          UPDATE  resolve then hold, after a successful extract
core/ingestion/extract-document.test.ts     UPDATE  fakes gain a directory and a quarantine port
```

`extract-document.ts` is the only existing file this story changes. Its dependencies are injected
through `ExtractDocumentDependencies`, so the two new collaborators go there — no new way of reaching
the database, and `core/` keeps importing nothing outward (`core/ports/boundary.test.ts`).

### Testing standards

- Vitest. `npm test` for unit, `npm run test:db` for Postgres. **"Tested" = lint + build + test + test:db.**
- Test-first per `bmad-dev-tdd`: failure-mode analysis, then a failing test, then code.
- Database tests connect as the role under test — asserting a grant from `information_schema` proves
  the catalog says so; connecting and being refused proves it is true.

### References

- [Source: epics.md#Story 1.6] — AC1 and AC4, and the four-story split
- [Source: epics.md#UX-DR12] — "quarantine-waiting" is one of the five upload states
- [Source: ARCHITECTURE-SPINE.md#AD-8] — unknowns route to a human-confirm queue and never auto-create
- [Source: ARCHITECTURE-SPINE.md] — `QUARANTINE_ITEM` in the ER model; the quarantine gate in the
  ingestion diagram
- [Source: 1-6a-recognise-known-vendors.md] — the bound that was wrong twice, and the NUL propagation
  left for this story to re-confirm
- [Source: 1-5d-extract-on-upload-and-show-progress.md] — why `extracting` is rendered, not stored

## Dev Agent Record

### Agent Model Used

### Test Design

## Task 1 — the `quarantine_item` table

**The shape, decided here.** Columns: `id`, `document_id`, `extracted_name`, a **generated**
`normalised_name`, `created_at`. Nothing else.

`normalised_name` is `generated always as (vendor_normalised_name(extracted_name)) stored`, reusing
migration 009's function rather than a second rule. That matters beyond tidiness: AC5 asks that
re-extraction not stack items, and "the same name" has to mean the same thing to quarantine as it does
to the vendor table. Two definitions would let a document be held twice for one vendor under two
spellings, which is the *original* defect wearing a different hat.

**No `resolved_at`, deliberately.** Resolution is 1.6d. Adding a column now means guessing its
semantics — and the uniqueness rule depends on that guess, because "one open item per document and
name" is a different constraint from "one item ever". 1.6d decides, and can make the index partial
then. Building it now would be a guard with no test behind it.

**Which layer these assertions live at.** B1 and B2 below are stated against **direct inserts** in
`migrations/quarantine-item.test.ts` — that is where a uuid comes back and where a second spelling
raises 23505, because those are claims about the table. Through the port it looks different and
deliberately so: `hold` returns `Promise<void>` and uses `on conflict do nothing`, so a duplicate
**resolves quietly** and leaves one row. `adapters/db/quarantine-postgres.test.ts` asserts that
version. Both are true; they are answers to different questions, and reading one set as the other
would suggest the adapter throws on a duplicate when it must not.

**B1 — an item is stored against a document.**
*Correct if:* the insert returns a uuid and the row reads back with the name as extracted.

| # | Failure mode | Class |
| --- | --- | --- |
| 1 | `extracted_name` empty or whitespace-only — `char_length('   ')` is 3 | GUARD (check) |
| 2 | `extracted_name` over-long, padded to look short | GUARD (check, **009's two-part shape**, not 006's) |
| 3 | `document_id` referencing nothing | GUARD (foreign key) |
| 4 | the document is deleted, leaving the item | GUARD (`on delete cascade`) |
| 5 | the name is stored normalised, losing what the document said | GUARD — 1.6c must show the treasurer the actual text |

**B2 — holding twice holds once (AC5).**
*Correct if:* a second insert for the same document and the same name under a different spelling
raises **23505**.

| # | Failure mode | Class |
| --- | --- | --- |
| 1 | Second spelling of one name inserts a second row | GUARD — unique on `(document_id, normalised_name)` |
| 2 | Uniqueness is global rather than per document — two documents from the same unknown vendor, and only the first is held | GUARD — a test with **two** documents and one name, both of which must hold |
| 3 | Uniqueness keyed on the raw name, so quarantine and vendor disagree about sameness | GUARD — key on the generated column |

**B3 — the reader may read the queue and may not write it.**
*Correct if:* SELECT as `watchdog_reader` succeeds; INSERT, UPDATE and DELETE each raise **42501**.

| # | Failure mode | Class |
| --- | --- | --- |
| 1 | Grant forgotten — migration 003 revoked the default, so 1.6c would find the queue unreadable | GUARD |
| 2 | Over-granted, so the LLM query path could create or clear a hold | GUARD — AD-8 puts a human in this loop; a write grant here removes them |
| 3 | Asserted from `information_schema` rather than by connecting | GUARD — connect, as `roles.test.ts` does |

## Tasks 2 and 3 — the port, and wiring resolution into extraction

Task 2 declares an interface and has no behaviour of its own, so its tests arrive with the code that
uses it. Both tasks are complete; neither was skipped.

### Two decisions, and neither is obvious

**Decision 1 — hold *before* storing records, not after.**

`replace` moves the document to `read` in its own transaction. The hold is a separate write, and the
two cannot share a transaction without one port reaching into the other's. So one of them happens
first, and the failure between them decides which.

| Order | If the second write fails | Recoverable? |
| --- | --- | --- |
| `replace` then `hold` | State is `read`, so the document is **settled** and no poll retries it. Records are stored, nothing is held, and nobody finds out | **No.** Silent, and needs a human who does not know to look |
| `hold` then `replace` | State is still `held`, so the next poll re-extracts, holds again (a no-op, AC5), and replaces | **Yes.** Converges on its own |

The story asked which failure is worse and the answer is not symmetric: "read but not held" is
undetectable, "held but not read" heals itself. Hold first.

**Decision 2 — a name Postgres cannot store makes the document `unreadable`.**

1.6a left `resolve` propagating `22021` for such text, and this story established the path is
reachable: `validate()` accepts `'Ever\0green'`, and the caller here holds a validated record in
memory rather than a stored column.

The three candidates the story named, and why the third wins:

- **Propagate** — the generic catch reports `provider-unavailable`, which is *retryable*. The same
  bytes produce the same NUL every time, so it would retry until the cooldown gave up, blaming
  infrastructure for a content problem. That is precisely the mistake story 1.5b made and 1.5c split
  the port's refusal in two to fix.
- **Guard and hold it** — impossible on its own terms: `quarantine_item.extracted_name` cannot store
  the name either. The guard would have to reject rather than hold.
- **`unreadable`** — the provider answered and its answer cannot be trusted, which is exactly what
  that outcome means. Retrying cannot help, and it does not blame the document's infrastructure.

Worth being clear that the guard **makes an existing impossibility explicit** rather than inventing a
rule: `replace` would refuse the same record at `extraction.vendor_name`. Without the guard the
failure is an opaque database error on a different path; with it, the treasurer gets 1.5c's
unreadable-document copy.

**B1 — an unresolved name holds the document.**
*Correct if:* `hold` is called with the document and the name as extracted, and no vendor is created.

| # | Failure mode | Class |
| --- | --- | --- |
| 1 | `vendorName` is null — a statement has no vendor | GUARD. Holding these would quarantine every bank statement the pilot ingests |
| 2 | Several records carry the same unknown name | GUARD — hold once per distinct name, not once per record |
| 3 | A record resolves and another does not | GUARD — hold only the unresolved one |
| 4 | The name contains text Postgres cannot store | GUARD → `unreadable`, per decision 2 |
| 5 | `hold` throws | PROPAGATE — the outer catch already reports it, and decision 1 makes it recoverable |
| 6 | Resolution is asked for a tabular document | OUT-OF-SCOPE — those return before the provider is reached; a test already asserts the extractor is never called for them |

**B2 — a resolved name holds nothing.**
*Correct if:* `hold` is never called, and the document reaches `read` as before.

| # | Failure mode | Class |
| --- | --- | --- |
| 1 | Resolution is never called at all, so nothing is ever held | GUARD — assert the unknown case in the same suite, or "never held" passes vacuously |
| 2 | A near match resolves | GUARD — 1.6a pins this, and a test here proves the caller did not widen it |

### Debug Log References

**Tasks 2 to 4.** Task 2 declares an interface and has no behaviour of its own, so its tests arrived
with the code that uses it. All three are complete.

**Red.** 11 failing on the wiring, all assertion failures; the 57 pre-existing cases in that file kept
passing, so extending the fakes did not disturb them.

**`next build` caught what the suite could not.** Adding two dependencies to
`ExtractDocumentDependencies` left `app/api/.../extract/route.ts` constructing an incomplete object.
The full unit suite passed — Vitest does not type-check — and `next build` failed with the two missing
properties named. That is the third time on this project that build has caught what lint and tests
both passed.

**Sensitivity: every decision in the wiring, broken in turn.**

| Mutation | Result |
| --- | --- |
| Store records before holding | 3 fail |
| Hold every name, resolved or not | 3 fail |
| Treat a missing vendor as a name | 1 fails |
| Drop the unstorable-name guard | 3 fail |
| Distinct by raw spelling rather than normalised | 1 fails |

Restored: 70 passing. Each mutation is caught by the test written for that decision, which is what
separates a decision from an accident.

**Adversarial review** (Argus, staged diff, 10/10 files, confidence 1.0): no findings.

**One thing to carry into 1.6c.** The core tests prove batch independence with two documents sharing
one quarantine and one directory, which would fail if extraction ever became set-shaped. It passes
trivially today because extraction is per document — the point is that nothing else records the
guarantee, so a later change could remove it silently.


**Task 1.** Red against a database with no `quarantine_item` (42P01), green after `010` applied.
253 database cases, up from 230.

**One test was wrong and was corrected, not the code — and it was a repeat.** The check for "does not
use the bound shape 009 replaced" matched the migration's own *comment*, which names that shape in
prose so the next person does not rediscover it. This is the identical mistake 009's backslash check
made one story earlier, made again by the person who fixed it. Comments are stripped now, with a
positive control proving the predicate still fires — the same repair, applied a second time.

**Sensitivity, both directions.** The composite unique index is the subtle part, so it was broken each
way:

| Mutation | Result |
| --- | --- |
| Unique on the name alone, ignoring the document | "still holds two different documents for the same unknown vendor" fails |
| Unique on the raw name rather than the normalised one | "refuses a second spelling" fails |

Each mutation is caught by exactly the test written for it, which is what makes the composite index
worth having rather than a single column plus a comment.

**Adversarial review** (Argus, staged diff, 6/6 files, confidence 1.0): one finding, **not
reproduced**. It held that `__dirname` throws under ESM because `package.json` sets
`"type": "module"`. It does not: these are `.ts` files run through Vitest's transform, four other test
files in the repo already use `__dirname` — two of them predating this story — and all 253 cases pass.
The finding was reasoned from `package.json` without running anything, and changing working code to
satisfy it would have introduced the defect it imagined.


### Review Findings

**Whole-story adversarial review (Argus, `b571409..HEAD`, 13/13 files, confidence 0.95).** One
finding, **not reproduced**, and the verification is worth recording because the reasoning was sound.

**R1 (medium, not reproduced) — `isStorable` guards only NUL.** The finding held that a vendor name
over 200 characters, or one that is whitespace-only, would reach `hold`, violate
`quarantine_item_name_length` with 23514, be caught by the generic handler and be misreported as a
transient outage.

The chain is right; the premise is not. `checkText` in `core/extraction/validate.ts` returns a
**trimmed** string of 1 to 200 characters or `null`, and the extractor port's contract is that records
are validated — "validation is all-or-nothing across the set". So neither shape can reach this code
from a conforming extractor, and `core/extraction/validate.test.ts:135,141` already pins both bounds
(accepts at the maximum, refuses one past it).

NUL is the one case validation does **not** catch, which is exactly why the guard is narrow rather
than general. Widening it to re-check length would add a branch no test can force, against the Prime
Directive, and a test written to force it would have to construct a record the port says cannot exist.

**The assumption is now named rather than implicit:** this code trusts the extractor port's validation
contract for length and blankness, and guards only what that contract does not cover. A future adapter
that returns unvalidated records breaks that, and the existing tests on `validate` are what would keep
it honest.

### Completion Notes List

**All five ACs have a test that fails when the behaviour is removed.**

| AC | Proved by |
| --- | --- |
| AC1 unresolved holds, creates nothing | an item recorded with the name as extracted; no vendor row is ever written from this path |
| AC2 recognised holds nothing | asserted *beside* the unknown case, so "nothing held" cannot pass against code that never asks |
| AC3 one held document delays no other | two documents through one shared quarantine and directory |
| AC4 not a fifth extraction state | a held document still returns `read`, and the migration says so in its own comment |
| AC5 re-reading does not accumulate | `on conflict do nothing` on the composite index, proved by holding a second *spelling* |

**The two decisions this story had to make, and what they turned on.**

*Hold before storing.* The two writes cannot share a transaction, so one goes first, and the failure
between them is not symmetric: `replace` settles the document at `read`, so records-without-a-hold is
silent and permanent, while a hold-without-records leaves it `held` and the next poll heals it.

*A name Postgres cannot store makes the document `unreadable`.* 1.6a left this propagating and asked
this story to re-confirm the path was unreachable. It is not: `validate()` accepts a NUL and this
caller holds a validated record in memory. Reporting an outage would promise a retry that cannot help
— the same bytes yield the same NUL — and would blame infrastructure for a content problem, which is
the mistake 1.5b made and 1.5c split the port's refusal in two to fix.

**Out of scope, deliberately.** No queue surface (1.6c), no resolution (1.6d), no vendor creation
anywhere. `suggest` is never called from ingestion, and the fake throws if it is — ranking candidates
is for a human to choose between, and reaching it from here would be automatic near-matching by
another name.

**Gates on this head:** lint clean, `next build` compiled, **1050 unit passed / 251 skipped**,
**263 database passed**, `npx tsc --noEmit` at the pre-existing **8**, repo-wide control-byte sweep
clean.

**Not proven by CI.** `verify:database` does not run without the two protected variables, and the
generated column, composite unique index, grants and cascade are all in the part CI will not execute.


### File List

**Added**

- `migrations/010_quarantine_item.sql` — the table, the composite unique index, the grant
- `migrations/quarantine-item.test.ts` — constraints, grants proved by connecting, cascade, both index directions
- `core/ports/quarantine.ts` — `hold` and `heldNames`, narrow on purpose
- `adapters/db/quarantine-postgres.ts` — idempotency deferred to the database
- `adapters/db/quarantine-postgres.test.ts` — including a second spelling absorbed

**Modified**

- `core/ingestion/extract-document.ts` — resolve, hold, then store
- `core/ingestion/extract-document.test.ts` — fakes gained a directory and a quarantine
- `app/api/documents/[id]/extract/route.ts` — the two new collaborators


### Change Log

- 2026-08-06 — Story created. Second of the four stories epic story 1.6 was split into. Status ->
  ready-for-dev.
- 2026-08-06 — Tasks 1-4 implemented test-first. A `quarantine_item` table whose identity reuses
  migration 009's normalisation, so quarantine and the vendor table cannot disagree about whether
  two spellings are one name; a narrow port; and ingestion that resolves each distinct vendor name
  and holds the ones it does not know — before storing records, because that failure heals and the
  other does not. Status -> review.
