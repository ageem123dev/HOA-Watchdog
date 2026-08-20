---
Status: review
baseline_commit: 04a94fefe53900c0b20b8902f3b127fc8e6f7ad9
merge_request:
---

# Story 5.1b: The catalog answers for one association

## Story

As **a board member**,
I want **a question I ask to be answered from my association's records and no one else's**,
so that **onboarding a second association cannot let one board read another's ledger**.

Split from story 5.1 on 2026-08-19. That story made every row *say* which association it belongs to
and proved a child cannot belong to a different one than its parent. Nothing reads the column yet.
This story is the read path: the session, the gateway binding, the catalog predicate, and the proof
that rows do not cross.

**Until this lands, `association_id` is stored and constrained but unused** — the catalog still
answers across the whole table. That is correct while exactly one association exists, and it is
precisely why this story must precede a second.

## Acceptance Criteria

1. **An authenticated session yields the board member's association.** Sign-in behaviour is
   otherwise unchanged.

2. **The gateway binds the association from the session, and it is never a tool parameter.** A
   `/tools/v1/*` request that supplies an association id does not get to choose with it — the
   supplied value is refused or ignored, and a test proves which.
   *(AD-5 amendment, clause 2 — the load-bearing half. An injection that cannot author SQL but
   **can** choose whose records to read has defeated AD-5 while obeying its letter, and the agent
   service holds `/tools/v1/*` access.)*

3. **Every catalog entry filters by association, enforced by a test over the registry** rather than
   judged at review. A new entry whose SQL does not scope turns the suite red.
   *(AD-5 amendment, clause 1. `strict: true` guarantees the arguments are well-formed, not that the
   query is bounded — parameter validation cannot save an entry that never scoped.)*

4. **Rows do not leak across associations.** A test gives a second association its own records and
   shows a catalog query for association A returns none of B's. This is the story's real proof, and
   the one that must not be vacuous: deleting the predicate must fail it.

5. **Nothing in the product creates a second association.** No product code path inserts into
   `association` — the pilot row arrives by migration, and the second one in AC4's test is inserted
   by the test. A structural test asserts this, in the shape
   `core/security/no-model-in-alerts.test.ts` already uses. Row-level security does not exist, so
   scoping is by construction; AD-4's amendment calls onboarding a second association without RLS a
   defect rather than a trade-off, and this guard is what forces that conversation instead of
   letting it be skipped.

## Tasks / Subtasks

- [x] **Task 1 — The session carries the association.** `core/auth/authenticate.ts` and its adapter.
      (AC1)
- [x] **Task 2 — The gateway binds it.** `/tools/v1/*` resolves the association from the session,
      not the request body; prove a supplied id cannot choose. (AC2)
- [x] **Task 3 — Catalog scoping and its registry test.** `duesStatusV1` is the only entry today;
      the test must bind *every* entry, present and future, in the shape `registry.test.ts` already
      applies to entry ids. (AC3)
- [x] **Task 4 — The isolation proof, and the creation guard.** (AC4, AC5)
- [x] **Task 5 — Make the identity keys association-scoped.** `unit (normalised_number)` and
      `vendor (normalised_name)` are global unique indexes from migrations 011 and 009, so a second
      association cannot hold a unit or vendor whose name collides with the first — and
      `roll-repository`'s `on conflict (normalised_number) do update` would silently resolve to the
      first association's row. Replace both with composite indexes on `(association_id, ...)` and
      update the two `on conflict` clauses that name them. Found by Argus reviewing 5.1; deferred
      there because it changes what "the same unit" means and requires dropping an index, which 5.1's
      strictly-additive migration forbids. **This must land before a second association is
      onboarded.**

## Dev Notes

### What 5.1 already built

- `association` with a `demo` row at fixed id `00000000-0000-7000-8000-000000000001`.
- `association_id`, `not null`, on all fourteen tables holding association data, each with a foreign
  key, plus composite keys so a child cannot sit under a parent in another association.
