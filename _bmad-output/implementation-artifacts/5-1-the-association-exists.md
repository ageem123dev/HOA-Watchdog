---
Status: review
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

4. **A board member belongs to an association** — the column and its foreign key. *Reading it from
   an authenticated session is story 5.1b; this story only makes it representable.*

5. **`watchdog_reader` is still SELECT-only.** AD-4's capability claim is unchanged by this story;
   `migrations/roles.test.ts` still passes, and the reader gains no grant.

6. **A child cannot belong to a different association than its parent, and the database refuses to
   store one.** Every foreign key between two scoped tables has a composite partner carrying
   `association_id` on both sides. This is the story's real proof: denormalising the column onto
   fourteen tables is only safe because the inconsistent row is unrepresentable rather than merely
   unwritten.

7. **A second association is representable without a schema change, for data that does not collide
   on an existing identity key.** A test inserts one and gives it rows.

   **Known limitation, found by review and deliberately not fixed here.** `unit` and `vendor` still
   carry *global* unique indexes — `unit (normalised_number)` and `vendor (normalised_name)` — from
   migrations 011 and 009. So a second association cannot hold a unit "4B" or a vendor "Evergreen"
   while the first does: `roll-repository`'s `on conflict (normalised_number) do update` would
   resolve to the **first** association's row, and the composite key would then refuse the membership
   that followed. Making those keys composite changes what "the same unit" means and requires
   dropping an index, which this migration's strictly-additive property forbids. It is story 5.1b's,
   listed there as a task, and it must land before a second association is onboarded — alongside RLS.

   *That a second association's rows cannot be read through the catalog is also 5.1b, which is where
   the scoping predicate lives.*

8. **Every write states its association, and derives it rather than being handed it.** No column
   default: a default would make the invariant true by accident and would never be removed. Each
   insert reads the association from the row it belongs under — a document from its uploader, an
   extraction from its document, a finding from the run that surfaced it — so a caller cannot supply
   the wrong one.

### Split out to story 5.1b, 2026-08-19

The gateway binding (AD-5 clause 2), catalog scoping and its registry test (AD-5 clause 1), the
end-to-end isolation proof, and the guard that no product path creates an association. They are a
coherent piece of work about the *read* path, and this story is already a large schema retrofit;
carrying them would mean holding fourteen tables of migration unmerged while a different subsystem
is built. **Until 5.1b lands, `association_id` is stored and constrained but nothing reads it** —
the catalog still answers across the whole table, which is correct while exactly one association
exists and is why 5.1b must precede a second.

## Tasks / Subtasks

- [x] **Task 1 — Decide and record which tables hold association data.** All fourteen carry their
      own `association_id`; none was judged to reach one through a parent. The reasoning is in the
      migration's prose and in Test Design below. (AC2)
- [x] **Task 2 — The migration.** `association`, the `demo` row at a fixed id, the column added and
      backfilled per table, `not null` last, and composite foreign keys. Additive throughout: no
      `drop table`, `drop column` or `drop constraint`, asserted by test. (AC1–3, AC6)
- [x] **Task 3 — Every writer derives its association.** Eleven inserts across ten adapters, plus
      228 test fixtures. (AC8)
- [x] **Task 4 — Prove the shape.** The composite-key refusal, the second-association case, the
      drift guard over the live schema, and the reader-role regression. (AC5–7)
- [x] **Task 5 — Update the architecture's multi-tenancy deferral.** `vendor` is scoped by this
      story, so per-tenant vendor tables are no longer deferred; row-level security alone is.
      (Decision 1)

## Dev Notes

### What this story is not

It is **not** multi-tenancy, and it does not even read the column it adds. It makes a second
association *representable* and proves a child cannot sit under a parent in another one. Whether a
question can be answered for one association without returning another's rows is story 5.1b, where
the predicate lives. Nor does it make onboarding safe: there is no row-level security, so scoping
will be by construction — a correct catalog filter and a correct gateway binding, two pieces of code
that must both be right. AD-4's amendment names the day a second association is onboarded as the
trigger for RLS, and 5.1b carries the guard that stops that day arriving by accident.

### The two AD amendments this story rests on

Both landed on `main` in MR !68. AD-4 is this story's AC5; AD-5's two clauses are story 5.1b's,
since both are about the read path:

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
- **AC6 is the one that must not be vacuous.** Dropping a composite foreign key must fail the
  cross-association test, and the foreign-key coverage assertion must fail if a scoped key loses its
  composite partner. Prove both by the Step 9 sensitivity check rather than asserting them. The
  coverage check has already been vacuous once: read from `information_schema`, which shows only
  constraints the connecting role owns, it returned zero rows and passed over an empty set.
- AC5 is a regression: `migrations/roles.test.ts` already exists and must still pass unchanged.

### References

- `_bmad-output/planning-artifacts/epics.md` — Epic 5, "Three decisions", story spine row 5.1
- `.../architecture-.../ARCHITECTURE-SPINE.md` — AD-4 and AD-5 with their 2026-08-18 amendments; the
  multi-tenancy deferral entry, now partly resolved
- `docs/prd/prd.md` — FR-9, FR-10 (this story enables them; it implements neither)

## Decisions, taken 2026-08-19

**1. `vendor` is association-scoped.** It gets an `association_id` like any other table holding
association data. Isolation wins over the letter of a deferral written before this story existed:
`vendor` is the anchor for epic 4's detection, so leaving it global would let two associations share
a vendor identity and a finding computed across both — which would make story 5.1b's isolation
claim narrower than it reads.

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
the trigger, and story 5.1b's creation guard is what forces the conversation), and cleaning up the `test_<hex>` rows
`test:db` has written into the pilot database.

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-19 | Story created |
