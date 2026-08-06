---
baseline_commit: ec12892a00da336c04c83f77163151bf65bc726b
---

# Story 1.6c: See what is waiting

Status: ready-for-dev

> **Third of four stories from epic story 1.6.**
> **1.6a** built the mechanism: a `vendor` table, one normalisation rule, and a directory whose
> `resolve` decides by normalised-exact equality while `suggest` only ranks.
> **1.6b** wired it into both ingestion paths: an unresolved vendor holds the document in
> `quarantine_item` and creates no vendor record.
> **This story** is the first time a human can see any of it. The queue, read-only.
> **1.6d** adds acting on it — confirm as new, or match to existing.

## Story

As a treasurer,
I want to see which documents are waiting on me to identify a vendor,
So that a held document is a question I can answer rather than an upload that quietly went nowhere.

## Acceptance Criteria

**AC1 — the held item is legible** *(epic story 1.6 AC2)*

**Given** a document in quarantine
**When** the treasurer views the queue
**Then** the extracted vendor name is shown **as the document said it**, alongside the source
document it came from

**AC2 — the empty state states the fact, not the absence** *(epic story 1.6 AC5)*

**Given** an empty quarantine queue
**When** it is viewed
**Then** it states plainly that all vendors on uploaded invoices resolved to known records

**AC3 — read-only, and structurally so**

**Given** the queue surface
**When** it is rendered
**Then** it offers no control that resolves, creates, dismisses or clears anything, **and** the port
it reads through exposes no method that could

**AC4 — closed by default**

**Given** an unauthenticated visitor
**When** they request the queue
**Then** they are redirected to sign-in by the page itself, not only by the proxy — the second lock
`app/dashboard/page.tsx` and `app/upload/page.tsx` both carry

**AC5 — one document, several names**

**Given** a document held for two unknown vendor names
**When** the queue is viewed
**Then** both names appear, each attributed to that same document

**AC6 — ordering is stated, not incidental**

**Given** several held items
**When** the queue is viewed
**Then** they appear in a defined order the query fixes, oldest first, rather than whatever the
database happens to return

## Tasks / Subtasks

- [x] **Task 1 — The read port and its view shape** (AC1, AC3, AC5)
  - [x] Add `core/ports/quarantine-queue.ts` — a **separate port** from `Quarantine`. The existing
        one documents in its own header that it deliberately cannot read the queue; extending it
        would undo that on purpose.
  - [x] One method: `held(): Promise<readonly HeldItem[]>`. No `resolve`, no `dismiss`, no `clear`.
        AC3's second clause is about this file.
  - [x] `HeldItem` carries the extracted name as stored, the document id, and the document filename.
        Not the normalised name — it is a comparison key and no use to a human (migration 010 says
        so in its column comment).
- [x] **Task 2 — The Postgres adapter, on the reader connection** (AC1, AC5, AC6)
  - [x] `adapters/db/quarantine-queue-postgres.ts`, joining `quarantine_item` to `document` for the
        filename.
  - [x] `order by quarantine_item.created_at asc, quarantine_item.id asc` — the id breaks ties, so
        two items created in the same transaction do not swap between renders.
  - [x] Read through **`WATCHDOG_READER_DATABASE_URL`**, adding `readReaderDatabaseUrl()` beside the
        existing `readWriterDatabaseUrl()` in `adapters/auth/env.ts`. See *The reader decision* below
        before implementing — this is the story's one real design choice.
  - [x] Database test: seed a held item, read it back, assert the filename joins correctly. Follow
        the `const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL` pattern the migration tests
        already use.
  - [x] **Do not re-prove the role.** `migrations/roles.test.ts` already asserts the reader cannot
        INSERT, UPDATE, DELETE, TRUNCATE or CREATE, and that it holds no table-level write privilege
        on *any* table; `migrations/quarantine-item.test.ts` already asserts the grant text and the
        absence of a write grant. Both cover this table. The assertion that does **not** exist is
        that the new adapter connects as the reader at all — write that one: query `current_user`
        through the adapter's own pool and assert it is `watchdog_reader`. Without it, the adapter
        could quietly use the writer URL and every other test would still pass.