- Every write derives its association from its parent rather than taking one. There is **no column
  default** — deliberately, so the invariant cannot become true by accident.
- A drift guard: any table without the column must be named in an allowlist or the suite turns red.

### Where the association must come from

From the authenticated session, resolved by the gateway — **never** from the agent, and never from a
tool argument. The agent names a catalog entry and supplies the parameters a question needs; whose
records it runs against is decided before the request reaches the catalog.

### The vacuity risk, named in advance

AC4 is the one that will look green while proving nothing. A test that scopes to association A and
asserts it sees A's rows passes whether or not the predicate exists, because A's rows are all
there is unless B's are too. So: give B rows of its own, in the same tables, and assert A's answer
excludes them — then delete the predicate and watch the test fail before trusting it.

Story 5.1 shipped exactly this defect in its AC8 and the audit caught it: with one association,
any derivation — correct, wrong, or a hard-coded constant — produced the same answer.

### The code as it stands today

Read in full while preparing this story. Each is an UPDATE, not a NEW file.

- **`core/auth/authenticate.ts`** returns `{ kind: 'authenticated', user: { id, email } }`. It knows
  nothing of associations. `core/ports/user-directory.ts`'s `DirectoryUser` carries
  `id / email / passwordHash / disabledAt`.
- **`adapters/auth/auth.ts`** uses `session: { strategy: 'jwt' }` — Auth.js does not support database
  sessions with the Credentials provider, and the file already records that a session cannot be
  revoked server-side. The `jwt` callback carries `token.sub` only; the `session` callback copies it
  to `session.user.id`.
- **`app/oracle/page.tsx:73`** takes `actorId = session.user.id` and hands it to `askOracle`.
- **`app/tools/v1/catalog/execute/route.ts`** authenticates a **service token**
  (`AGENT_SERVICE_TOKEN`), reads `{ entryId, version, parameters, actorId }` from the body, and calls
  the executor. Order is verify → parse → execute, and a rejected caller must not reach the executor.
- **`adapters/db/catalog-executor-postgres.ts`** resolves the entry, validates parameters, writes the
  provenance row, *then* runs the SQL on `readerPool()` as `watchdog_reader`. Logging before
  executing is AD-12 made structural; do not reorder it.
- **`catalog/bind-values.ts`** maps `entry.bind` names to the positional `$1 … $n` array.
- **`catalog/entries/dues-status-v1.ts`** is the only entry. Its SQL reads `assessment`, `unit` and
  `payment` — three scoped tables — and filters on `$1` (unit) and `$2` (year) with no association
  predicate.

### Three constraints this will hit

**1 — There is no board-member session at `/tools/v1/*`, so AC2's "from the session" needs restating
in terms of what that endpoint actually holds.** It authenticates the *agent service*, not a user;
the board member arrives as an `actorId` string that has round-tripped
`page.tsx → askOracle → chat-client → chat_service.py → tools_client.py → this route`. The
association must therefore be **derived server-side from `actorId`** — the same derive-never-accept
rule story 5.1 applied to every write — rather than read from a session object that is not there.

AC2 stays exactly as written and is satisfiable as written: an `associationId` in the request body
must not change which records come back, and a test must prove it. What that does **not** close is
that `actorId` is itself caller-supplied. See the open question below; do not quietly widen this
story to cover it.

**2 — The registry sweep already constrains `bind`, and scoping breaks it.** `catalog/registry.test.ts`
asserts, for every entry, that `entry.bind.length` equals the highest `$n` in the SQL, and that every
bound name is a key of `parameters.properties`. A placeholder reserved for the association satisfies
neither: nothing in `parameters` may name it, or the model could supply it. Amend those two
assertions **deliberately** — reserving `$1` for the association and offsetting the declared
parameters — rather than discovering the failure and loosening the test to make it pass. Loosening it
is what removes the protection AC3 is asking for.

