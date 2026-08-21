---
Status: in-progress
baseline_commit: ad56237e79a4eefc45592e14c4dc0d711d797c06
merge_request:
---

# Story 5.1d: The sweep parses SQL

## Story

As **a board member**,
I want **the guard that proves a catalog query is association-scoped to read the SQL rather than resemble it**,
so that **a query that reads every association's records cannot pass the check that exists to stop it**.

Split from story 5.1c on 2026-08-21, which had itself absorbed this from 5.1b. It shares 5.1c's
theme — a property asserted by resemblance rather than established by construction — and shares
none of its files, which is why it is its own story.

## What is wrong

`catalog/registry.test.ts` decides whether an entry scopes its tables with a hand-written scanner
over the SQL text. Over MR !71 that scanner was defeated **eight times**, each by a different
Postgres lexical form, and two of the fixes introduced defects of their own.

**The sweep is not the proof, and it should not be read as one.**
`adapters/db/catalog-isolation.test.ts` gives two associations the same unit number and runs the
real query; none of the eight bypasses would have survived it. This story makes the early warning
trustworthy — it does not make it the thing that establishes isolation.

## Acceptance Criteria

1. **The sweep reads SQL rather than resembling it.** The hand-written scanner is replaced by a real
   parse — an existing SQL parser, not another hand-written one. Alias resolution is **per query
   scope**, which is the property the current scanner structurally cannot have.

2. **Every bypass found on MR !71 stays a regression case.** All eight, driven through the whole
   sweep and asserting *which* stage rejects them, as the current fixtures already do: a line
   comment, a nested block comment, a plain literal, an `E'…\'…'` escape string, a `$café$` tag, a
   schema-qualified name, a comma-separated list, and an alias shadowed inside a subquery. A parser
   that accepts any of them is not an improvement.

3. **What the parser cannot analyse is still refused, not guessed at.** The one rule that held
   across eight rounds. A construct outside what the parser can resolve turns the suite red rather
   than passing quietly.

## Tasks / Subtasks

- [x] **Task 1 — Choose and name the parser.** **`libpg-query` 17.7.4, as a `devDependency`.**
      Chosen and measured 2026-08-21; see *The parser* below for the probe results and the rejected
      alternatives. (AC1)
- [x] **Task 2 — Rewrite `sweepVerdict` around the parse.** Per-scope alias resolution replaces the
      flat namespace. Keep the shape that works: one function returning the reason or `null`, called
      by both the per-entry sweep and the fixtures, so the two cannot drift. (AC1)
- [x] **Task 3 — Carry the eight bypasses over.** Each asserting the stage that rejects it, and each
      proved by mutation rather than assumed. (AC2)
- [x] **Task 4 — Refuse what the parser cannot resolve, and delete the rules it makes dead.**
      `FORBIDDEN_LEXICAL` currently subsumes the `E'`/`U&'` and dollar-construct entries in
      `UNANALYSABLE` — anything containing `E'` contains `'` and is already refused. That redundancy
      was left in deliberately at the end of 5.1b rather than doing test-only surgery on a ready MR.
      (AC3)

## Dev Notes

### What eight rounds actually taught

Recorded because the next person will be tempted to patch rather than replace.

The scanner was defeated by: a line comment; a **nested** block comment (the regex fix reopened the
hole one level down); a plain string literal; an `E'…\'…'` escape string; a `$café$` dollar tag; a
schema-qualified name; a comma-separated `from` list; and an alias shadowed inside
`exists (select … from assessment as unit …)`, where the predicate belongs to the inner query and
the outer table is unconstrained.

Two further defects were in the *fixes*: one refusal was dead in the pipeline because it ran after
the literal it looked for had already been blanked, and the bypass fixtures passed for the wrong
reason twice — once because blanking a literal also ate the `from unit` after it, once because every
fixture stopped at the first stage and never reached the one under test.

