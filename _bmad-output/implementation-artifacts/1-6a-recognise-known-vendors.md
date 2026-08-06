---
baseline_commit: c9167f8d32e468251802066f4944cbac1737dab1
merge_request: 15
---

# Story 1.6a: Recognise known vendors

Status: done

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

- [x] **The `vendor` table** (AC: 1, 3, 6)
  - [x] Migration `009_vendor.sql`. `id uuid primary key default uuidv7()`, matching `document` and `extraction`
  - [x] `display_name text not null` — what a human typed or confirmed, shown in the UI verbatim
  - [x] A **normalised key** column, `generated always as (...) stored`, with a **unique index**. That
        index is AC3: the database refuses the second spelling, application code cannot forget to check
  - [x] Length and emptiness constraints mirroring `extraction_vendor_name_length` — `btrim` with the
        explicit `E' \t\n'` character class, 1–200. A whitespace-only vendor name passes a bare
        `char_length` check; migration 006 learned this and the same trap is here
  - [x] `grant select on vendor to watchdog_reader;` — explicit, because 003 made future read access a
        per-table decision. Say **why** in a comment, as 006 does: FR-6 compares against vendor history
  - [x] `create extension if not exists pg_trgm;` plus a GIN index on the normalised key for AC4's ranking
  - [x] `comment on table` / `on column` in the house style — what it is and what it must never become

- [x] **Normalisation, as one definition** (AC: 1, 3)
  - [x] `core/vendor/name.ts`: `normaliseVendorName(raw: string): string` — case-fold, trim, collapse
        internal whitespace runs to a single space
  - [x] **The SQL generated column and this function must agree, and proving it is a task, not an
        assumption.** A database test runs a corpus through both and asserts identical output. This is
        the `AMOUNT_PATTERN` failure again in a new place: that value lived in three hand-written
        copies and one was silently wrong for weeks
  - [x] Corpus must include: tabs, newlines, non-breaking space (` `), a double space, leading and
        trailing space, mixed case, and **at least one character whose case folding differs between
        JavaScript and Postgres**. `'İ'.toLowerCase()` is two code points in JS; `lower()` in Postgres
        is locale-dependent. Decide explicitly — restricting the fold to ASCII is a legitimate answer —
        and **write the decision down**, because silent disagreement here creates exactly the duplicate
        identity this story exists to prevent

- [x] **The port and the resolver** (AC: 1, 2, 4, 5)
  - [x] `core/ports/vendor-directory.ts`, named for the `user-directory.ts` precedent
  - [x] `resolve(extractedName)` → a vendor **id** or an unresolved result. Never a name: the spine says
        "Vendors are referenced by id, never by extracted name"
  - [x] `suggest(extractedName, limit)` → ranked candidates with scores, for 1.6c/d
  - [x] **Two methods, not one with a flag.** A single call returning "resolved or maybe these" is how a
        suggestion becomes a resolution six months from now
  - [x] `AUTO_RESOLVE_RULE` — the named constant of AC5, exported and pinned by a test
  - [x] Nothing in this story calls `resolve` from ingestion. That is 1.6b

- [x] **The Postgres adapter** (AC: 1, 2, 3, 4, 6)
  - [x] `adapters/db/vendor-directory-postgres.ts`, following `document-repository-postgres.ts`
  - [x] `resolve` matches on the normalised key — an indexed equality, not a `similarity()` call
  - [x] `suggest` uses `similarity()` ordered descending, limited
  - [x] Database tests for both, plus AC6's grant assertions run **as `watchdog_reader`**, the way
        `roles.test.ts` and `document-extraction-state.test.ts` already do
  - [x] A test that inserting the same vendor twice under different spellings raises **23505**

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

claude-opus-5[1m]

### Test Design

## Task 1 — the `vendor` table

Measured against the live database before any code. **Three of these findings changed the design**, and
none of them would have been visible by reasoning about it.

**Finding 1 — `E'\\s+'` in a migration silently matches the letter `s`.**