For AC3, prefer a check with teeth over a substring match: for each of the fourteen scoped tables
named in `migrations/024_association.sql`, if an entry's SQL references it, require a predicate
binding that reference to the association placeholder. A test that only greps for the string
`association_id` passes on an entry that mentions it in a comment.

**3 — Task 5 is a new migration and it is not additive.** `unit (normalised_number)` and
`vendor (normalised_name)` are global unique indexes from migrations 011 and 009. Replacing them with
`(association_id, …)` composites means a `drop index`, and `migrations/association.test.ts` asserts
024 is strictly additive — that assertion is about 024 and must not be widened to excuse 025. Two
`on conflict` clauses name those indexes (`roll-repository`, and the vendor path); both change with
the index or they resolve against nothing.

### Open question for Matt, to answer before or during this story

**Deriving the association from `actorId` moves the trust anchor to `actorId`, and the agent service
chooses it.** A prompt-injected agent cannot author SQL and, after AC2, cannot name an association —
but it can pass another board member's id and be answered honestly about their association. That
defeats AD-5's purpose while obeying its letter, which is the threat AC2's own parenthetical names.

Options, in increasing cost: accept it for a single-association pilot and write it down; or have the
Next.js side mint a short-lived signed token binding `actorId` (and the association) that the agent
service relays opaquely and this route verifies. The second changes AD-15/AD-17's wire contract, so
it is an architecture decision rather than a story fix. **This story does not decide it.**

### References

- `.../ARCHITECTURE-SPINE.md` — AD-4 and AD-5 with their 2026-08-18 amendments; the multi-tenancy
  deferral, updated by 5.1 so that row-level security alone remains
- `_bmad-output/implementation-artifacts/5-1-the-association-exists.md` — the schema this builds on
- `catalog/registry.ts`, `catalog/registry.test.ts`

## Dev Agent Record

### Agent Model Used

### Test Design

#### Task 1 — The session carries the association

**Behaviour 1.1 — `findByEmail` returns the row's association.**

*Observable signal:* `DirectoryUser.associationId` equals the `association_id` of that
`board_member` row, read back from a real database.
*Seam:* the adapter owns its own pool, so a live database is the only honest test.
`describeWithDatabase` self-skips without `WATCHDOG_WRITER_DATABASE_URL`, matching `adapters/db/`.
Nothing runs `adapters/auth/` today, so `test:db` must widen to include it — see the gate note in
Completion Notes.

| # | Failure mode | Class |
| --- | --- | --- |
| 1.1a | The SELECT omits `association_id`. `pg` returns only the columns asked for, `UserRow` is hand-written, so the absent column arrives as `undefined` and TypeScript never notices | GUARD — assert the value equals a known association id, not that the field is present |
| 1.1b | Two members in different associations; a query that lost its `where email = $1` returns the other one's association | GUARD — zero/one/many: seed two, assert each resolves to its own |
| 1.1c | Email not found | GUARD — still `null`, association or not |
| 1.1d | `association_id` is null | OUT-OF-SCOPE — `not null` since migration 024, asserted by `migrations/association.test.ts` |

*Cross-check (required by `require_inverse_or_crosscheck`):* the id the port returns must equal the
one a direct `select association_id from board_member` reports — the same fact by an independent
path.

**Behaviour 1.2 — `authenticate` carries it into the authenticated result.**

*Observable signal:* `result.user.associationId` on the `authenticated` branch.
*Seam:* the existing fake directory. No database, no framework.

| # | Failure mode | Class |
| --- | --- | --- |
| 1.2a | An association reaches a *rejected* result, telling an anonymous caller which association an address belongs to | GUARD — assert all three rejection paths (absent user, wrong password, disabled) carry no user object at all |
| 1.2b | Sign-in behaviour changes — AC1's second sentence. The absent-user timing equalisation, the disabled-checked-after-password ordering, and the opportunistic rehash must all still hold | GUARD — the existing tests are the assertion; a new one would restate them |
| 1.2c | An existing fake directory omits `associationId` | PROPAGATE — compile error, caught by `tsc` |

