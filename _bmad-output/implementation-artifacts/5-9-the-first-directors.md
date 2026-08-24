---
Status: review
baseline_commit: d2a54db
merge_request: 87
---

# Story 5.9 — the first directors

## Story

As a director already on the board,
I want to add another director from inside the product,
So that provisioning a colleague does not require somebody with a database credential running a script.

## Where this actually stands today

`scripts/add-board-member.mjs` is the only way an account comes into existence. It connects with
`WATCHDOG_WRITER_DATABASE_URL`, generates a password, prints it once, and writes `board_member`
directly. Its own comment names this story as its replacement.

**And its association clause is already a live fault line.** It writes:

```sql
values ($1, $2, $3, (select id from association))
```

That bare subquery is correct while one association exists and raises *"more than one row returned by
a subquery used as an expression"* the moment a second does. The script says so, and calls that the
correct failure — *"failing loudly is better than silently enrolling somebody into the wrong board"*.
Story 5.1 made a second association representable. So the script is one `insert into association`
away from being unusable, and there is currently nothing else.

## The constraint that shapes the whole story

**The first director of an association cannot be created from inside the product.** Nobody is signed
in yet, and every in-product write derives its association from the authenticated member. That is not
an oversight to design around — it is the same rule that makes the feature safe.

So this story does **not** retire the script. It narrows what the script is for:

| | Before | After |
| --- | --- | --- |
| First director of an association | the script | the script, and only this |
| Every director after the first | the script | the product |

The epic's row says *"A board is provisioned through the product rather than by someone running
SQL"*, and that is what this achieves for every case except the one where it is impossible. Saying
which case remains, and constraining the script to it, is the honest version of "retires or
constrains".

## Acceptance Criteria

1. **A signed-in director can add another director to their own association.** From a page in the
   product. The new account can sign in afterwards.

2. **The association is the inviting director's, derived in SQL and never chosen.** No association
   picker, no association id in the form, no parameter. This is 5.1's rule and it is the reason the
   script cannot do this job.

3. **The password is shown exactly once and is never recoverable.** Generated server-side, displayed
   to the inviting director to pass on, and stored only as the scrypt hash `core/auth/password.ts`
   produces. It must not be logged, and it must not survive a page refresh.

4. **An address already on the board is refused, not silently reset.** The script does
   `on conflict (email) do update set password_hash = excluded.password_hash` — a password reset
   wearing the shape of an insert. In the product that is a different act with different
   consequences, and doing it by accident would lock a colleague out. Refuse, and say the address is
   already on the board.

5. **Provisioning is refused when it is not a director asking.** A server action is its own entry
   point; the page's protection guards nothing. Asserted for an absent session, as every other action
   in this project asserts it.

6. **The script survives, for the one case that needs it, and says so.** It keeps working for the
   first director of an association. Its header states that every subsequent director is added in the
   product, and why this one cannot be. A script whose comment still points at this story as its
   replacement, after this story ships, is a comment that has become wrong.

7. **Nothing else gains the ability to write `board_member`.** The new path and the script are the
   two writers, and that set is closed the way story 5.8 closed `ingest`'s callers — structurally,
   because a third writer would be invisible to every behavioural test here.

## Tasks / Subtasks

- [x] **Task 1 — A port for adding a director, and its adapter.** Association derived from the
      inviting member in SQL. Refuses a duplicate address rather than resetting it. (AC1, AC2, AC4)
- [x] **Task 2 — The server action.** Session required, password generated server-side, shown once.
      (AC1, AC3, AC5)
- [x] **Task 3 — The page.** A form, and the one-time password displayed where the inviting director
      can copy it. (AC1, AC3)
- [x] **Task 4 — Constrain the script and correct its header.** (AC6)
- [x] **Task 5 — Close the set of `board_member` writers.** (AC7)

## Dev Notes

### What exists — read before writing anything

