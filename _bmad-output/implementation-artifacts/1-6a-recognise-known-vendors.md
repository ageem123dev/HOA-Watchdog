# Story 1.6a: Recognise known vendors

Status: ready-for-dev

> **First of four stories from epic story 1.6.**
> Epic 1.6 was split before any implementation (see `epics.md`, "Delivered as four stories").
> **This story builds the mechanism the other three stand on**: a `vendor` table and one rule for
> deciding whether an extracted name is a vendor we already know.
> **1.6b** puts unresolved vendors into quarantine. **1.6c** shows the queue. **1.6d** resolves from it.
>
> **This story changes no pipeline behaviour.** Nothing calls the resolver yet. That is deliberate: the
> matching rule is the part with a wrong answer that corrupts data silently, and it is worth getting
> right on its own before anything depends on it.

## Story

As a treasurer,
I want the system to recognise a vendor it has seen before even when the name is typed or read a
little differently,
so that "Evergreen Landscaping" and "evergreen  landscaping" are one vendor's history rather than two
half-histories that hide a duplicate invoice.

## Acceptance Criteria

Epic 1.6's five ACs are satisfied by 1.6b–d. This story's ACs cover the matching behaviour they all
depend on.

**AC1 — A known vendor is recognised through harmless variation**

**Given** a vendor exists in the known-vendor table
**When** resolution is asked about an extracted name differing only by letter case, leading or
trailing whitespace, or runs of internal whitespace
**Then** it resolves to that vendor's **id**
**And** the id, never the name, is what callers receive

**AC2 — Anything else does not resolve, and nothing is created**

**Given** an extracted name that is not a normalised-exact match for any known vendor
**When** resolution runs
**Then** it reports *unresolved*
**And** **no vendor row is created** — not on a near match, not on a first sighting, not ever from
this path

**AC3 — Two vendors cannot differ only by normalisation**

**Given** the vendor `Evergreen Landscaping` already exists
**When** `  evergreen   LANDSCAPING ` is inserted
**Then** the **database** refuses it
**And** the refusal is a constraint, not application logic

**AC4 — Suggestions rank by similarity and never resolve**

**Given** an extracted name that did not resolve
**When** suggestions are requested for it
**Then** known vendors come back ordered most-similar first, each with its score
**And** this path **cannot** return a resolution — ranking informs a human in 1.6c/d, and decides
nothing on its own

**AC5 — The auto-resolve rule is a named, pinned decision**

**Given** the rule that decides automatic resolution
**Then** it is a named exported constant with a test that pins its value
**And** a test proves similarity ranking is **not** wired into resolution: making two names highly
similar must not make them resolve

**AC6 — The new table obeys the role split**

**Given** migration 003 revoked default SELECT for `watchdog_reader`
**When** `vendor` is created
**Then** it carries an **explicit** `grant select` to `watchdog_reader` — FR-6's vendor averages
need vendor identity on the read path
**And** `watchdog_reader` cannot insert, update or delete a vendor (AD-4)

## Tasks / Subtasks

- [ ] **The `vendor` table** (AC: 1, 3, 6)
  - [ ] Migration `009_vendor.sql`. `id uuid primary key default uuidv7()`, matching `document` and `extraction`
  - [ ] `display_name text not null` — what a human typed or confirmed, shown in the UI verbatim
  - [ ] A **normalised key** column, `generated always as (...) stored`, with a **unique index**. That
        index is AC3: the database refuses the second spelling, application code cannot forget to check
  - [ ] Length and emptiness constraints mirroring `extraction_vendor_name_length` — `btrim` with the
        explicit `E' \t\n'` character class, 1–200. A whitespace-only vendor name passes a bare
        `char_length` check; migration 006 learned this and the same trap is here
  - [ ] `grant select on vendor to watchdog_reader;` — explicit, because 003 made future read access a
        per-table decision. Say **why** in a comment, as 006 does: FR-6 compares against vendor history
  - [ ] `create extension if not exists pg_trgm;` plus a GIN index on the normalised key for AC4's ranking
  - [ ] `comment on table` / `on column` in the house style — what it is and what it must never become