**Behaviour 1.3 — the session exposes it.**

*Observable signal:* `session.user.associationId`.
*Seam:* the `jwt` and `session` callbacks are pure functions of their arguments. Extract them so a
test calls them directly instead of booting Auth.js.

| # | Failure mode | Class |
| --- | --- | --- |
| 1.3a | A JWT issued **before** this change carries no `associationId`, and every signed-in director holds one for up to 8 hours (`SESSION_MAX_AGE_SECONDS`) | GUARD — the session callback must tolerate absence rather than write `undefined` onto a field typed `string` |
| 1.3b | `user` is undefined on refresh. The `jwt` callback runs on every request and receives `user` only at sign-in, so an unguarded read erases the claim on the first refresh | GUARD |
| 1.3c | The `next-auth` module augmentation is missing | PROPAGATE — does not compile |

**The session claim is not the authorization boundary.** Task 2 derives the association server-side
from `actorId`; 1.3a is therefore a correctness bug rather than a security hole, and the guard is
about not handing `undefined` to code that expects a string.

### Debug Log References

#### Tasks 5 and 4 — run in that order, deliberately

**Task 5 had to precede task 4.** AC4 is only non-vacuous if both associations hold the *same* unit
number — otherwise deleting the predicate changes nothing, because B's rows could never have matched
A's query anyway. The same unit number in two associations is exactly what migration 011's global
unique index forbade. Doing them in the listed order would have produced the vacuous test the story
warned about on its own first page.

**The isolation test was vacuous when first written, and the sensitivity check is what said so.**
Deleting `assessment.association_id = $1` left all five cases green. The three predicates are
mutually redundant: with `unit.association_id = $1` still in the join, B's assessment cannot reach
A's unit, so scoping *either* root suffices behaviourally. Removing **both** root predicates fails
it properly — `expected [ …, … ] to have a length of 1 but got 2`, both boards' assessments in one
answer.

That redundancy is a property of migration 024, not an accident: composite foreign keys make a
child's association follow its parent's. It means **no behavioural test can isolate a single
predicate**, and the division of labour is explicit — `registry.test.ts` holds each predicate
structurally (proved sensitive on its own), and `catalog-isolation.test.ts` holds the behaviour.

**The creation guard was proved by planting one.** An `insert into association` added to
`adapters/db/query-log-postgres.ts` failed the sweep by name. Its matcher has its own tests in both
directions, because a guard whose regex never matches anything reports success forever.

**Two existing guards caught the schema change on their own** — `migrations/unit.test.ts` and
`vendor.test.ts` both assert which *columns* the identity index covers, not just its name, and both
went red. Updated to the composite form, which is narrower than what they asserted before, not
looser. `docs/readme.test.ts` caught the migration count.

**One scripted edit failed its own anchor** (Python escaping against a CRLF file) and wrote nothing;
the two index assertions were then made with exact edits instead.

#### Tasks 2 and 3

**Two reviewer findings were real and one was mine to be embarrassed by.**

- *Task 2, `[high]`:* `core/ports/query-log.test.ts` pins the port's declared members as exact
  signature strings, including `record(entry: QueryLogEntry): Promise<string>`. Changing the return
  type broke it. **My own gate reading had missed this**: I piped `npm test` through `tail -5`, saw
  `exit 0`, and read it as green — but that exit code is `tail`'s, not vitest's, and the summary line
  four rows further up said `1 failed`. Fixed by updating the expected signature; the surviving
  `Promise<string>` at line 46 is a synthetic sample that exercises the parser, not a claim about the
  port. **Read the summary line, never the exit code of a pipeline.**
- *Task 3, `[info]`:* an orphaned `##` heading, left when new sections were inserted in front of an
  existing one. Confirmed and removed.