- [x] **Task 3 — The view model, in `core/`** (AC1, AC2, AC5, AC6)
  - [x] `core/quarantine/queue-view.ts` — a pure function from `readonly HeldItem[]` to the shape the
        page renders. Node-tested, no DOM.
  - [x] It decides the empty case, groups nothing, and sorts nothing (Task 2's query owns order —
        re-sorting here would make two definitions of "first").
- [x] **Task 4 — Test harness for rendering** (AC1, AC2)
  - [x] Add `jsdom` and `@testing-library/react` (v16+, required for React 19) as dev dependencies.
  - [x] **Widen `vitest.config.ts` `include` to cover `.test.tsx`** — it is currently `.test.ts` only.
        Without this a component test file is silently never collected: it passes by not running,
        which is this project's recurring defect wearing a new hat.
  - [x] Keep `environment: 'node'` as the default; opt in per file with a
        `// @vitest-environment jsdom` docblock, so the ~1083 node tests are unaffected.
  - [x] No `@vitejs/plugin-react` — `tsconfig.json` sets `"jsx": "react-jsx"`, so esbuild transforms
        JSX already. Verify rather than assume: a trivial rendering test must fail for the right
        reason before Task 5 starts.
- [ ] **Task 5 — The surface** (AC1, AC2, AC3, AC4)
  - [ ] `app/quarantine/page.tsx`, server component, with the sign-in redirect both siblings carry.
  - [ ] The list, and the empty state as its own rendered branch — not a ternary returning `null`.
  - [ ] Rendering tests: a held item shows its name and its document; two names on one document both
        appear; the empty state renders its sentence.
  - [ ] **Tokens only.** `core/design/no-raw-values.test.ts` scans every `.ts`/`.tsx`/`.css` under
        `app/` and fails on a raw hex colour or font-family. Use the custom properties the sibling
        pages use.
- [ ] **Task 6 — Reaching it** (AC4)
  - [ ] A link from the dashboard. EXPERIENCE.md says the queue is entered from the dashboard **when
        non-empty**; decide and record whether the link hides when the queue is empty or always shows
        with a count. Recommendation: always show it. A link that disappears is a surface a treasurer
        cannot learn, and the empty state exists precisely to be readable.
  - [ ] Confirm `/quarantine` is protected by `PUBLIC_ROUTES` being an allow-list — it should need no
        entry anywhere. Assert that in a test rather than reasoning about it.

## Dev Notes

### The decision that shapes this story

**This story can only read.** Not "does not yet write" — cannot. AD-8's whole claim is that a vendor
identity is created by a human decision, and 1.6d is where that decision gets made. The way that
claim survives contact with a codebase is that the port this story adds has no method capable of it,
so a later caller cannot quietly reach for one.

That is why Task 1 adds a *second* port rather than a method on `Quarantine`. Read
`core/ports/quarantine.ts`'s header: it states that it deliberately cannot read the queue, and names
this story as the reason. Adding `held()` there would satisfy the same acceptance criteria while
deleting the argument.

### The reader decision

`migrations/010_quarantine_item.sql` ends with `grant select on quarantine_item to watchdog_reader`,
and its comment says why: *"story 1.6c renders this queue, and the read path is how it gets there."*

But **no adapter in this repo currently uses the reader connection.** All five build a pool from
`readWriterDatabaseUrl()`. So this story either honours that grant — becoming the first reader-backed
read path in the app — or renders through the writer like everything else and leaves the grant
unexercised.

**Honour the grant.** A surface that only reads should hold a connection that can only read, and
AD-4's realization note is explicit that the separation is proven by a test asserting the reader
cannot write, not by a comment. Task 2's second database test is that proof for this table.