**The pattern is that a text scan cannot decide a question about what SQL executes.** What ended
each round was not a better regex but the same inversion: *refuse what cannot be analysed*. Keep
that rule after the parser lands (AC9) — a parser has its own edges, and the failure mode to avoid
is the parser silently resolving something differently from Postgres.

**And keep the division of labour honest.** `adapters/db/catalog-isolation.test.ts` gives two
associations the same unit number and runs the real query; none of the eight bypasses would have
survived it. The sweep is an early warning that a *new* entry looks unscoped. It is not the proof,
and 5.1b's own comments now say so.

### The parser

**`libpg-query` 17.7.4 — MIT, one transitive dependency (`@pgsql/types`), added as a
`devDependency`.**

#### The supply-chain question, corrected

This task's original wording said the parser "parses SQL that decides which association's records
are returned, so its supply chain is part of the decision". That overstates the exposure and the
correction matters. **The sweep is test-only** — `sweepVerdict` has no production importer
(verified: the only file mentioning it is `catalog/registry.test.ts`). So the parser never runs in
the runtime that touches member data; it runs in the suite that checks the SQL which does. A
`devDependency`, not a dependency, and the risk is a compromised *build* rather than a compromised
*query path*. Still a real risk, and a smaller one than the story assumed.

`npm audit` reports no advisory against `libpg-query` or `@pgsql/types`. The tree's five existing
high advisories (`next`, `postcss`, `sharp`, `js-yaml`, `nanoid`) pre-date this change.

#### Why this one

**It is the actual PostgreSQL parser**, compiled to WASM — not a grammar that resembles Postgres.
That is the whole argument, because this story exists to remove a guard that resembled a parser.
Choosing a re-implementation would reintroduce the same failure one level up: a second grammar that
can disagree with the database, and nothing failing when it does.

`main` is `./wasm/index.cjs`, with no `os`/`cpu` restriction and no install script, so it needs no
native toolchain. That was the historic objection to `libpg-query` and it no longer applies.

#### Measured against the bypasses, not assumed

Every case below was run through `pg.parse` before the choice was made. `refs` is table references
tagged with the depth of the `SelectStmt` they belong to:

| Case | Result |
| --- | --- |
| a plain literal | parses; one ref, `unit` |
| a line comment | parses; comment gone from the tree entirely |
| a **nested** block comment | parses — the real lexer, so `/* a /* b */ c */` is not a puzzle |
| an `E'…\'…'` escape string | parses |
| a `$tag$…$tag$` dollar construct | parses |
| a CTE | `t` at scope 1, `unit` at scope 2 — distinguishable |
| a derived table | `unit` at scope 2 |
| a schema-qualified name | structured: `schema: "public"`, `table: "unit"` |
| a comma-separated list | two refs at scope 1 |
| **an alias shadowed in a subquery** | outer `unit` at scope 1, inner `assessment AS unit` at scope 2 |
| an `IN` subquery | `unit` at scope 1, `assessment` at scope 2 |
| `dues_status@1`'s real shape | one ref, `unit` aliased `u` |
| not SQL at all | **throws** `syntax error at or near "this"` |
| two statements | `stmts.length === 2` |

**The alias-shadowing row is the point of the story.** It is the bypass the regex scanner
structurally could not catch — both references found a predicate, but one belonged to the inner
query — and per-scope resolution falls out of the parse tree rather than being something the sweep
has to be clever about.

**And most of `FORBIDDEN_LEXICAL` becomes unnecessary rather than merely redundant.** Comments,
string literals and dollar constructs were forbidden because the scanner could not read them. A
parser reads them, so the entries exist only if something still needs them — which Task 4 decides
rather than assumes.

#### AC3 gets a mechanical definition

"What the parser cannot analyse is refused, not guessed at" was a judgement call against a regex.
Against a parser it is exact: **a parse error is a refusal**, and so is `stmts.length !== 1`. There
is no third state where the sweep proceeds on a partial understanding.

