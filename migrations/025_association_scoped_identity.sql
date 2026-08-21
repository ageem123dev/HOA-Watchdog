-- Unit numbers and vendor names are unique *within an association*, not globally.
--
-- Story 5.1b, task 5. Found by Argus reviewing story 5.1, and deferred there
-- because 5.1's migration is strictly additive — asserted by a test — and this
-- one is not: it drops two indexes.
--
-- ## What was wrong
--
-- Migration 011 made `unit (normalised_number)` unique across the whole table,
-- and migration 009 did the same for `vendor (normalised_name)`. Both were right
-- when one association was the only thing that could exist. With a second, they
-- say something nobody means: that no two associations may each have a unit "4B",
-- or each pay a vendor called "ACME Plumbing".
--
-- The quieter half is worse than the refusal. `roll-repository-postgres.ts`
-- upserts with `on conflict (normalised_number) do update`, so importing the
-- second association's roll would not fail — it would **resolve onto the first
-- association's unit row** and rename it. A composite foreign key cannot catch
-- that, because no row ends up in the wrong association; there is simply one row
-- where there should have been two, and every dues figure for both boards is
-- computed against it.
--
-- ## Why this is a drop and not an addition
--
-- A unique index *is* the constraint. Adding the composite one beside the global
-- one leaves the global one still refusing the second association's "4B", so the
-- narrower index would never be reached. The old index has to go.
--
-- The replacement is created before the original is dropped, so there is no
-- window in which nothing enforces uniqueness.
--
-- ## What this deliberately does not do
--
-- It does not scope every *read* keyed on these columns. `vendor-resolution`
-- and `roll-repository` were scoped when their upserts were — their paired
-- lookups had to agree with the conflict target — but `unit-directory` and
-- `vendor-directory` still match on the normalised value alone. With one
-- association those return exactly what they did before. With two they become
-- ambiguous, which is why story 5.1b also forbids any product path from
-- creating an association: the guard is what stops a second one arriving before
-- that work is done.
--
-- ## This runs inside a transaction, and that is a trade-off rather than a win
--
-- `scripts/migrate.mjs` wraps every migration in `begin`/`commit`, so there is
-- no `begin` here — one would merely nest inside the runner's and read as if
-- this file controlled its own. The consequence is that
-- `create index concurrently` **cannot** be used: it is forbidden inside a
-- transaction block. So the builds below take a lock that blocks writes to
-- `unit` and `vendor` while they run.
--
-- Accepted deliberately. Both tables are small here and the build is
-- milliseconds; the alternative is teaching the runner to execute a migration
-- outside a transaction, which then has to handle a failed concurrent build
-- leaving an `INVALID` index behind that no rollback removes. That is a change
-- to the runner, not to this migration, and it is recorded as an action item.
-- **Revisit before either table is large**, which for `unit` means a real roll
-- rather than a pilot's. Raised by CodeRabbit on MR !71.

-- `unit`: one "4B" per association.
create unique index if not exists unit_association_normalised_number_key
  on unit (association_id, normalised_number);

drop index if exists unit_normalised_number_key;

-- `vendor`: one "ACME Plumbing" per association.
create unique index if not exists vendor_association_normalised_name_key
  on vendor (association_id, normalised_name);

drop index if exists vendor_normalised_name_key;