Two consequences to carry rather than discover:

1. **`WATCHDOG_READER_DATABASE_URL` is already a CI variable** and `verify:database` gates on both it
   and the writer URL, so the new tests run under the same conditions as the existing ones.
2. **This makes a sixth pool** — five writers at `max: 5` plus one reader. The shared-pool refactor
   is a recorded follow-up and stays one; do not fold it into this story, and do not pretend the
   count did not go up either.

### What 1.6b hands over

- **`quarantine_item`**: `id`, `document_id` (cascade), `extracted_name`, generated `normalised_name`,
  `created_at`. Unique on `(document_id, normalised_name)`.
- **Held is not an extraction state.** Migration 010 is emphatic: extraction *succeeded*,
  `document.extraction_state` is `read`, and what is pending is vendor resolution. UX-DR12's
  "quarantine-waiting" is *derived* from `read` plus a row here. If this story finds itself adding a
  fifth extraction state, it has taken a wrong turn.
- **`document`** carries `filename`, which is what AC1 means by "the source document it came from".
  Not `storage_key` — AD-10 forbids a storage key reaching a caller, and a filename is what a person
  recognises anyway.
- **The name is shown unfolded.** `extracted_name`, never `normalised_name`.

### Learnings that apply directly

From 1.6b, and both were review findings rather than foresight:

- **"That input cannot reach here" is the moment to measure, not to conclude.** Twice a guard was
  dismissed as unreachable and twice it was reachable. If this story reasons that a filename or a
  name cannot be empty, absent, or absurdly long on the way to the DOM, it should write the test that
  forces it instead.
- **Test the integration, not just the unit.** 1.6b's worst defect was that the upload path bypassed
  quarantine entirely while every unit test passed. The equivalent here is a view model that is
  perfectly tested while the page renders something else. Task 5's rendering tests exist for that,
  which is why Task 3 alone does not satisfy AC1 or AC2.

From 1.6a, an exact trap not to repeat: a migration-text test that matched the migration's own
comment rather than its SQL. If any test here asserts on file text, strip comment lines first and
include a positive control.

### Project Structure Notes

- `core/` imports nothing outward — `core/ports/boundary.test.ts` enforces it. The view model in
  Task 3 takes plain data and returns plain data; it may not import from `adapters/` or `app/`.
- The page is a **server component** like both siblings. Rendering tests target the presentational
  pieces; if a component must be extracted to be testable, extract it — untestable design is a design
  problem, not a testing problem.
- Route: `app/quarantine/page.tsx`. `PUBLIC_ROUTES` is an allow-list, so a new route is closed by
  default; Task 6 asserts that rather than assuming it.

### Testing standards

- **"Tested" = `npm run lint` + `npm run build` + `npm test`**, plus `npm run test:db` for Task 2.
  Neither ESLint nor Vitest type-checks — `npm run build` is the only gate that does.
- Database tests scope their assertions to a per-run prefix. 1.6b's suite went flaky because parallel
  files shared the `vendor` table, and scoping then exposed two tests that had been resting on
  another file's leftovers.
- Every new test faces the sensitivity check: break the code it covers, confirm it fails, restore.
  A rendering test that passes against an empty component would be this project's eleventh guard that
  proves nothing.

### References

