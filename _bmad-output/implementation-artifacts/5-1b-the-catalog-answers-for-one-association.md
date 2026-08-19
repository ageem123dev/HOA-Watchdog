---
Status: backlog
baseline_commit:
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

- [ ] **Task 1 — The session carries the association.** `core/auth/authenticate.ts` and its adapter.
      (AC1)
- [ ] **Task 2 — The gateway binds it.** `/tools/v1/*` resolves the association from the session,
      not the request body; prove a supplied id cannot choose. (AC2)
- [ ] **Task 3 — Catalog scoping and its registry test.** `duesStatusV1` is the only entry today;
      the test must bind *every* entry, present and future, in the shape `registry.test.ts` already
      applies to entry ids. (AC3)
- [ ] **Task 4 — The isolation proof, and the creation guard.** (AC4, AC5)
- [ ] **Task 5 — Make the identity keys association-scoped.** `unit (normalised_number)` and
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

### References

- `.../ARCHITECTURE-SPINE.md` — AD-4 and AD-5 with their 2026-08-18 amendments; the multi-tenancy
  deferral, updated by 5.1 so that row-level security alone remains
- `_bmad-output/implementation-artifacts/5-1-the-association-exists.md` — the schema this builds on
- `catalog/registry.ts`, `catalog/registry.test.ts`

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-19 | Split from story 5.1 |