| File | Why it matters |
| --- | --- |
| `scripts/add-board-member.mjs` | The thing being narrowed. Read its association comment first — it predicts this story |
| `migrations/001_board_member.sql` | `email` lower-case by constraint, `disabled_at` for revocation, `association_id` not null since 5.1 |
| `core/auth/password.ts` | `hashPassword`. The only hash format the sign-in path accepts |
| `core/auth/authenticate.ts` | Checks `disabled_at` **after** the password, so a disabled account is indistinguishable from a wrong one |
| `adapters/auth/user-directory-postgres.ts` | How `board_member` is read today. The nearest shape for the new adapter |
| `app/onboarding/mapping/actions.ts` | The session guard and the error-state pattern every server action here uses |
| `core/ingestion/ingest-callers.test.ts` | Story 5.8's closed-set test. Task 5 is the same shape for a different verb |
| `migrations/003_reader_hardening.sql` | **`watchdog_reader` may not read `board_member` at all.** Any adapter touching it uses `writerPool` |

### The decisions most likely to be got wrong

**Any director may add a director.** `board_member` has no role column, so there is no "admin" to
check against. This story does not add one: roles are a schema change and a permissions model, and
the pilot's board is small and mutually trusting. The consequence is stated rather than hidden —
**anyone who can sign in can create an account on their own board.** That is a real privilege, and it
is the same privilege the script already grants to anyone with the writer credential. If it should be
narrower, that is a story about roles, not a checkbox here.

**Refuse a duplicate, do not reset it.** The script's `on conflict do update set password_hash` is a
password reset in the shape of an insert. Reproducing that in a form is how a director "adds" a
colleague who is already on the board and silently invalidates their password. AC4 exists because the
convenient implementation is the dangerous one.

**The reader cannot help.** Migration 003 revokes all on `board_member` from `watchdog_reader`,
deliberately: *"the LLM-driven query path has no business with credentials"*. Story 5.8 learned this
the same way — a SELECT that derives an association from a member cannot use the reader pool, and a
reader-pool version throws a permission error at the moment somebody uses the feature.

**The password must not reach a log.** It is the one value in this story that is dangerous in
transit. `console.error` on a failure path that includes the form data would put it in the log store;
the existing actions log the *error* and never the submission, and that pattern is the one to follow.

### Testing notes

Vitest. `.tsx` render tests are per-file opt-in with jsdom (story 1.6c). Adapter tests in
`adapters/db/` are `describe.skip` without a database — **and no database is configured on the machine
this project is currently built on**, so the text half is the only half that runs and is where the
tenancy rule must be pinned. Story 5.8's `unit-census-postgres.test.ts` is the model, including the
gate: `WATCHDOG_WRITER_DATABASE_URL` for the pool the adapter uses, `DATABASE_URL` for the fixture.

### Previous story intelligence — 5.8

- **The AC audit found AC2 asserted nowhere**, on a story whose tasks were all complete and green.
  Eleven consecutive stories. Audit every clause of every AC, especially ones containing "and".
- **The integration pass found the guarantee was one entry point wide.** Per-task tests proved the
  guarded path was guarded and the exempt path exempt; none said "and there is nothing else". AC7
  here is that lesson applied in advance rather than after.
- **A finding was refuted with evidence and the refutation mattered** — following it would have made
  the database suite skip when it should run and crash when it did. Verify every finding against the
  file before acting.
- **The `\b` escape collapsed five times in one session** when writing tests through Python
  heredocs. Build patterns from `chr(92)`, and note that `docs/no-control-characters.test.ts` catches
  the result unaided.
- **Two `npm test` runs at once produced a false failure in a security guard.** Do not run suites
  concurrently.

## Dev Agent Record

### Test Design

#### Task 1 - adding a director to the inviting director's own association

**Behaviour: `DirectorRoster.add(invitedBy, email, displayName, passwordHash)`.**

1. *If it ran correctly, how would I know?* A row exists in `board_member` with that address, the
   inviting director's association, and a hash that `authenticate` accepts - so the new director can
   sign in. And a second call with the same address does not change the first row.
2. *How am I going to test it?* Text assertions over the adapter SQL, which always run, plus a
   database half that skips. No database is configured here, so the text half is where the tenancy
   rule is pinned - story 5.8 established this and CodeRabbit tried to change the gate on it.
3. *What else can go wrong?* Below.
4. *Could this happen elsewhere?* `scripts/add-board-member.mjs` is the sibling and has the defect
   1d names - it upserts, which is a password reset in the shape of an insert. Task 4 constrains it.