| Regex form | Result on `Evergreen  Landscaping` |
| --- | --- |
| `'\s+'` | `Evergreen\|Landscaping` — correct |
| `E'\\s+'` | `Evergreen  Land\|caping` — **matched the letter s** |
| `'[[:space:]]+'` | `Evergreen\|Landscaping` — correct |

`standard_conforming_strings` is `on`. The migration uses an explicit bracket class, not `\s` in any
form: it cannot be misread by a later editor, and `Landscaping` → `Land caping` is the kind of defect
that produces plausible garbage rather than an error.

**Finding 2 — Postgres and JavaScript disagree about what whitespace is.**

| Character | PG `[[:space:]]` | JS `\s` |
| --- | --- | --- |
| space, tab, LF, CR, VT, FF, en space, ideographic space | yes | yes |
| **NBSP U+00A0** | **no** | **yes** |
| **narrow NBSP U+202F** | **no** | **yes** |
| zero-width U+200B | no | no |

**NBSP is what a PDF extractor emits.** With `lower()` + `[[:space:]]` in SQL and `.toLowerCase()` +
`\s` in TS, `Evergreen<NBSP>Landscaping` normalises one way in the application and another in the
database: the application believes it matched an existing vendor, the unique index does not fire, and
one vendor acquires two identities. That is the exact harm this story exists to prevent.

**Finding 3 — `lower()` and `toLowerCase()` disagree on two real characters.**
`İ` (U+0130) folds to `i` in Postgres and to `i` + combining dot in JavaScript. `ΣΣ` folds to `σσ` and
`σς`. Both are silent.

**Decision.** The fold is **ASCII-only** in both engines — `translate()` in SQL, a bounded `[A-Z]`
replacement in TS — and the whitespace set is an **explicit character class** naming NBSP and narrow
NBSP alongside the ordinary ones. Identical in both, verifiable by running both over a corpus.

The cost is real and accepted: `ÄKTA Bygg` and `äkta bygg` become two vendors rather than one. That is
a **conservative** failure — it produces an extra quarantine item for a human in 1.6b–d, not a silent
merge. Given this story's whole purpose, failing toward the human is the correct direction, and a
locale-dependent fold that silently merges two vendors is not.

### Behaviours and failure modes

**B1 — the table stores a vendor and gives it an id.**
*Correct if:* an insert returns a uuid and the row reads back. *Seam:* the database itself; this is a
`test:db` behaviour, run against real Postgres like every other migration test here.

| # | Failure mode | Class |
| --- | --- | --- |
| 1 | `display_name` empty, or whitespace-only — `char_length('   ')` is 3, so a bare length check admits it | GUARD (check constraint) |
| 2 | `display_name` past 200 — an OCR page or an injection payload arriving in a name field | GUARD (check constraint) |
| 3 | `display_name` null | GUARD (`not null`) |
| 4 | id collides | OUT-OF-SCOPE — `uuidv7()`, as `document` and `extraction` already rely on |

**B2 — the normalised key is generated, and unique.**
*Correct if:* inserting two spellings of one name raises **23505**, and the stored key equals the
normalisation of the display name.

| # | Failure mode | Class |
| --- | --- | --- |
| 1 | Caller supplies the key directly and it disagrees with the name | GUARD — `generated always … stored`, which Postgres refuses to let a caller write |
| 2 | Normalisation differs between SQL and TS (findings 2 and 3) | GUARD — corpus parity test over both |
| 3 | Two spellings both insert | GUARD — unique index, asserted by 23505 |
| 4 | Normalisation collapses two genuinely different vendors | GUARD — a test that `Evergreen Landscaping` and `Evergreen Landscape` remain distinct |

**B3 — `watchdog_reader` may read a vendor and may not write one.**
*Correct if:* a SELECT as that role succeeds and an INSERT fails with **42501**.