**The sensitivity check found a vacuity in a test I had just written**, which is the reason it exists.
Deleting `unit.association_id = $1` from the entry left the registry sweep **green**. Cause: the
alias scanner's optional group consumed the following keyword, so `from assessment join unit` parsed
as "assessment, aliased `join`" and the scan resumed past the `join` — `unit` was never seen and the
sweep silently checked two of three tables. The keyword list is now a lookahead rather than a
post-hoc filter, the scanner has two tests of its own, and the same mutation now fails with
`reads unit as "unit" without binding it to $1`.

**Other mutations, all caught:** dropping `association_id` from the query log's `RETURNING` (3 of 5
fail); removing the route's `associationId` refusal (all 5 refusal tests fail); seeding both members
into one association (only the two-association case fails).

**One mutation did not apply and would have read as a pass.** The route guard was first mutated with
a `\n` anchor against a CRLF file; the replacement silently matched nothing and the suite came back
green. The script's own assertion caught it. Re-run CRLF-aware, it failed all five.

**`argus_review` returned `CANCELED` once** on the task 3 diff and succeeded on retry with
`provider: "auto"`.


**Task 1 red, then green.** `session-claims.test.ts` failed 2 of 8 on assertions
(`expected undefined to be 'association-a'`) with the other 6 green — those pin the behaviour the
seam extraction had to preserve. `user-directory-postgres.test.ts` failed 3 of 5, each
`expected undefined to be '<a real uuid>'`. No failure was an import or missing-symbol error.

**Sensitivity, both directions.**

- *Code:* dropped `association_id` from the adapter's SELECT list → 3 of 5 failed. Restored.
- *Fixture:* seeded both members into association A, leaving the code and the expected values alone
  → exactly `keeps two members in two associations apart` failed, which is the only case that
  depends on them differing. Restored and re-run green.

**One review had to be discarded.** The first `argus_review` was passed
`diff_file: "/tmp/task1.diff"` and returned a confident clean verdict describing
`core/ports/finding-reader.ts` and `core/ports/checked-documents.ts` — epic-4 files, not in the
diff — with `files_discovered: 5` against a 10-file change. The MCP server resolves the path
itself, so the POSIX form did not reach the file. Re-run with `C:/tmp/task1.diff`:
`files_discovered: 12`, every file named correctly. Recorded in
`_bmad/custom/argus-review-routing.md`, since it is the same silent-wrong-target shape that file
already warns about for `repo_root`.


### Completion Notes List

**Task 5 — the identity keys are association-scoped.** Migration 025 replaces the global unique
indexes on `unit (normalised_number)` and `vendor (normalised_name)` with composite ones on
`(association_id, …)`, creating each replacement before dropping the index it replaces so
uniqueness is never briefly unenforced. Both `on conflict` clauses that named the old indexes were
updated — they would have failed outright otherwise.

The quiet half was worse than the refusal, and is why this could not wait: `roll-repository`'s
`on conflict (normalised_number) do update` would not have *failed* on a second board's roll. It
would have resolved onto the **first** association's unit row and renamed it, leaving one row where
two belong and both boards' dues computed against it. A composite foreign key cannot catch that —
no row ends up in the wrong association; one simply never gets created.

**Applied to the pilot database** with `npm run migrate` (`apply 025_…`), as 024 was.

⚠️ **What task 5 deliberately did not do, and why it matters.** Eight product read paths still match
on the normalised value alone — `unit-directory` (three), `vendor-directory` (three),
`vendor-resolution` (two) and `roll-repository`'s unit lookup. With one association they return
exactly what they did before. **With two they are ambiguous.** Scoping them is the product read
path, not the catalog read path, and no acceptance criterion here covers it. This is the strongest
argument for AC5's guard: the second association must not be creatable until that work is done.

**Task 4 — the isolation proof and the creation guard.**

- `adapters/db/catalog-isolation.test.ts` gives two boards the same unit number and the same year,
  with figures chosen so no answer of A's equals or divides one of B's, and asserts each gets one
  row and its own numbers. It also asserts the seed really produced two units, so the sweep cannot
  pass by there being nothing to leak.