| # | Failure mode | Class |
| --- | --- | --- |
| 1a | The association taken as a parameter rather than derived from the inviting member - a caller could enrol somebody into another board | GUARD - scalar subquery over `board_member`, asserted in text and killed by mutation |
| 1b | An unknown inviting member: the subquery yields NULL and `association_id` is `not null`, so the insert raises rather than creating a director belonging to nobody | GUARD - and raising is right; a row with a null association is invisible to every association-scoped read afterwards |
| 1c | The address stored with different case, so `authenticate` lower-cases at sign-in and never matches | GUARD - migration 001 has `board_member_email_is_lowercase`, so the constraint refuses it; the adapter lower-cases first so the refusal is not how we find out |
| 1d | A duplicate address silently resetting the existing password - the script's `on conflict do update` reproduced | GUARD - `on conflict do nothing`, and the caller is told nothing was created. AC4 |
| 1e | The reader pool, which cannot read `board_member` at all (migration 003) | GUARD - `writerPool`, asserted in text because the database half skips here |
| 1f | The password hash written in a format `authenticate` does not accept | OUT-OF-SCOPE - `core/auth/password.ts` owns the format and migration 001 has a check constraint on its shape. The adapter stores what it is handed |

**Cross-check:** the round trip. A director added through this port is found by
`user-directory-postgres.ts`'s lookup - the same read `authenticate` uses - with the association the
inviting director has. Storing the fields is not the point; being able to sign in afterwards is.

#### Task 2 - the server action

**Behaviour: `addDirector(previous, formData)` provisions and returns the password once.**

1. *If it ran correctly, how would I know?* A signed-in director submits an address and gets back a
   password they can pass on; the roster was asked to add that address for *them*; and a second
   submission of the same address returns a refusal with no new password.
2. *How am I going to test it?* Through the action with `auth` and `createDirectorRoster` mocked -
   the pattern `app/upload/actions.test.ts` and the mapping actions already use.
3. *What else can go wrong?* Below.
4. *Could this happen elsewhere?* Every server action in this project has the session guard; this is
   the first that produces a secret, so the logging rule is new here.

| # | Failure mode | Class |
| --- | --- | --- |
| 2a | The password reaching a log. It is the one value in this story that is dangerous in transit, and a `console.error(error, formData)` on a failure path would put it in the log store forever | GUARD - asserted: no logged argument contains the generated password |
| 2b | Provisioning without a session. A server action is its own entry point and the page guards nothing | GUARD - refused, and the roster is never called |
| 2c | The password hashed with something other than `core/auth/password.ts`, so the account exists and can never sign in | GUARD - `hashPassword`, and the stored value is asserted to be what it returns rather than the plaintext |
| 2d | The plaintext stored instead of the hash - the worst available failure here, and one letter apart from correct | GUARD - asserted that what reaches the roster is not the password shown |
| 2e | A duplicate address reported as success, so a director believes a colleague was added and hands them a password that works for nobody | GUARD - `add` returning `false` becomes a refusal, not a password |
| 2f | An adapter failure escaping as a generic 500, losing the form and saying nothing | GUARD - caught, refused with a message, and the real error logged without the submission |
| 2g | A malformed address accepted and refused by the database constraint instead | NOTE - migration 001 has three shape constraints and 2f catches the throw. The action checks for a non-empty address so the common case is a message rather than an exception, and the database stays the authority on shape |

**Cross-check:** what the action shows and what it stores are different values, and the stored one is
the hash of the shown one. `verifyPassword(shown, stored)` is true - the inverse of `hashPassword`,
and the only check that proves the director can actually sign in with what they were handed.
#### Task 3 - the page

**Behaviour: a form, and the one-time password shown where it can be copied.**

1. *If it ran correctly, how would I know?* A signed-in director sees a form; after submitting they
   see the new address and its password; an unauthenticated visitor is redirected to sign-in.
2. *How am I going to test it?* jsdom render tests, per-file opt-in (story 1.6c). The form and the
   result are one component driven by `useActionState`, so the state is injected by mocking the
   action - the pattern `upload-form.test.tsx` uses.