| # | Failure mode | Class |
| --- | --- | --- |
| 1 | Grant forgotten — migration 003 revoked default SELECT, so a new table is unreadable until granted | GUARD — connect as the role and select |
| 2 | Over-granted to writable, breaking AD-4 | GUARD — connect as the role and be refused |
| 3 | Asserted from `information_schema` rather than by connecting | GUARD — the catalog says what was *intended*; connecting proves what is *true*. `roles.test.ts` connects |

**B4 — `pg_trgm` is available for 1.6c/d's ranking.**
*Correct if:* `similarity()` is callable and the index exists.

| # | Failure mode | Class |
| --- | --- | --- |
| 1 | Extension missing on a deploy target | GUARD — `create extension if not exists`, plus a comment recording that this needs a privileged runner |
| 2 | Migration runner lacks privilege | OUT-OF-SCOPE here, **verified** — the runner is `postgres` (superuser); `watchdog_writer` is refused with 42501 and does not need it |
| 3 | Ranking accidentally wired into resolution | GUARD — AC5's test, in task 3 |

### Debug Log References

**Tasks 1 and 2 were run as one red-green cycle.** They are separable on paper and not in practice:
the assertion that matters is that the database and the application normalise a name *identically*,
and that cannot be written against either half alone. Both tasks are complete; neither was skipped.

**Red.** `core/vendor/name.ts` was bootstrapped as an identity function returning its input, so the
19 failures were genuine assertion failures rather than a missing-import error. `migrations/vendor.test.ts`
was red against a database with no `vendor` table.

**Green.** 22 unit cases and 40 database cases. Suite moved 1021 -> 1047 unit and 161 -> 201 database.

**One test was wrong and was corrected, not the code.** `does not reach for a backslash escape in its
whitespace class` failed against the migration's own *comment*, which names the hazard in prose so the
next person does not rediscover it. The check now strips comment lines, and a second test proves the
predicate still fires on the shape it hunts -- otherwise stripping could hide the very thing it looks
for.

**Sensitivity check, both directions.** The parity corpus is the story's load-bearing assertion, so it
was broken deliberately on each side:

| Mutation | Result |
| --- | --- |
| NBSP removed from the application's separator set | 5 unit and 4 database cases fail |
| NBSP removed from the database function | 3 database cases fail |

**Adversarial review** (Argus, staged diff, 9/9 files, confidence 1.0, audit chain OK): no findings.

**A defect found in the checking tool by using it.** The test-value pass reported "No test files
changed" for this task, because `git diff` cannot see untracked files and every test file in a new
story's first task is untracked. A checklist that silently omits the only tests in the diff is exactly
the failure the tool exists to prevent. `tests_touched.py` now lists untracked test files as wholly
new.


### Review Findings

**Whole-story adversarial review (Argus, `c9167f8..HEAD`, 12/12 files, confidence 0.95).** This is the
pass that per-task reviews structurally cannot be, and it found two things neither of them could —
both about the shape of the change rather than any one file.

**R1 (medium, confirmed by measurement) — an index nothing could use.** The migration created a GIN
trigram index; the adapter filters with an explicit `similarity(...) >= floor`. Those cannot meet: a
GIN trigram index is only reachable through the `%` operator. Checked with `enable_seqscan = off`, the
explicit predicate still plans a sequential scan while `%` uses the index.

So the story was shipping an unused database object **and a test asserting it existed** — a guard that
proves nothing, which is this project's signature defect and one I wrote while looking for it.

Resolved by removing the index rather than by switching to `%`. `%` takes its cutoff from
`pg_trgm.similarity_threshold`, a session setting a pooler can change, and trading a deterministic
filter for a hidden GUC dependency is the wrong way round at this scale — an association has tens of
vendors. The migration records the upgrade path for when that stops being true. The test now asserts
the unique index, which is the one that actually carries a rule.

