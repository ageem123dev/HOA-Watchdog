---
Status: ready-for-dev
baseline_commit: 15440292da4bc7c3bdb97e872537f69eb7be85a7
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
      the reader-role regression (AC7), and the no-product-path-creates-an-association guard (AC9).
- [ ] **Task 7 — Update the architecture's multi-tenancy deferral.** `vendor` is scoped by this
      story, so "per-tenant vendor tables" is no longer deferred; row-level security alone is. The
      entry currently says otherwise and would mislead the next reader. (Decision 1)

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

## Decisions, taken 2026-08-19

**1. `vendor` is association-scoped.** It gets an `association_id` like any other table holding
association data. Isolation wins over the letter of a deferral written before this story existed:
`vendor` is the anchor for epic 4's detection, so leaving it global would let two associations share
a vendor identity and a finding computed across both — which would make AC8's isolation claim
narrower than it reads.

**This makes the architecture's deferral entry stale, and Task 7 updates it.** It currently lists
"per-tenant vendor tables" as still deferred. After this story, what remains deferred is row-level
security alone.

**2. The pilot association is named `demo`, with a fixed well-known UUID.** A constant id rather than
a generated one, so the backfill is idempotent by construction — re-running the migration cannot
create a second row or re-point existing rows — and so seeds and fixtures can refer to it without a
lookup. The constant lives in one place and is imported, never retyped.

## Dev Agent Record

### Agent Model Used

### Test Design

#### Task 1 decision — every one of the fourteen carries its own `association_id`

Not "reaches one through its parent". Two reasons, and the second is the load-bearing one:

- **AD-5 requires every catalog entry to filter by association.** If a table reaches its association
  only by joining upward, every query touching it must carry that join, and a query that omits it is
  exactly the defect the registry test exists to catch — but a test can only check for a predicate it
  can see. A direct column makes the predicate uniform and checkable.
- **Denormalisation is safe here because the failure is made unrepresentable, not guarded.**
  A child row belonging to a different association than its parent is prevented by a **composite
  foreign key** — `extraction (document_id, association_id)` references `document (id,
  association_id)`, which needs `unique (id, association_id)` on the parent. The database refuses the
  inconsistent row; no runtime check, no review vigilance. That is hardening preference 1 from Step 8,
  applied at design time rather than after.

No table is judged to hold none. `vendor` is scoped per the 2026-08-19 decision.

#### Behaviours and failure modes

**B1 — the `association` table and its one row.**
1. Re-running inserts a second pilot row — **GUARD**: fixed UUID primary key plus `on conflict do
   nothing`, so replay is a no-op rather than a duplicate.
2. A blank or whitespace-only name — **GUARD**: check constraint on trimmed length.
3. The row is absent when the backfill runs, so every `association_id` lands `null` and the `not
   null` step fails the whole migration — **GUARD**: insert precedes backfill in one transaction.

**B2 — `association_id` on each table.**
1. Column added but the `not null` never applied, leaving it optional forever — **GUARD**: asserted
   per table.
2. No foreign key, so an orphaned association id is storable — **GUARD**: asserted per table.
3. **A table is missed entirely, now or in a later migration** — **GUARD**: a drift test enumerating
   the live schema and asserting every table outside a named allowlist carries the column. This is
   the one that keeps the story true after it ships; migration 025 adding an unscoped table is the
   realistic future defect.

**B3 — the backfill.**
1. Rows written between the column being added and the backfill running get `null` — **GUARD**: the
   whole migration is one transaction (`migrate.mjs` already wraps each file in one).
2. Replay re-points rows already assigned to a *different* association — **GUARD**: backfill is
   `where association_id is null`, never unconditional.
3. A table is backfilled but a sibling is not — **PROPAGATE**: the `not null` step fails loudly at
   migration time rather than leaving a half-scoped schema.

**B4 — cross-association children.**
1. A child references a parent in another association — **GUARD (unrepresentable)**: composite FK.
2. The composite FK cannot be declared without `unique (id, association_id)` on the parent —
   **GUARD**: added alongside.
3. Existing rows violate it at migration time — **PROPAGATE**: fails loudly; the backfill puts
   everything in one association, so this can only fire if the data is already inconsistent, which is
   worth stopping for.

**OUT-OF-SCOPE**, recorded rather than silently skipped: row-level security (AD-4's amendment names
the trigger, and AC9's guard is what forces the conversation), and cleaning up the `test_<hex>` rows
`test:db` has written into the pilot database.

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-19 | Story created |