3. *What else can go wrong?* Below.
4. *Could this happen elsewhere?* `app/upload/page.tsx` is the model for the redirect, and its
   comment explains why the page checks even though the route matcher already does.

| # | Failure mode | Class |
| --- | --- | --- |
| 3a | The page rendering for someone not signed in. `PUBLIC_ROUTES` is an allow-list and deny-by-default, but a page that creates credentials must not depend on a matcher pattern nobody edited carefully | GUARD - the second lock, as `app/upload/page.tsx` carries |
| 3b | The password rendered but not selectable or findable - a value shown once that the director cannot copy is a value lost | GUARD - rendered as text in an element the test finds by role and content, not buried in an attribute |
| 3c | The password persisting in the form after a refresh, or being re-shown on a later render, which would contradict "shown once" | NOTE - `useActionState` holds it in memory only; a refresh re-runs the page with the empty state. Nothing is written to storage, and the absence of any persistence call is what makes this true |
| 3d | The error state and the success state rendering together, so a director reads a password from a failed submission | GUARD - the state is a union; asserted that an error shows no password |
| 3e | The address shown back wrong, so the director hands the password to the right person for the wrong account | GUARD - the address in the result comes from the action's state rather than from the form input, which is cleared |

**Cross-check:** what the page shows is exactly what the action returned - the password in the
rendered output equals `state.password`, not a re-derivation. There is no second source for it, which
is the property that makes "shown once" true rather than merely intended.
#### Task 4 - narrowing the script, and a gap found while doing it

**Behaviour: `scripts/add-board-member.mjs` serves the cases the product cannot, and says so.**

1. *If it ran correctly, how would I know?* Its header names the product as the route for every
   director after the first, and the script still creates the first director of an association.
2. *How am I going to test it?* By reading the file. `verify-extraction.test.ts` shows scripts are
   testable here, and `dual-llm-boundary.test.ts` reads source text for claims exactly like this one.
3. *What else can go wrong?* Below.
4. *Could this happen elsewhere?* The comment naming this story as its replacement is the sibling
   defect: prose that becomes wrong when the thing it predicts arrives.

| # | Failure mode | Class |
| --- | --- | --- |
| 4a | The header still naming this story as its future replacement, after this story shipped - prose that has quietly become false | GUARD - asserted absent |
| 4b | **The script cannot bootstrap a second association.** `(select id from association)` returns two rows once one exists, and raises. AC6 says the script keeps working for the first director *of an association*; with two associations it does not | GUARD - an optional association argument. Found while writing this task, not planned |
| 4c | The argument making it *easier* to enrol somebody into the wrong board - the failure the bare subquery was chosen to prevent | GUARD - matched by name and refused unless exactly one association matches, so a typo raises rather than picking one |
| 4d | The upsert removed as "the product refuses duplicates now", taking the only password-reset path with it | OUT-OF-SCOPE as a removal, and stated: a locked-out director has no other route, and the product deliberately refuses to reset. The upsert stays and the header says why |

**Cross-check:** the header's claims and the code agree - it says the product is the route for later
directors, and `app/directors/actions.ts` exists; it says one association is chosen by name, and the
query takes a parameter. A header asserting something the file does not do is the defect 4a names,
pointed the other way.
#### Task 4 - Argus found three, and one of them this story created

**HIGH: a cross-association password reset, reported as the wrong board.** `email` is unique across
the whole table, so `on conflict (email) do update set password_hash` fires for an address held by
*any* association. Run with `--association B` for an address already in association A and the script
reset A's password, left the account in A, and printed "association: B".

The upsert predates this story. What this story added was **an association argument the upsert
ignores** - which turned a silent reset into a confidently mislabelled one. Now checked separately,
so the refusal is a sentence rather than a constraint violation, and *refused* rather than moved:
shifting an account between boards is not something a provisioning script should decide.

**MEDIUM: an error that offered help and delivered none.** On a name that matched nothing, the
message said "There are:" and then listed `associations.rows` - the empty result of the search that
had just failed. Now listed from a fresh query.

**LOW: argument parsing that lost arguments.** `argv.slice(0, associationAt)` truncated at the flag,
so `<email> --association "X" "Display Name"` silently lost the name and `--association X <email>`
failed with a usage error for a well-formed command. Now the flag and its value are filtered out
rather than the list truncated.