**R2 (low, confirmed) — the migration tests were never type-checked.** `tsconfig.json` included
`app/`, `core/` and `adapters/` but not `migrations/`, so `migrations/vendor.test.ts` sat outside
`tsc --noEmit` entirely. Adding `migrations/**/*.ts` and `scripts/**/*.ts` costs **zero** new errors —
the count stays at the pre-existing 8 — so this was pure uncovered surface.

**Merge-request review, round 1 (CodeRabbit) — 4 findings, 2 Major.**

**One was already stale.** It asked for an index-supported trigram predicate; the index had been
removed four minutes earlier by the integration pass, for the reason the finding itself gives. It
also names why the alternative was rejected — *"ensure `pg_trgm.similarity_threshold` cannot exceed
`$2`"* — which cannot be ensured from inside the query.

**One was a genuine Major, and mine.** The display-name bound measured the *normalised* name, and
normalisation collapses internal separator runs, so `'x'` + 300 spaces + `'y'` counted as three
characters and a **302-character** name was stored. Reproduced against the database before the fix.

**The fix then had the same hole one position over.** Measuring the *trimmed* name closed the middle
and left both ends open: `'x'` + 300 trailing spaces counted as one and **301** characters were
stored. Found by the gate on the fix, not by the suite.

The constraint now measures two things because they answer two questions — `char_length(display_name)
<= 200` for how much is stored, `char_length(btrim(...)) >= 1` for whether anything is there. Both
halves are load-bearing: removing either fails four tests, and removing the substance half lets an
empty-named vendor exist, at which point `resolve('')` resolves to it.

The two Minor findings were both real: the index test asserted uniqueness but not *which column*, so
it would have passed with the index rebuilt on `display_name`; and a comment claimed a `gin_trgm_ops`
index is reachable only through `%`, which is too broad.

**Round 2 — targeted, and clean.** Rather than ask for a general re-read, the request named the two
things most likely to be wrong: whether a *third* input shape defeats the two-part bound, and whether
the two normalisation implementations can disagree on any input the corpus misses. Neither was found.
The upper bound applies before trimming or normalising, so nothing over 200 characters can pass; and
both implementations use the same eight separators, the same trimming, the same collapse and the same
ASCII-only fold.

**Stated rather than glossed:** that review's own caveat is *"Database verification was not run in
this review environment. Static inspection found no new issue."* This story is almost entirely
database behaviour, so a static-only pass is worth less here than it would be elsewhere. What it does
not cover is covered by 230 database tests run locally against real Postgres, twice.

**One edge it surfaced without raising.** JavaScript can hold a NUL, which Postgres `text` cannot
store, so `resolve` raises `22021` for such a name rather than returning `unresolved`. Confirmed by
probe. Left as PROPAGATE and documented on the port rather than guarded: an extracted name reaches
this port from `extraction.vendor_name`, a column that cannot hold those bytes either, so it is
unreachable from stored data. Recorded for 1.6b to re-confirm when it wires the first caller.

### Completion Notes List

**All four tasks complete; every AC has a test that fails when the behaviour is removed.**

| AC | Proved by |
| --- | --- |
| AC1 recognised through variation | `resolve` finds one vendor through case, padding, doubled space, tab, NBSP and narrow NBSP |
| AC2 nothing else resolves, nothing is created | unknown, prefix-of-known and near-miss names all return `unresolved`; row count unchanged either side |
| AC3 two spellings cannot both exist | second spelling raises **23505** from a unique index on a generated column |
| AC4 suggestions rank and never resolve | ranked most-similar-first with scores, and a paired test suggests a name it then refuses to resolve |
| AC5 the rule is named and pinned | `AUTO_RESOLVE_RULE` is `normalised-exact`, pinned; `resolve` uses indexed equality and a mutation to `similarity()` fails 3 tests |
| AC6 the role split holds | `watchdog_reader` selects; insert, update and delete each refused with **42501**, asserted by connecting as that role |

**Three defects were found in my own work by the gate, not by the suite going red.**

