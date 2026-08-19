---
Status: ready-for-dev
baseline_commit:
merge_request:
---

# Story 5.1: The association exists

## Story

As the **system**,
I want **every row that belongs to an association to say so**,
so that **a second association is representable without a schema change, and the catalog can scope a
question to one board's records instead of all of them**.

This is the expensive, invisible half of Epic 5. It ships no screen. It is sequenced first and alone
so the seven wizard stories are built on a settled shape rather than around a moving one — the
alternative is threading a tenancy retrofit through stories that have already been reviewed.

## Acceptance Criteria

1. **An association is a row.** An `association` table exists; one row is one HOA, with a stable id
   and a human-readable name. Nothing else in the product invents its own notion of "which HOA".

2. **Every table that holds association data carries `association_id`**, `not null`, with a foreign
   key to `association`. A table that holds none does not get the column, and the migration says in
   prose which tables were judged to hold none and why.

3. **Existing rows are backfilled to exactly one association**, and the migration is safe to re-run.
   The pilot's data is not lost, orphaned, or split.

4. **A board member belongs to an association**, and an authenticated session yields it. Sign-in
   behaviour is otherwise unchanged.

5. **The gateway binds the association from the authenticated session, and it is never a tool
   parameter.** A `/tools/v1/*` request that supplies an association id does not get to choose with
   it — the supplied value is refused or ignored, and a test proves which. *(AD-5 amendment,
   clause 2 — the load-bearing half: an injection that cannot author SQL but can choose whose
   records to read has defeated AD-5 while obeying its letter.)*

6. **Every catalog entry filters by association, enforced by a test over the registry** rather than
   judged at review. A new entry whose SQL does not scope by association turns the suite red.
   *(AD-5 amendment, clause 1. `strict: true` guarantees the arguments are well-formed, not that the
   query is bounded — parameter validation cannot save an entry that never scoped.)*

7. **`watchdog_reader` is still SELECT-only.** AD-4's capability claim is unchanged by this story;
   `migrations/roles.test.ts` still passes, and the reader gains no grant.

8. **A second association is representable, and rows do not leak across.** A test inserts a second
   association with its own rows and shows a catalog query scoped to association A returns none of
   association B's — **without a schema change**. This is the story's real proof.

9. **Nothing in the product creates a second association.** AC8 proves the *shape*; it does not
   enable multi-tenancy. Row-level security does not exist, so scoping is by construction — two
   pieces of code that must both be right — and AD-4's amendment says onboarding a second
   association without RLS is a defect, not a trade-off. Concretely, and testably: **no product code
   path inserts into `association`.** The pilot row arrives by migration; the second association in
   AC8's test is inserted by the test itself. A structural test asserts no `insert into association`
   outside `migrations/` and test files — the shape `core/security/no-model-in-alerts.test.ts`
   already uses. When a create-association flow is eventually wanted, that test is what forces the
   RLS conversation rather than letting it be skipped.

## Tasks / Subtasks

- [ ] **Task 1 — Decide and record which tables hold association data.** Fourteen exist:
      `board_member`, `document`, `extraction`, `vendor`, `quarantine_item`, `unit`, `unit_holder`,
      `unit_membership`, `assessment`, `payment`, `held_payment`, `query_log`, `finding`,
      `finding_alert`. For each, decide *carries its own `association_id`* or *reaches one through
      its parent* — and write the reasoning into the migration, since a reader a year from now
      cannot reconstruct it. (AC2)
- [ ] **Task 2 — The migration.** `association` table; `association_id` added per Task 1; backfill to
      a single row; constraints last so the backfill can precede `not null`. Re-runnable. (AC1–3)
- [ ] **Task 3 — Board member to association, and the session.** `board_member.association_id`, and
      `authenticate` yields it. (AC4)
- [ ] **Task 4 — The gateway binds it.** `/tools/v1/*` resolves the association from the session, not
      from the request body. Prove a supplied id cannot choose. (AC5)
- [ ] **Task 5 — Catalog scoping and its registry test.** `duesStatusV1` (the only entry today)
      filters by association; the registry test asserts it for *every* entry, present and future, in
      the shape `registry.test.ts` already applies to entry ids. (AC6)