**And one of my regression tests failed for the wrong reason first.** The assertion that
`argv.slice(0, associationAt)` is gone matched the *comment* explaining why it is gone. Prose is not
code - the sixth instance on this project, twice inside guards written to prevent it. The test file
now splits its assertions: `SOURCE` for claims about what the file **says**, and `neutralise(...)`
for claims about what it **does**.

Four earlier mutations plus three on the fixes, all killed - including one that survived first
because the assertion checked the association argument *existed* without checking it reached the
insert. A parsed-and-discarded argument is what a half-finished refactor leaves behind.
#### Task 5 - the closed set, and AC7 was wrong

**AC7 says "the new path and the script are the two writers". There are three.**

`adapters/auth/user-directory-postgres.ts` has `updatePasswordHash`, and it is legitimate:
`authenticate.ts:86` calls it on a successful sign-in when `needsRehash` says the stored hash uses
outdated scrypt parameters. It writes `password_hash` for a member who already exists and can create
nobody.

So the criterion was written from what this story adds rather than from what the codebase holds. The
test corrects it rather than restating it, and the distinction it draws is the one that matters:
**creating a director is the privilege; updating a hash is not.**

| Writer | What it may do |
| --- | --- |
| `app/directors/actions.ts` via `director-roster-postgres.ts` | creates, scoped to the inviting director's association |
| `scripts/add-board-member.mjs` | creates the first director of an association, and resets a locked-out password |
| `user-directory-postgres.ts` | **updates a hash only**, on sign-in, for a member who already exists |

**Behaviour: no fourth writer appears without a decision.**

1. *If it ran correctly, how would I know?* The set of files writing `board_member` equals the named
   three, each with what it may do written beside it.
2. *How am I going to test it?* Structurally, scanning source for writes. Story 5.8's
   `ingest-callers.test.ts` is the same shape for a different verb.
3. *What else can go wrong?* Below.
4. *Could this happen elsewhere?* This is the second closed-set guard in two stories, which is
   itself the answer: enforcing a rule per entry point means the entry points must be enumerable.

| # | Failure mode | Class |
| --- | --- | --- |
| 5a | A fourth writer added silently - a seeding script, an admin route, a migration helper - inheriting none of the association scoping | GUARD - the set is asserted equal, so a new one fails until somebody decides about it |
| 5b | Test fixtures counted as writers. Nine test files insert `board_member` rows legitimately | GUARD - `.test.ts` excluded, and that exclusion is exactly where a real writer could hide, so the count of excluded files is not asserted - the *production* set is |
| 5c | The scanner matching nothing, so the assertion passes against an empty set forever | GUARD - a non-empty control, and a positive control naming the adapter that certainly does write |
| 5d | The scan missing a writer that spells the statement differently - `INSERT INTO Board_Member`, or a string built at runtime | PROPAGATE - case-insensitive matching, and the limit is stated: a query assembled from fragments is not visible to any text scan, which is why the port-level rule matters more than this test |

**Cross-check:** the three named files are exactly the three the grep finds, and each one's entry
says what it may do. A list that named a file which does not write, or omitted one that does, fails
in both directions rather than one.
### The AC audit

| AC | Test | Sensitivity |
| --- | --- | --- |
| 1 | `actions.test.ts::returns a password the new director can actually sign in with` | mutations 2d, 2c KILLED |
| 2 | `director-roster-postgres.test.ts::derives it from the inviting member in SQL`; **and see below** | mutation 1a KILLED |
| 3 | `actions.test.ts::stores a hash, never the password itself`, `::logs the failure without the secret`; **and see below** | mutations 2a, 2d KILLED |
| 4 | `director-roster-postgres.test.ts::does nothing on conflict`; `actions.test.ts::refuses an address already on a board` | mutations 1d, 2e KILLED |
| 5 | `actions.test.ts::refuses without a session`; `page.test.tsx`, all four | mutations 2b, 3a KILLED |
| 6 | `add-board-member.test.ts`, all ten | mutations 4a-4d KILLED |
| 7 | `board-member-writers.test.ts` | fails in both directions, proven |

#### What the audit found, on the twelfth consecutive story