#### Rejected

| Candidate | Why not |
| --- | --- |
| `pgsql-ast-parser` 12.0.2 (MIT, pure TS) | A re-implementation of the grammar. Reintroduces exactly the "resembles Postgres" failure this story removes. |
| `node-sql-parser` 5.4.0 (Apache-2.0) | Multi-dialect PEG — broader, and correspondingly less faithful to the Postgres-specific lexical forms that produced six of the eight bypasses. |
| `sql-parser-cst` 0.42.1 | **GPL-2.0-or-later.** Not a licence to add to this tree without a deliberate decision, and there is no reason to when an MIT option is strictly better on the merits. |

### Where this sits

Nothing depends on this story, and it depends on nothing. It touches one test file and whatever
dependency task 1 chooses. It is not urgent in the way 5.1c is not urgent — `no-association-creation.test.ts`
forbids the product from creating a second association, so a catalog entry that read across
associations would today read across exactly one.

**What makes it worth doing anyway:** the guard's job is to catch a *new* entry that is unscoped,
and it has been demonstrated eight times that it can be satisfied without scoping anything. A guard
that can be satisfied dishonestly is worse than none, because it is reported as a pass.

### References

- `catalog/registry.test.ts` — the sweep, `sweepVerdict`, and the eight fixtures as they stand
- `adapters/db/catalog-isolation.test.ts` — the behavioural proof this is *not* replacing
- `_bmad-output/implementation-artifacts/5-1b-the-catalog-answers-for-one-association.md` — AC3, and
  the review rounds recorded in its Review Findings
- `_bmad-output/implementation-artifacts/5-1c-the-actor-is-proved-not-relayed.md` — the sibling half

## Dev Agent Record

### Test Design

#### Tasks 2-4 - failure modes of a parse-based sweep

The scanner's failure modes were all *lexical* - some text form it misread. A parser removes those
and introduces a different set, which is what this table is for. **Two of them are false-pass and
two are false-reject, and the false-rejects matter just as much**: an entry author who cannot get a
correct query past the guard rewrites the query until the guard stops complaining, which is how a
guard trains people to work around it.

| # | Failure mode | Class |
| --- | --- | --- |
| 2.1a | The WASM module is not loaded, `parseSync` throws, and the sweep folds that into "unanalysable" - **every refusal fixture then passes while the parser is not running at all** | GUARD - the harness failure is rethrown, and the parser is injectable so both branches are reachable from a test |
| 2.1b | A parse error is treated as a pass | GUARD - refusal with the parser's own message |
| 2.2a | Aliases resolved in one flat namespace, so an inner predicate satisfies an outer table - the bypass that ended 5.1b | GUARD - one scope per `SelectStmt`; the walk stops at a nested one |
| 2.2b | A predicate under `OR` or `NOT` credited as scoping | GUARD - only `AND`-reachable conjuncts count |
| 2.2c | **An `on` clause credited to the preserved side of an outer join**, which it does not filter | GUARD - per side: `JOIN_LEFT` credits the right, `JOIN_RIGHT` the left, `JOIN_FULL` neither |
| 2.2d | Join conditions ignored entirely, refusing a correct entry that binds in `on` | GUARD (false-reject) - inner-join quals credited |
| 2.2e | Outer joins refused outright, refusing a correct entry that scopes the nullable side in `on` | GUARD (false-reject) - `dues_status@1` does exactly this |
| 2.3a | More than one statement | GUARD - `stmts.length !== 1` |
| 2.3b | A schema-qualified name, which the parser reads but whose identity depends on `search_path` | REFUSE, and now for a stated reason rather than because the scanner misread it |
| 2.3c | An unqualified `association_id = $1` credited to a table it may not constrain | GUARD - resolved only when the scope reads exactly one table |
| 2.4a | A placeholder other than `$1` | GUARD |
| 2.4b | The sweep passes because it examined nothing | GUARD - `scopedReferences === 0` is a refusal, plus a per-entry non-vacuity assertion |

