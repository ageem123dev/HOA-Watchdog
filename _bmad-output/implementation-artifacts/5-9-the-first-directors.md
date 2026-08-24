---
Status: ready-for-dev
baseline_commit:
merge_request:
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

- [ ] **Task 1 — A port for adding a director, and its adapter.** Association derived from the
      inviting member in SQL. Refuses a duplicate address rather than resetting it. (AC1, AC2, AC4)
- [ ] **Task 2 — The server action.** Session required, password generated server-side, shown once.
      (AC1, AC3, AC5)
- [ ] **Task 3 — The page.** A form, and the one-time password displayed where the inviting director
      can copy it. (AC1, AC3)
- [ ] **Task 4 — Constrain the script and correct its header.** (AC6)
- [ ] **Task 5 — Close the set of `board_member` writers.** (AC7)

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