**AC3 says the password "must not survive a page refresh". Nothing checked that.** It was true - by
accident of implementation. `useActionState` holds the value in memory and a refresh loses it, which
is the intended behaviour, and nothing stopped a later edit from "helpfully" stashing it in
`sessionStorage` so the treasurer would not lose their work on a stray reload.

That edit would be reasonable-looking and would put a credential somewhere it outlives the page, the
session, and the browser being closed. It is asserted structurally, because a render test can only
show what happened on one render and never that nothing anywhere persists. Mutating the component to
write `sessionStorage` now fails it.

**AC2 says "no association picker, no association id in the form". The port half was asserted; the
form half was not.** A field added there is inert today, because nothing reads it - and
inert-but-present is exactly how a picker gets wired up later by somebody who assumes it was meant to
work. Now asserted absent, and adding a hidden `associationId` input fails it.

**And the control-character guard caught me again** - the sixth time this session that `\\b` in a
Python string became a literal backspace while writing a regex. Story 5.6b's sweep failed the suite
on it, unaided, in a file two stories' worth of guards were not written for.

### The `ocr` round - 33 findings, 3 confirmed

A complete run: `terminal_state: complete`, 13 of 13 items, none failed or waived.

**The one that mattered was a hole this project had already found once, in the same directory.**
`board-member-writers.test.ts` matched `\b(insert\s+into|update|delete\s+from)\s+board_member\b`, which
`insert into public.board_member` walks straight past.

`core/security/no-association-creation.test.ts` carries the optional schema qualifier and says why:
the same bypass was found there on story 5.1b, by CodeRabbit, in both the CLI round and the MR round,
and verified against the old pattern before the fix was written. I wrote a new guard in the same
directory without it and reproduced the identical defect - which is what "reinventing a wheel that
already has a documented shape" looks like in practice.

The matcher now follows that precedent, with its own `describe('the matcher itself')` block: seven
statements it must see, three near-misses it must not - including `board_member_audit`, where the
trailing word boundary is what stops a guard flagging everything, which is as useless as flagging
nothing.

**A test that proved the throw but not the absence.** The ghost-inviter case asserted
`rejects.toThrow()`, which shows the call failed and not that it failed *before* writing. The whole
point of that refusal is that a director row with no association is invisible to every
association-scoped read afterwards. It now asserts no row exists - and if the not-null constraint
were ever relaxed, that assertion is what would notice rather than the throw disappearing quietly.

**Refuted, with reasons.**

- **The plaintext password in the DOM.** That is the hand-off this story deliberately chose, with its
  cost recorded: the password travels by whatever channel the inviting director picks. A
  copy-then-clear button is a real hardening and it is a different story. The finding also cites
  browser history, which does not apply - nothing puts it in a URL.
- **`auth()` lacking a try/catch on the page.** Every page in this project does the same;
  `app/upload/page.tsx` is the model this one follows. Changing it here alone would make this page
  inconsistent rather than safer.
- **The fragile variable-name regex.** Its own example is what the code already says, so it passes;
  the general point about text assertions is true and is the accepted trade while the database half
  skips.
- **No audit log for password resets in the script.** Fair, and out of scope: the script is run by a
  person holding the writer credential, and adding an audit trail for `board_member` is its own
  decision rather than a line in this story.

**Argus found none of the three.** Ingested at `cb09431` with recall 0 - the sixth consecutive
measurement of that kind here.

### The CodeRabbit CLI round - 10 findings, 4 majors, all confirmed

`review_completed`, 16 reviewedFiles reconciling exactly against the diff.

**The join worked first time.** `argus_ingest` compared rather than skipped, because `argus_review`
ran on this head *before* the CodeRabbit round started. That is the rule written into story 5.8 after
the ingest silently skipped on two consecutive stories - the first time it has been applied in
advance rather than repaired afterwards.

#### The four majors

**A text assertion standing in for a real test.** The argument-parsing check asserted that
`argv.slice(0, associationAt)` was gone - which can see that the *shape* changed and not whether
`--association X <email>` actually parses. The parsing moved into
`scripts/board-member-arguments.ts`, which needs no database and so can be imported and exercised;
eight cases now cover the flag before and after the positionals, a display name following the flag
and its value, and a flag given with nothing usable after it.