*A flaky test, caught by running the suite three times rather than once.* `suggest` ranks the whole
table by design, vitest runs files in parallel against one database, and another file's rows were
drifting into the assertions. It failed once and passed twice on identical code. Every ranking and
counting assertion is now scoped to the run's own prefix -- and once scoped, two tests failed
*consistently*, which showed the earlier passes had been resting on another file's leftovers rather
than on this story's seed data. The flake was hiding a genuinely weak test.

*Seven type errors, caught by the `tsc` baseline.* The `mine()` helper was typed
`{ displayName: string }[]`, which erased `id` and `score` from everything it returned. Lint passed,
the suite passed, `next build` compiled. Only `npx tsc --noEmit` saw it, moving 8 -> 15, which is
exactly why that number is recorded as a baseline rather than ignored because it is not a gate.

*A no-op conversion that hid a wrong type,* raised by the adversarial review and then measured:
`similarity()` returns float4, oid 700, which pg deserialises to a JS number. The column was typed
`string` with a `Number()` call downstream that read like a conversion and did nothing.

**Out of scope, deliberately.** Nothing calls `resolve` from ingestion -- that is 1.6b, and this
story changes no pipeline behaviour. No quarantine table, no surface, no vendor creation path: AD-8
says unknown vendors reach a human, and there is no human-facing anything until 1.6c.

**A sibling worth naming.** `SUGGESTION_FLOOR` is a constant in the adapter rather than
`pg_trgm.similarity_threshold`, which the `%` operator reads from the session. A pooled connection or
another caller can change a session GUC, and behaviour that moves for reasons invisible in the file
is the same shape of problem as the normalisation drift this story exists to prevent.

### File List

**Added**

- `migrations/009_vendor.sql` -- the table, the normalisation function, the unique index, the grant
- `migrations/vendor.test.ts` -- 40 cases: constraints, grants proved by connecting, and the parity corpus
- `core/vendor/name.ts` -- the application's half of the normalisation, and `AUTO_RESOLVE_RULE`
- `core/vendor/name.test.ts` -- 22 cases pinning the fold and the separator set
- `core/ports/vendor-directory.ts` -- `resolve` and `suggest`, kept apart on purpose
- `adapters/db/vendor-directory-postgres.ts` -- both queries through `vendor_normalised_name()`
- `adapters/db/vendor-directory-postgres.test.ts` -- 25 cases against real Postgres

**Modified**

- `_bmad/scripts/tests_touched.py` -- it could not see untracked test files, so it reported "no test
  files changed" for a task whose test files were all new

**Gates on this head:** lint clean, `next build` compiled, **1047 unit passed / 219 skipped**,
**226 database passed**, `npx tsc --noEmit` at the pre-existing **8**, repo-wide control-byte sweep
clean, database suite run **three times** for stability after the flake.

**Not proven by CI.** `verify:database` still does not run without the two protected variables, and
this story is almost entirely database behaviour: the generated column, the unique index, the grants
and the similarity ranking are all in the part CI will not execute.


### File List

### Change Log

- 2026-08-05 — Story created. Split from epic story 1.6 as the first of four. Status -> ready-for-dev.
- 2026-08-05 — Tasks 1-4 implemented test-first. A `vendor` table whose identity is a generated,
  normalised column with a unique index; one normalisation shared by the database and the
  application, with a corpus test proving they agree; and a directory port whose `resolve` decides by
  indexed equality while `suggest` only ranks. Three facts measured against the live database changed
  the design before any code was written: `E'\s+'` matches the letter `s` in a migration, Postgres
  does not count NBSP as whitespace where JavaScript does, and `lower()` disagrees with
  `toLowerCase()` on two real characters. Status -> review.
- 2026-08-06 — Review round 1 fixed: the display-name bound measured the wrong string, twice. It
  now bounds the raw length and separately requires substance. Round 2 attacked both the bound and
  the normalisation parity directly and found nothing further. Status -> done.

- 2026-08-05 — Story created. Split from epic story 1.6 as the first of four. Status -> ready-for-dev.