### Completion Notes List

**Tasks 2, 3 and 4 landed as one edit**, because they are one edit: the parse replaces the scanner,
the fixtures move onto the parse, and the lexical rules the scanner needed die with it. Splitting
them would have meant a commit where the sweep was half each.

- **642 lines out, 452 in.** Gone: `stripComments`, `stripLiterals`, `withoutComments`,
  `unrecognisedDollar`, `NOT_AN_ALIAS`, `TABLE_REFERENCE`, `tableReferences`, `UNANALYSABLE`,
  `FORBIDDEN_LEXICAL`, and every test that existed to check that hand-written lexer. Task 4 asked
  which of `FORBIDDEN_LEXICAL`'s rules a parser makes dead; the answer was **all of them**. Comments,
  literals and dollar constructs were forbidden because the scanner could not read them, and nothing
  now needs them forbidden - a predicate inside a comment simply is not in the tree.
- **A duplicated sweep went with it.** A second per-entry test re-implemented the scoping check with
  its own copy of the scanner - the exact duplication the surviving comment warns about, sitting in
  the same file. It is now one `sweepVerdict` plus a non-vacuity assertion.
- **`sweepVerdict` stayed synchronous.** `parseSync` works once `loadModule()` has been awaited, so
  one `beforeAll` keeps every fixture and per-entry assertion a plain expression. Making the sweep
  async would have rippled through every call site for no gain.
- **The parser is an argument with a default.** Not indirection for its own sake: the branch telling
  a *broken harness* apart from an *unparseable entry* is unreachable otherwise, and it is the
  branch whose failure is silent. Same reasoning `core/auth/actor-assertion.ts` records for its key
  and clock. The first version of that test asserted a regex against a hardcoded string - vacuous,
  and caught before it was committed.
- **Twelve mutations, twelve caught**, each reverted and re-verified: the scope boundary, `OR` as
  `AND`, schema acceptance, the vacuity guard, the statement count, any-placeholder, the ambiguity
  guess, the harness/parse distinction, swapped join sides, outer-as-inner, the filtered-side
  restriction, and inner-join quals ignored.

#### The finding that made the story worth more than its ACs

Argus raised a **high** on the first review: `on` clause predicates were credited regardless of join
type, and **an outer join's `on` clause does not filter the preserved side**. So
`from unit u left join m on u.association_id = $1` returns every association's units and the sweep
called it scoped. Real, and a defect the *previous* scanner could not have had - it never looked at
join conditions at all. Reading SQL properly means owning SQL's semantics, not only its syntax.

**The first fix was wrong in the other direction**, and the catalog caught it: refusing outer joins
outright rejected `dues_status@1`, which scopes `payment` in the `on` clause of a `left join`. That
is correct SQL - the nullable side *is* filtered by its own `on` clause. The rule is per side, not
per join. Both directions now have fixtures and both are mutation-proved.

Worth naming because the sequence is the argument for the whole pipeline: an independent reviewer
found a real defect, the obvious fix introduced a worse one, and the per-entry sweep over the real
catalog caught that within a single test run.

### File List

- `catalog/registry.test.ts` - the sweep rewritten around the parse; the hand-written lexer and its
  tests removed
- `package.json`, `package-lock.json` - `libpg-query` as a `devDependency`

### Change Log

| Date | Change |
| --- | --- |
| 2026-08-21 | Split from 5.1c, which had absorbed it from 5.1b. Same theme, no shared files |
| 2026-08-21 | Task 1: libpg-query 17.7.4 chosen as a devDependency, measured against all eight bypasses; ready-for-dev |
| 2026-08-21 | Tasks 2-4: the sweep parses. 642 lines of hand-written lexer removed; Argus found the outer-join semantics the rewrite had wrong |