`verify-extraction.test.ts` reads its probe as text *because* that probe calls a live provider on
import. The same was true here - and extracting the pure part removes the constraint rather than
accepting it.

**A bare `rejects.toThrow()`** where the subject was specifically the not-null protection. Now
`23502`. Same finding as story 5.8 got, in the same shape, one story later.

**An error message no screen reader would announce.** The failure text was mounted *with* its
content, and a live region created that way is not announced - the node has to be watched before the
text arrives. Now always mounted and empty, `role="alert"`, and referenced from the address field.
This project has an accessibility floor that a form refusing submissions silently would not meet.

**A log assertion that searched for a word.** `not.toMatch(/password/i)` passes for a line carrying
the whole submission, or the secret under another name. It now asserts the exact permitted shape -
message, error, nothing else - so any extra argument fails whatever it contains.

#### And one fix's mutation survived

The live-region change passed every existing assertion after being reverted, because nothing checked
the region exists *before* there is an error - the only case that tells the two implementations
apart. That assertion exists now, and the mutation is killed.

**Argus found none of the nine.** Ingested at `375d016` with recall 0: the seventh consecutive
measurement of that kind on this project.

### The integration pass - the account nobody proved could sign in

**AC1 says the new account can sign in afterwards. Three tests each proved a third of that and
nothing joined them.**

`actions.test.ts` proved the shown password verifies against the hash handed to the roster.
`director-roster-postgres.test.ts` proved the row lands in the right association - in its database
half, which skips here. And `authenticate` has its own tests, which know nothing about either.

The join was a chain of reasoning: the roster lower-cases, `authenticate` lower-cases what it is
given, so they meet. That is true, and it is exactly the kind of true thing that stops being true
when one side changes - which is the shape story 5.8's integration pass found, one story ago.

`core/auth/provisioned-director-can-sign-in.test.ts` asserts it, and needs no database because
`authenticate` takes its directory as an argument: the test holds what the roster *would have*
stored and asks the real sign-in path about it. The fixture copies
`email.trim().toLowerCase()` from the adapter rather than importing it - sharing the folding would
make the drift this file exists to catch undetectable.

**It catches drift on either side**, which is what a join test has to do: removing the roster's
lower-casing fails it, and removing `authenticate`'s normalisation fails it. Its control - a wrong
password is rejected - is what stops it passing against an `authenticate` that accepts anything.

### Argus on the whole branch - one low, and the escape trap inverted

The assertion that `argv.slice(0, associationAt)` is gone read
`/argv\\.slice\\(0, associationAt\\)/`. In a regex literal `\\` matches a **literal backslash**,
and this source contains none - so the negative assertion was tautologically true and would have
passed with the old truncating slice still in place.

This is the same escape trap that produced literal backspaces six times in this session, pointing the
other way: there I under-escaped and got a control character, here I over-escaped and got a matcher
that matches nothing. Corrected, and reintroducing the old slice now fails the test - which it did
not before.

### Review Findings

### Completion Notes List

### File List

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-24 | Story created from the epic row, `scripts/add-board-member.mjs` and AD-3 |

## Questions for the author — answered 2026-08-24

**1. Revocation is out of scope.** `disabled_at` exists and sign-in honours it; nothing sets it, and
nothing will in this story. The epic's row is provisioning, and adding a second surface with its own
failure modes would make one coherent change into two half-tested ones. Recorded as the obvious
companion story rather than dropped.

**2. The password is shown once, on screen.** Confirmed rather than assumed, because the alternative
was a different story: a mailed invite needs an invite table, an expiry, a consumed-once rule and a
public route, and it changes Tasks 1 to 3 rather than adding to them.

What the chosen option costs, stated plainly: **the password travels by whatever channel the
inviting director picks** - Slack, SMS, spoken aloud. That is weaker than a link only the recipient's
mailbox can open. It is also exactly what `scripts/add-board-member.mjs` does today, so this story
moves the act into the product without changing that exposure. If the hand-off should be hardened,
that is a story about invites and it now has a written starting point.

**3. Adding yourself** is treated as a duplicate address, because that is what it is.