- `core/security/no-association-creation.test.ts` globs every production source file rather than
  naming a path list — the claim is about the whole product, and a list stops covering the directory
  somebody adds next. `migrations/` is excluded on purpose: seeding the pilot association there is
  the arrangement being protected, not the thing forbidden.


**Task 2 — the gateway binds it.** The association is derived from the board member the query is
run for, and no request shape can influence it.

- **One derivation, not two.** `query_log`'s INSERT already resolved the association from the actor
  in SQL (story 5.1). Rather than resolve it a second time for the query itself — two statements of
  one rule with nothing failing on disagreement — `QueryLog.record` now returns what it wrote. The
  property that buys: **the association a query runs under is the association its audit row
  records.** They cannot drift, because there is only one of them.
- **An unknown actor fails loudly and logs nothing.** The subquery yields NULL against a `not null`
  column, so the insert is refused, no provenance id comes back, and the executor never runs the
  SELECT. Asserted directly.
- **A supplied `associationId` is refused, not ignored.** AC2 allows either; refusal was chosen
  because ignoring is safe *silently*, and a caller that passes a parameter and gets a 200 has been
  told it worked. The **presence** of the key is the refusal — a truthiness check would wave through
  `null`, `''` and `0`, which teaches a prober which shapes the endpoint tolerates. 401 still
  outranks it, so an unauthenticated caller learns nothing about the field.
- **`adapters/db/query-log-postgres.ts` had no test of its own** before this. It has one now, and it
  needs `DATABASE_URL` as well as the writer: migration 020 revokes DELETE on `query_log` from
  `watchdog_writer`, so the role that writes the audit trail deliberately cannot clean up after
  itself. That is the constraint working, and the first version of the teardown fell foul of it.

**Task 3 — catalog scoping and its registry test.** `$1` is the association in every entry, supplied
by the executor and never by a caller.

- **The offset lives in `bindValues`**, the one place the ordering contract is already applied. An
  offset applied at a call site is an offset that can disagree with this one.
- **`registry.test.ts` enforces scoping structurally**: it walks each entry's `from`/`join` clauses,
  takes the alias each association-owning table is bound to, and requires a predicate joining *that
  alias* to `$1`. A grep for the string `association_id` would pass on an entry that mentions it in
  a comment or scopes one table of three. It also refuses a parameter named `associationId` and
  holds `bind.length === highest placeholder - 1`, so an entry cannot quietly reclaim `$1`.
- **`payment`'s predicate is in the `ON`, not the `WHERE`.** In the `WHERE` it reads identically and
  turns the left join inner, so every unit that has never paid disappears from the answer instead of
  reporting `amountPaid` `0.00` — a silently wrong financial answer.
- **AD-14: `dues_status@1` was edited in place and its digest re-pinned, by explicit decision.**
  AC3 and AD-14 could not both hold: the entry's SQL is frozen once published, and
  `published-versions.test.ts` also forbids removing a published entry, because a `query_log`
  `(entry_id, version)` that resolves to nothing breaks the trail exactly as an edit does. Put to
  Matt on 2026-08-20 with three options; the ruling was to amend `@1`, on the grounds that the pilot
  database holds test data only and no row records a real board member's question. The alternative
  left `@1` runnable and unscoped — the exact hole this story closes. Recorded in the entry's own
  header so the next reader meets it there, and **it does not license a second edit**.
  *Follow-up for Matt: AD-14's wording in the spine now overstates the freeze and should be amended
  to name the pre-production exception, or this decision will read as a violation rather than a
  ruling.*


**Task 1 — the session carries the association.** `board_member.association_id` now travels with
the identity from the SELECT through `authenticate` to the JWT and the session.

- **It travels *with* the identity, not behind a second lookup.** A separate query keyed on the
  member id would leave a window between the two answers with nothing failing when they disagree —
  the shape migration 007's comment warns about.