- [ ] **Normalisation, as one definition** (AC: 1, 3)
  - [ ] `core/vendor/name.ts`: `normaliseVendorName(raw: string): string` — case-fold, trim, collapse
        internal whitespace runs to a single space
  - [ ] **The SQL generated column and this function must agree, and proving it is a task, not an
        assumption.** A database test runs a corpus through both and asserts identical output. This is
        the `AMOUNT_PATTERN` failure again in a new place: that value lived in three hand-written
        copies and one was silently wrong for weeks
  - [ ] Corpus must include: tabs, newlines, non-breaking space (` `), a double space, leading and
        trailing space, mixed case, and **at least one character whose case folding differs between
        JavaScript and Postgres**. `'İ'.toLowerCase()` is two code points in JS; `lower()` in Postgres
        is locale-dependent. Decide explicitly — restricting the fold to ASCII is a legitimate answer —
        and **write the decision down**, because silent disagreement here creates exactly the duplicate
        identity this story exists to prevent

- [ ] **The port and the resolver** (AC: 1, 2, 4, 5)
  - [ ] `core/ports/vendor-directory.ts`, named for the `user-directory.ts` precedent
  - [ ] `resolve(extractedName)` → a vendor **id** or an unresolved result. Never a name: the spine says
        "Vendors are referenced by id, never by extracted name"
  - [ ] `suggest(extractedName, limit)` → ranked candidates with scores, for 1.6c/d
  - [ ] **Two methods, not one with a flag.** A single call returning "resolved or maybe these" is how a
        suggestion becomes a resolution six months from now
  - [ ] `AUTO_RESOLVE_RULE` — the named constant of AC5, exported and pinned by a test
  - [ ] Nothing in this story calls `resolve` from ingestion. That is 1.6b

- [ ] **The Postgres adapter** (AC: 1, 2, 3, 4, 6)
  - [ ] `adapters/db/vendor-directory-postgres.ts`, following `document-repository-postgres.ts`
  - [ ] `resolve` matches on the normalised key — an indexed equality, not a `similarity()` call
  - [ ] `suggest` uses `similarity()` ordered descending, limited
  - [ ] Database tests for both, plus AC6's grant assertions run **as `watchdog_reader`**, the way
        `roles.test.ts` and `document-extraction-state.test.ts` already do
  - [ ] A test that inserting the same vendor twice under different spellings raises **23505**

## Dev Notes

### The one decision this story exists to make

**Matching is fuzzy. Resolution is not.** Recorded in `epics.md` on 2026-08-05 and restated here
because it is the whole point:

- `similarity()` ranking drives **suggestions** — "did you mean" ordering for a human in 1.6c/d.
- **Automatic** resolution is **normalised-exact only**.

An automatic near-match that is wrong writes a false vendor identity into the comparison history
**silently**, and that is precisely the harm epic story 1.6 exists to prevent. A wrong auto-match
does not fail loudly; it produces a plausible vendor history that hides the duplicate invoice FR-6
is supposed to catch.

`AUTO_RESOLVE_RULE` is a named constant so raising it is a deliberate change with a test, not an
edit to a threshold buried in a query. **If the repository owner later wants auto-matching above a
similarity score, that is a one-line change plus a test — by design.**

### Measured, not assumed

Probed against the live database on 2026-08-05:

| Check | Result |
| --- | --- |
| Postgres | **18.4** |
| `pg_trgm` | available (1.6), **not yet installed** |
| Migration runner (`DATABASE_URL`) | `postgres`, **superuser** — `create extension` succeeds |
| `watchdog_writer` | **cannot** create extensions (42501) — correct, and it does not need to |
| `similarity('Evergreen Landscaping', 'Evergreen Landscape')` | **0.75** |
| `similarity('Evergreen Landscaping', 'Acme Plumbing')` | **0.059** |

**Read that 0.75 before choosing any threshold.** pg_trgm's default cutoff is `0.3`, which would rank
`Acme Plumbing` and `Evergreen Landscaping` as unrelated (good) but treats a great deal else as a
candidate. Suggestions are ordered lists for a human, so the threshold matters far less than it would
for auto-resolution — which is the argument for keeping auto-resolution off similarity entirely.

**Risk to state, not to discover:** `create extension` requires a privileged migration runner. It works
here because the runner is `postgres`. On a managed instance where it is not, the migration fails —
that is a deployment fact worth writing into the migration's comment rather than leaving to a failed
deploy.

### What exists already, and must be reused

