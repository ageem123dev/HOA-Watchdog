# Story 1.6b: Hold unknown vendors for a human

Status: ready-for-dev

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

- [ ] **The `quarantine_item` table** (AC: 1, 5)
  - [ ] Migration `010_quarantine_item.sql`. `id uuid primary key default uuidv7()`, matching the others
  - [ ] `document_id uuid not null references document (id) on delete cascade` — an item without its
        document is debris that still satisfies a foreign key, exactly as migration 006 argues
  - [ ] `extracted_name text not null` — the name **as read**, not normalised. 1.6c shows the treasurer
        what the document actually said; the normalised form is a comparison key, not a display value
  - [ ] Bound it the way `009_vendor.sql` does, and reuse that reasoning: `char_length(extracted_name)
        <= 200` for how much is stored, plus a trimmed `>= 1` for whether anything is there. **Do not**
        write `char_length(btrim(...)) between 1 and 200` — that shape lets `'x'` plus 300 trailing
        spaces through, which is the defect 1.6a fixed twice
  - [ ] AC5 is a **unique constraint**, not application logic: one open item per
        `(document_id, normalised extracted_name)`. Re-extraction must not stack items
  - [ ] `grant select on quarantine_item to watchdog_reader;` — explicit, because migration 003
        revoked the default. Say why in a comment: 1.6c reads the queue
  - [ ] `comment on table` / `on column` in the house style

- [ ] **A port for holding** (AC: 1, 5)
  - [ ] `core/ports/quarantine.ts` — `hold(documentId, extractedName)` and enough to read back for
        tests. The queue-reading shape belongs to 1.6c; do not build its surface here
  - [ ] `hold` is **idempotent** — AC5 lives in the database, and the port must not defeat it by
        turning a duplicate into an error the caller has to interpret
  - [ ] Never returns or accepts a vendor id. This port is for names that have *no* vendor

- [ ] **Wire resolution into extraction** (AC: 1, 2, 3, 4)
  - [ ] In `core/ingestion/extract-document.ts`, after `extract` succeeds and **before** the outcome is
        returned, resolve each distinct non-null `vendorName` in the validated records
  - [ ] Unresolved → `hold`. Resolved → nothing
  - [ ] **A statement has no vendor** (`vendorName` is null, and `006_extraction.sql` allows it).
        A null is not an unresolved vendor and must not be held — that would quarantine every bank
        statement the pilot ingests
  - [ ] **Order matters.** `replace` moves the state to `read` in one transaction; the hold is a
        separate write. Decide and test what happens if the hold fails *after* records are stored — a
        document silently not held is worse than one held twice, because AC5 makes twice impossible
  - [ ] The extractor is still not called for tabular types, and `resolve` must not change that

- [ ] **The adapter, and the batch guarantee** (AC: 1, 2, 3, 5)
  - [ ] `adapters/db/quarantine-postgres.ts`, following `vendor-directory-postgres.ts`
  - [ ] Database tests: an item is created for an unknown name, none for a known one, and a second
        extraction of the same document does not add a second item
  - [ ] **AC3 needs a test that would fail if documents were processed as a set** — two documents, one
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

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-08-06 — Story created. Second of the four stories epic story 1.6 was split into. Status ->
  ready-for-dev.