- [ ] **Task 6 — Prove the shape, and prove the refusal.** The two-association isolation test (AC8),
      the reader-role regression (AC7), and the refusal of a second association (AC9).

## Dev Notes

### What this story is not

It is **not** multi-tenancy. It makes a second association *representable* and proves rows do not
leak through the catalog. It does not make onboarding one safe: there is no row-level security, so a
correct catalog filter and a correct gateway binding are two pieces of code that must both be right,
and nothing makes a mistake in either unexploitable. AD-4's amendment names the day a second
association is onboarded as the trigger for RLS. AC9 exists so that day cannot arrive by accident.

### The two AD amendments this story rests on

Both landed on `main` in MR !68 and are the spec for AC5 and AC6:

- **AD-4 (amended):** the reader stays SELECT-only. SELECT-only is a **capability** control, not an
  **isolation** one — a reader that may read every row may read every association's rows. Isolation
  is AD-5's, enforced in the catalog rather than the grant.
- **AD-5 (amended):** every catalog entry filters by association, caught by a test over the registry;
  and the association is bound by the gateway from the authenticated session, never a tool parameter
  the agent supplies.

### Order matters in the migration

`association_id` cannot be `not null` before the backfill runs. Add the column nullable, backfill,
then add the constraint — in one migration, so no intermediate state is committable.

### Production data is real, and some of it is test data

The pilot database holds live records, so the backfill is not hypothetical. It also holds
**~2,041 rows written by `npm run test:db`** — entries named `test_<hex>` — because that suite runs
against the production database. They will be backfilled into the pilot association along with
everything else. That is acceptable for this story and worth knowing before the migration runs; it is
not this story's job to clean them up.

### Project Structure Notes

- Migrations are numbered and prose-commented — see `migrations/023_finding_alert.sql` for the house
  style: the comment explains *why the table exists*, not what the DDL says.
- `catalog/registry.ts` holds `ALL_ENTRIES` (today: `duesStatusV1` alone). `catalog/registry.test.ts`
  is where the per-entry structural assertion belongs.
- `core/auth/authenticate.ts` is the session boundary; `adapters/auth/auth.ts` its adapter.
- `core/` imports nothing outward (`core/ports/boundary.test.ts`) — the association type belongs in
  `core/`, not in an adapter.

### Testing Requirements

- Vitest for unit; `npm run test:db` for anything touching schema, adapters or `app/tools/` — this
  story touches all three, so **`test:db` is not optional here**.
- AC8 and AC5 are the two that must not be vacuous. For AC8, breaking the catalog's association
  filter must fail the test; for AC5, removing the gateway binding must fail it. Prove both by the
  Step 9 sensitivity check rather than asserting them.
- AC7 is a regression: `migrations/roles.test.ts` already exists and must still pass unchanged.

### References

- `_bmad-output/planning-artifacts/epics.md` — Epic 5, "Three decisions", story spine row 5.1
- `.../architecture-.../ARCHITECTURE-SPINE.md` — AD-4 and AD-5 with their 2026-08-18 amendments; the
  multi-tenancy deferral entry, now partly resolved
- `docs/prd/prd.md` — FR-9, FR-10 (this story enables them; it implements neither)

## Open questions — answer before Task 1

Both are decisions, not research. Task 1 cannot be completed honestly without them.

**1. Does `vendor` get an `association_id`?** The architecture's deferral entry, as amended, still
lists **per-tenant vendor tables** as deferred — which reads as "vendor stays global for now". But
`vendor` is the anchor for detection (a vendor who charged more than usual, epic 4), so a global
vendor table means two associations sharing a vendor identity and, potentially, a finding computed
across both. The options:

- **Scope it** — `association_id` on `vendor`, contradicting the letter of a deferral that was
  written before this story existed. Safest for isolation; makes the deferral entry stale.
- **Leave it global** — honours the deferral, and makes AC8's isolation claim narrower than it
  sounds: rows would not leak, but a vendor identity would be shared.

Whichever is chosen, the deferral entry in the spine should be updated to say so, since it currently
implies the answer without this story having been considered.

**2. What is the pilot association called, and what is its id?** The backfill needs a name a
treasurer would recognise, and a decision on whether the id is a fixed well-known UUID (simpler for
seeds and fixtures, and makes the migration re-runnable by construction) or generated.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-19 | Story created |