| Thing | Where | Why it matters here |
| --- | --- | --- |
| `extraction.vendor_name` | `migrations/006_extraction.sql` | The column this story resolves **from**. Already bounded 1–200 with `btrim(E' \t\n')`. Its comment already says "Resolution against known vendors happens elsewhere (AD-8)" — this story is that elsewhere |
| `VENDOR_NAME_MAX_LENGTH = 200` | `core/extraction/record.ts` | **Reuse it.** A second 200 written by hand is a drift bug waiting |
| `checkText` trimming | `core/extraction/validate.ts` | The existing trim/length discipline to **match**, not to import — it is module-private and should stay that way. Copy the shape, not the symbol |
| Explicit grants | `migrations/003_reader_hardening.sql` | Default SELECT was revoked; a new table is unreadable until granted |
| Migration test shape | `migrations/document-extraction-state.test.ts` | Vocabulary parity by reading the `.sql`, defaults, grants, constraint behaviour |
| Adapter shape | `adapters/db/document-repository-postgres.ts` | Pool construction, SQLSTATE handling, role usage |

**Do not** add a second vendor-name length constant, a second normalisation, or a second way to open a
connection.

### Learnings from 1.5d that apply directly

1. **Guards that prove nothing** — eleven found on this project. A test asserting "resolution returned
   nothing" also passes when the table is empty, the query is wrong, or the connection is to the wrong
   database. Seed a vendor that *should not* match alongside one that *should*, and assert both
   directions. The `bmad-dev-tdd` Step 9 sensitivity check is the tool: break the code, confirm the
   test fails, restore.
2. **The test-value pass** (`_bmad/custom/review-gate.md` §2a) is now part of the gate, run per task and
   per fix push, with `python3 _bmad/scripts/tests_touched.py <range>` producing the checklist.
3. **A `check` constraint is worth more than a validator**, because it holds for anything that writes.
   AC3 is a unique index for exactly this reason.
4. **`npm run build` is the only gate that type-checks.** Lint and Vitest do not. `npx tsc --noEmit` has
   **8 pre-existing errors**; that is the baseline, and adding to it is a regression.
5. **`verify:database` does not run in CI** without the two protected variables. Database tests are the
   bulk of this story — 158 of 161 currently skip in CI. Say so plainly rather than implying coverage.

### Project Structure Notes

New files, all in existing directories:

```
migrations/009_vendor.sql                     NEW
migrations/vendor.test.ts                     NEW   constraints, grants, normalisation parity
core/vendor/name.ts                           NEW   normalisation + AUTO_RESOLVE_RULE
core/vendor/name.test.ts                      NEW
core/ports/vendor-directory.ts                NEW   resolve + suggest
adapters/db/vendor-directory-postgres.ts      NEW
adapters/db/vendor-directory-postgres.test.ts NEW
```

**Naming variance, decided:** the architecture's Consistency Conventions say "DB tables snake_case
plural", but every existing table is **singular** — `document`, `extraction`, `board_member`. Follow the
code: **`vendor`**. Consistency with six migrations beats consistency with one line of prose, and a
mixed convention is worse than either.

`core/vendor/` is new but follows `core/extraction/` and `core/ingestion/`. `core/` imports nothing
outward — `core/ports/boundary.test.ts` enforces it.

### Testing standards

- Vitest. `npm test` for unit, `npm run test:db` for anything touching Postgres.
- **"Tested" = `npm run lint` + `npm run build` + `npm test` + `npm run test:db`.**
- Test-first per `bmad-dev-tdd`: failure-mode analysis, then a failing test, then code.
- Database tests connect as the role under test, as `roles.test.ts` does — asserting a grant by reading
  `information_schema` proves the catalog says so; connecting and being refused proves it is true.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.6] — the epic ACs and the four-story split
- [Source: .../ARCHITECTURE-SPINE.md#AD-8] — vendor identities resolve against a known-vendor table;
  unknowns never auto-create
- [Source: .../ARCHITECTURE-SPINE.md#AD-4] — roles separate by pipeline stage
- [Source: .../ARCHITECTURE-SPINE.md#Consistency Conventions] — "Vendors are referenced by id, never by
  extracted name"
- [Source: docs/prd/prd.md#FR-6] — vendor averages and duplicate detection, the consumer of this identity
- [Source: migrations/006_extraction.sql] — `vendor_name` constraints and the "resolution happens
  elsewhere" comment
- [Source: migrations/003_reader_hardening.sql] — why a grant must be explicit
- [Source: _bmad/custom/review-gate.md] — the three checks every diff gets

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-08-05 — Story created. Split from epic story 1.6 as the first of four. Status -> ready-for-dev.