- **The port types it `string`, the token types it optional, and that is not a contradiction.** A
  `board_member` row cannot exist without an association; a *token* can, because
  `SESSION_MAX_AGE_SECONDS` is eight hours and every director signed in when this ships holds a JWT
  minted before the claim existed. `applyClaimsToSession` copies a claim only when it is present,
  so an old token yields a session with no `associationId` rather than one holding `undefined`
  behind a type that says `string`.
- **The session claim is deliberately not an authorization input**, stated in `next-auth.d.ts`
  where someone about to use it will read it. A JWT is not revocable with the Credentials provider,
  and `/tools/v1/*` — the path that actually reads scoped records — has no session at all. Task 2
  derives the association server-side instead.
- **AC1's "otherwise unchanged" is held by the existing tests**, not a new one: the absent-user
  timing equalisation, the disabled-checked-after-password ordering and the opportunistic rehash all
  still pass, and `never reports why it rejected` is an exact `toEqual({ kind: 'rejected' })` that
  would fail if an association leaked onto a refusal.
- **Gate change:** `test:db` now names `adapters/auth/`. Nothing ran that directory before, so
  `user-directory-postgres.ts` had no database test at all and the new one would have been collected
  and skipped forever. The adapter keeps its own module-scoped pool — story 3.2's widening of
  `test:db` caused pool-contention timeouts, so this is worth watching, though one file at `max: 5`
  is a far smaller change than that one was.
- **Sibling shape found, not fixed here** (Step 8 question 4): every `adapters/**/*-postgres.ts`
  maps a hand-written row interface over a SELECT list, so any column omitted from the list arrives
  as `undefined` behind a non-optional type. Task 1 fixes the one instance the story needs. The
  general answer is a database test per adapter that asserts values rather than shapes, which is
  well outside this story.


### File List

**Production (18)**

- `README.md`
- `adapters/auth/auth.ts`
- `adapters/auth/next-auth.d.ts`
- `adapters/auth/session-claims.ts`
- `adapters/auth/user-directory-postgres.ts`
- `adapters/db/catalog-executor-postgres.ts`
- `adapters/db/query-log-postgres.ts`
- `adapters/db/roll-repository-postgres.ts`
- `adapters/db/vendor-resolution-postgres.ts`
- `app/tools/v1/catalog/execute/route.ts`
- `catalog/bind-values.ts`
- `catalog/entries/dues-status-v1.ts`
- `catalog/published-versions.json`
- `core/auth/authenticate.ts`
- `core/ports/query-log.ts`
- `core/ports/user-directory.ts`
- `migrations/025_association_scoped_identity.sql`
- `package.json`

**Tests (15)**

- `adapters/auth/session-claims.test.ts`
- `adapters/auth/user-directory-postgres.test.ts`
- `adapters/db/catalog-execution.test.ts`
- `adapters/db/catalog-executor-postgres.test.ts`
- `adapters/db/catalog-isolation.test.ts`
- `adapters/db/query-log-postgres.test.ts`
- `app/tools/v1/catalog/execute/route.test.ts`
- `catalog/bind-values.test.ts`
- `catalog/registry.test.ts`
- `core/auth/authenticate.test.ts`
- `core/ports/query-log.test.ts`
- `core/security/no-association-creation.test.ts`
- `migrations/association-scoped-identity.test.ts`
- `migrations/unit.test.ts`
- `migrations/vendor.test.ts`

**Docs and planning (3)**

- `_bmad-output/implementation-artifacts/5-1b-the-catalog-answers-for-one-association.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad/custom/argus-review-routing.md`

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-19 | Split from story 5.1 |
| 2026-08-20 | Context pass: files read, three constraints and one open question recorded; ready-for-dev |
| 2026-08-20 | Tasks 1-5 implemented test-first; AD-14 decision taken by Matt; ready for review |