- [Source: epics.md#Story-1.6] — AC2 and AC5 are this story's contract; AC1, AC3 and AC4 of the epic
  belong to 1.6b and 1.6d and must not be re-satisfied here
- [Source: ARCHITECTURE-SPINE.md#AD-8] — unknowns route to a human-confirm queue and never auto-create
- [Source: ARCHITECTURE-SPINE.md#AD-4] — `watchdog_reader` is SELECT-only; separation proven by test
- [Source: ARCHITECTURE-SPINE.md#AD-10] — no caller may receive a storage key
- [Source: EXPERIENCE.md] — "Quarantine queue | Unknown-vendor human confirmation | Dashboard, when
  non-empty"; and *Sarah confirms an unknown vendor*, whose steps 1 and 2 are exactly AC1
- [Source: migrations/010_quarantine_item.sql] — the grant, and why a hold must not be clearable
- [Source: core/ports/quarantine.ts] — states that reading the queue is this story's job, not its own
- [Source: migrations/roles.test.ts] — the reader's inability to write is already proven there; this
  story adds no second proof of it
- [Source: app/dashboard/page.tsx, app/upload/page.tsx] — the sign-in second lock, the inline
  `styles` object, and the token custom properties to copy rather than invent

### Verified while writing this story

Stated so the dev does not re-derive them, and so a wrong one is falsifiable:

- **React 19.2.8 / Next 16.2.12** — hence `@testing-library/react` v16+, which is the first line to
  support React 19.
- **`vitest.config.ts` is `include: ['**/*.test.ts']`** with `environment: 'node'`. Task 4's widening
  is required, not cosmetic.
- **`tsconfig.json` has `"jsx": "react-jsx"`** — esbuild transforms JSX, so no React plugin.
- **`PUBLIC_ROUTES` is `[SIGN_IN_ROUTE]`** in `core/auth/route-policy.ts`, an allow-list, so
  `/quarantine` is closed without an entry.
- **No adapter reads `WATCHDOG_READER_DATABASE_URL` today**; five migration *tests* do.
- **`document` has `filename`**; `storage_key` exists on the same table and must not leave it.

## Dev Agent Record

### Agent Model Used

### Test Design

## Task 1 - the read port and its view shape

Both behaviours here are **type declarations**, which have no runtime presence. Vitest does not
type-check, so nothing a normal test does can observe them. That is the whole design problem for
this task, and pretending otherwise would produce tests that assert nothing.

Two honest instruments exist, and each covers what the other cannot:

- `npm run build` type-checks. If the adapter or the view model consumes a field the type does not
  declare, the build fails. That is what proves `HeldItem`'s shape - and it is proven by Tasks 2 and
  3 consuming it, not by anything written here.
- A **source-text test** with comments stripped, which is the only way to pin AC3's second clause:
  that the port declares no method capable of writing. The project already uses this shape for
  migrations, and story 1.6a's exact failure was such a test matching the migration's own comment.
  Comment-stripping plus a positive control is the fix, applied here from the start rather than
  after review.

### Behaviour A - the `QuarantineQueue` port declares no mutator (AC3)

1. **Correct-run signal:** the file, comments removed, declares `held` and no method whose name
   implies writing.
2. **How to test it:** read the source, strip line and block comments, match method declarations.
   The seam is the filesystem; no injection needed.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| A1 | Story 1.6d adds `resolve()` here instead of its own write port, and AC3 quietly stops holding | GUARD |
| A2 | The test matches a forbidden word inside a comment or doc block and passes for the wrong reason - or fails for one | GUARD - strip comments, and a positive control proves the stripping did not eat everything |
| A3 | The file is renamed or emptied; the test reads nothing and vacuously passes | GUARD - assert `held` is present, so "no mutators" cannot be satisfied by an empty file |
| A4 | A mutator arrives via an index signature, a merged declaration, or a type alias the regex cannot see | OUT-OF-SCOPE - recorded. A source-text test cannot see through those; `core/ports/boundary.test.ts` and review are the backstop |

### Behaviour B - `HeldItem` carries what a human needs and nothing more (AC1)

1. **Correct-run signal:** the type declares the extracted name, the document id and the filename,
   and does not declare a normalised name or a storage key.
2. **How to test it:** the same source-text read. The *positive* half - that these fields exist and
   are the right types - is proven by `npm run build` once Tasks 2 and 3 consume them.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| B1 | `storageKey` is added because the adapter selected it - AD-10 forbids a storage key reaching any caller | GUARD |
| B2 | `normalisedName` is added because the row has one - migration 010 says it is a comparison key and no use to a human, and showing it would defeat AC1's "as the document said it" | GUARD |
| B3 | The name is typed as optional, so the surface renders `undefined` for a column that is `not null` | GUARD |


## Task 2 - the adapter, on the reader connection

Two behaviours: reading the reader URL out of the environment, and the query itself.

### Behaviour C - `readReaderDatabaseUrl()` (Task 2)

1. **Correct-run signal:** returns the trimmed URL when the variable is set; throws
   `MissingAuthConfigError` naming `WATCHDOG_READER_DATABASE_URL` when it is not.
2. **How to test it:** the existing writer helper takes its environment as a defaulted parameter
   precisely so a test can pass one in. Same seam, no `process.env` mutation, so the tests stay
   Repeatable and order-independent.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| C1 | The variable is absent -> must throw, naming the reader variable, not the writer's. A copied implementation that reports the wrong name sends someone to fix the wrong line | GUARD |
| C2 | The variable is present but blank or whitespace -> must be treated as absent, not returned as `''` and handed to `pg` | GUARD |
| C3 | Read at module scope rather than call time -> `next build` would then require real credentials, which is the exact defect `env.ts`'s header says it exists to avoid | GUARD - a test that imports the module with no environment set and does not throw |

### Behaviour D - `createQuarantineQueue().held()` (AC1, AC5, AC6)

1. **Correct-run signal:** rows inserted into `quarantine_item` come back as `HeldItem`s carrying
   the unfolded name and the joined filename, oldest first.
2. **How to test it:** against the real database, as every other adapter here is. Seed through the
   writer, read through the adapter. That is also the **reverse-it** test the workflow requires -
   write then read, and the read must agree with what was written.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| D1 | The adapter connects as `watchdog_writer`. Every other test still passes, because the writer can do everything the reader can - so nothing else can catch it | GUARD - assert `current_user` through the adapter's own pool |
| D2 | Ties on `created_at` order arbitrarily, so two renders of an unchanged queue disagree | GUARD - `id` as tiebreak, tested by inserting several rows in one statement |
| D3 | An `inner join` silently drops an item whose document is missing. The FK makes that unreachable today, and a `left join` would instead surface an item with no filename | OUT-OF-SCOPE - recorded. The FK plus `on delete cascade` is the guarantee; a test here would assert the FK, which `migrations/quarantine-item.test.ts` already does |
| D4 | Two names on one document collapse to one row | GUARD - AC5, tested directly |
| D5 | An empty queue returns `null`, or throws, rather than an empty list | GUARD - zero-one-many |
| D6 | The select reaches for `normalised_name` or `storage_key` because they are on the joined rows | GUARD - assert the returned object's exact key set, not just the fields we wanted |
| D7 | An idle client error with no listener takes the process down - the sibling adapters all carry a listener and say why | GUARD by construction, following the established pattern |

**Cross-check (required by `require_inverse_or_crosscheck`):** ordering is verified twice by
independent means - once by reading through the adapter, and once by a direct SQL query as the writer
asserting the same sequence. If the adapter's `order by` disagreed with the database's own idea of
the order, one of the two would have to move.

## Task 3 - the view model

### Behaviour E - `toQueueView(items)` (AC1, AC2, AC5, AC6)

1. **Correct-run signal:** given held items it returns them in the order received, marked non-empty;
   given none it returns an empty view the surface can render a sentence from.
2. **How to test it:** a pure function over plain data. No seams needed, which is the point of
   putting the decision here rather than inside a server component that cannot be rendered without
   a database.
3. **Failure modes:**

| # | Failure mode | Class |
| --- | --- | --- |
| E1 | It re-sorts, so the query's order and the view's order are two answers to "which is first" (AC6) | GUARD - a test passing deliberately unsorted input and asserting it comes back untouched |
| E2 | Emptiness is decided by the caller instead, so two surfaces could disagree about what "empty" means | GUARD - the flag is part of the returned value |
| E3 | It mutates or aliases the input array, so a caller's list changes underneath it | GUARD - assert the input is unchanged and the output is not the same reference |
| E4 | It de-duplicates by document, collapsing AC5's two-names-one-document case | GUARD |
| E5 | It invents a display fallback for a blank name, presenting something the document never said | GUARD - the database forbids blank names, and inventing "(unknown)" here would put words in a document's mouth. Pass it through |

**Cross-check:** the count on the view is verified against the input length independently of the
items array, so a view that dropped an item while reporting the old count cannot pass.

### Debug Log References

**Task 2 red.** Both suites first failed on a missing module, which is not a valid red. A naive stub
was written instead — writer URL, no `order by` — so every assertion had to fail on an assertion:
6 did, and `returns an empty list` correctly passed against it.

**Task 2, the test fixture was wrong twice.** `content_hash` carries a
`document_content_hash_is_sha256` check that a prefixed placeholder violates. Then the run-scoped
prefix turned out to be per *file*, so each test saw everything its predecessors had seeded — the
two-name case counted four and `returns an empty list` could never be true. Scoping moved to a
per-test token in `beforeEach`.

**Task 2 sensitivity, and what it exposed.** Removing the `id` tiebreak was caught in only **two runs
out of three**. Supplying explicit ids in reverse insertion order did not fix it: ties in
`order by created_at` may legitimately come back in any order, *including the right one*, so no
runtime test can settle this deterministically. A detector that is usually right is precisely the
class of guard this project keeps finding in its own tests, so the rule is now asserted where it is
deterministic — in the query text, comments stripped — and that detector fails 3 runs out of 3. The
database test proves the order is real; the text test proves it was asked for.


**Task 1 red.** `declares held` failed on the assertion — `expected [] to include 'held'` — not on a
missing import, because `portSource()` turns an unreadable file into empty text. The other five cases
passed against the absent file, which is failure mode A3 observed rather than argued: every negative
assertion in this suite is satisfied by nothing at all. `declares held` is written first for that
reason and is what makes the rest mean anything.

**Task 1 sensitivity.** Added `clear(documentId: string): Promise<void>` to the port; `declares no
method that could change what is waiting` failed with `expected [ 'clear' ] to deeply equal []`.
Restored, re-ran, green.


### Review Findings

### Completion Notes List

**Task 4.** `jsdom@29` and `@testing-library/react@16` added; `include` widened to
`**/*.test.{ts,tsx}`; `environment: 'node'` left as the default with per-file opt-in. No
`@vitejs/plugin-react` was needed, as predicted — verified by rendering JSX rather than assumed.

The glob widening is load-bearing and was proven so: reverted, `npm test -- rendering-harness`
reports **"No test files found"**. The tests do not fail, they cease to exist, which is
indistinguishable from a clean run.

**Review finding, confirmed and fixed test-first.** `tsconfig.json` included `core/**/*.ts` but not
`core/**/*.tsx`, so the new harness was invisible to the compiler — `tsc --listFiles` confirmed it.
`npm run build` is this project's only type-check, so that file had none. Fixed, and guarded by
`tsconfig-coverage.test.ts`, which sweeps every source file against the include patterns rather than
asserting the one pattern that was missing. It carries its own two controls: that the sweep found
files at all, and that the glob converter treats `**/` and `*` the way TypeScript does.

**Pre-existing, not introduced here:** `npm audit` reports 3 high-severity advisories in `sharp`,
which arrives via `next@16.2.12` — pinned at HEAD before this story. The fix moves Next outside its
stated range, which is a dependency decision rather than something to slip into a UI story.


**Task 3.** `toQueueView` decides emptiness once (E2) and does nothing else: no re-ordering (E1), no
grouping (E4), no invented placeholder for a name the database already forbids being blank (E5). It
copies the array so a caller cannot sort the adapter's result in place (E3). `count` is cross-checked
against `items.length` in the same test, so a view that dropped an item while reporting the old count
cannot pass.

Sensitivity: forcing `isEmpty: false` failed `reports an empty queue as empty`. Argus: no findings.


**Task 2.** `readReaderDatabaseUrl()` mirrors its writer sibling and reports its own variable name
(C1), trims (C2), and stays call-time so `next build` needs no credentials (C3). The adapter is the
first here to connect as `watchdog_reader`, which makes migration 010's grant load-bearing rather
than decorative.

Guarded: the adapter reaching for the writer URL (D1, by mocking the config module rather than
reaching into the adapter for its pool — a test that opens up its subject pins the internals in
place), tie ordering (D2, by two instruments neither of which suffices alone), two names on one
document (D4), the empty queue (D5), and the two columns that must not leave (D6, asserted as an
exact key set *and* as absent from the query text).

Out of scope and recorded: an item whose document is missing (D3). The foreign key with
`on delete cascade` makes it unreachable, and `migrations/quarantine-item.test.ts` already asserts
the constraint; a `left join` would answer the impossible case by inventing a null filename.

Sibling gap found and left alone: `readWriterDatabaseUrl` and `MissingAuthConfigError` have no tests
at all, and predate this story. Adding them here would have widened a task whose diff is already the
one under review. Follow-up.

Adversarial review (Argus, `gemini-3.1-pro-high`): no findings, confidence 1.0.


**Task 1.** The port declares `held()` and nothing else; `HeldItem` carries `documentId`, `filename`
and `extractedName`, all `readonly`, none optional.

Guarded: a mutator arriving on this port later (A1), the source test matching its own prose (A2, via
comment-stripping plus a control that proves the stripper neither under- nor over-reaches), an absent
or emptied file passing vacuously (A3), and the two fields that must never leave — `normalisedName`
and `storageKey` (B1, B2).

Out of scope and recorded: a mutator smuggled in through an index signature, a merged declaration, or
a type alias (A4). A source-text test cannot see through those, and saying so is better than a test
that implies it can. Review is the backstop.

`npm run build` is what proves the *positive* shape of `HeldItem`; Tasks 2 and 3 consume the fields,
so a wrong or missing one fails the build. This suite only proves the negatives, which no compiler
checks.

Sibling shape worth noting, not fixed here: `Quarantine` and `VendorDirectory` both carry the same
"a port should not be able to do more than its story needs" property, and neither has a test pinning
it. `VendorDirectory.suggest` is the live risk — its own doc comment warns that a caller treating the
first entry as an answer reintroduces automatic near-matching, and nothing enforces that. Follow-up,
not this story's scope.

Adversarial review (Argus, `gemini-3.1-pro-high`): no findings, confidence 1.0.


### File List

- `core/ports/quarantine-queue.ts` (new)
- `core/ports/quarantine-queue.test.ts` (new)
- `adapters/auth/env.ts` (modified — `readReaderDatabaseUrl`, `READER_DATABASE_URL_VAR`)
- `adapters/auth/env.test.ts` (new)
- `adapters/db/quarantine-queue-postgres.ts` (new)
- `adapters/db/quarantine-queue-postgres.test.ts` (new)
- `adapters/db/quarantine-queue-connection.test.ts` (new)
- `core/quarantine/queue-view.ts` (new)
- `core/quarantine/queue-view.test.ts` (new)
- `vitest.config.ts` (modified — include widened to `.test.{ts,tsx}`)
- `package.json` / `package-lock.json` (modified — `jsdom`, `@testing-library/react`)
- `core/design/rendering-harness.test.tsx` (new)
- `tsconfig.json` (modified — `core/**/*.tsx`)
- `tsconfig-coverage.test.ts` (new)


### Change Log

- 2026-08-06 — Story created. Scope is the read-only quarantine queue: epic ACs 2 and 5. Two
  decisions recorded ahead of implementation — a separate read-only port, and reading through
  `watchdog_reader`. Status -> ready-for-dev.
