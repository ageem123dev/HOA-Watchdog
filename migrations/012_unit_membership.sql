-- Who holds a unit, and when.
--
-- Migration 011 made the unit the durable identity. This one records the part
-- that changes. A unit that changes hands mid-year must still answer "who held
-- 4B in March", because that is the question an arrears finding has to answer --
-- so the holder is a dated relationship, not a `current_owner_id` column that
-- can only ever answer "who owns 4B now".

-- Required by the exclusion constraint below: `exclude using gist` cannot use
-- `=` on a `uuid` without it. It must be created by the **migration runner** --
-- `watchdog_writer` gets `42501 permission denied to create extension`, verified
-- against the live database. `if not exists` because 1.8 ships with the server
-- but is not installed by default, and a second run of this migration must not
-- fail.
create extension if not exists btree_gist;

-- A person who holds a unit. Deliberately not a `board_member`.
--
-- `board_member` is authentication: email, password hash, `disabled_at`. A unit
-- holder may never sign in -- most will not -- and modelling them there would
-- mean recording who owns 4B requires issuing them an account. The two tables
-- answer different questions and only one of them is about access.
create table unit_holder (
  id         uuid        primary key default uuidv7(),

  -- No unique constraint, and that is the decision rather than an omission.
  -- An association's second `John Smith` must be recordable; folding the two
  -- together would silently hand the first one the second one's unit, and
  -- nothing downstream would look wrong. Names are not identities.
  full_name  text        not null,

  created_at timestamptz not null default now(),

  -- Measured twice, for the reason migration 009 records and 006 got wrong:
  -- `char_length(btrim(...)) between 1 and 200` lets 'x' plus three hundred
  -- spaces through, because btrim removes the padding before anything counts it.
  --
  --   char_length(full_name) <= 200  -- how much is actually stored
  --   char_length(btrim(...))  >= 1  -- whether anybody is actually named
  constraint unit_holder_name_length check (
    char_length(full_name) <= 200
    and char_length(
      btrim(full_name, ' ' || chr(9) || chr(10) || chr(13) || chr(11) || chr(12) || chr(160) || chr(8239))
    ) >= 1
  )
);

create table unit_membership (
  id          uuid        primary key default uuidv7(),

  unit_id     uuid        not null references unit (id),
  holder_id   uuid        not null references unit_holder (id),

  -- One range rather than a pair of nullable dates. A pair makes "still holds
  -- it" and "we never recorded the end" the same value, and leaves overlap
  -- detection to whoever remembers to write it. A `daterange` makes the overlap
  -- a constraint the database enforces -- which is what AC3 asks for.
  --
  -- Half-open (`[)`), so a unit sold on 1 July is one membership ending and the
  -- next beginning on that day, with no overlap and no gap. Postgres
  -- canonicalises `daterange` to `[)` itself, since `date` is a discrete type:
  -- `[2024-01-01,2024-06-30]` is stored as `[2024-01-01,2024-07-01)`. So there
  -- is deliberately **no** `check (lower_inc and not upper_inc)` here -- it
  -- could never fail, and a check that passes whether or not the thing it guards
  -- against is possible is the shape this project keeps having to unlearn.
  --
  -- An unbounded upper bound means "still holds it" and is ordinary.
  held_during daterange   not null,

  created_at  timestamptz not null default now(),

  -- Every membership starts on a date somebody can name.
  --
  -- This rejects two malformed shapes, and it is the only check here because it
  -- is the only one that can ever be the reason for a rejection:
  --
  --   * an unbounded lower bound -- a membership that began at the beginning of
  --     time. The one shape Postgres will not canonicalise away.
  --   * an *empty* range. `[d,d)` covers no date, answers no query, and overlaps
  --     nothing, so the exclusion constraint below would not notice it either.
  --
  -- A second constraint, `not isempty(held_during)`, was written for that second
  -- case and then deleted. Every empty daterange has a **null lower bound** --
  -- verified for `[d,d)`, `(d,d+1)` and the `empty` literal -- so this check
  -- already catches all of them. Dropping the `isempty` constraint from the live
  -- database changed no behaviour and left all 351 tests passing: nothing could
  -- make it the sole cause of a rejection, and nothing could detect its removal.
  --
  -- It was found by review, not by the mutation testing for this story, which
  -- dropped both constraints together and so never told them apart. That is the
  -- lesson worth keeping: a mutation that removes two things at once cannot show
  -- that either one matters.
  constraint unit_membership_has_a_start check (lower(held_during) is not null),

  -- AC3, in one line, enforced by the database rather than by application code.
  --
  -- Scoped by `unit_id with =`: two *different* units held over the same dates
  -- is every association with more than one unit. An exclusion on `held_during`
  -- alone passes every overlap test that matters and breaks the product, which
  -- is why the test for it asserts both operators and there is a beside-case
  -- inserting an overlap across two units.
  constraint unit_membership_no_overlap
    exclude using gist (unit_id with =, held_during with &&)
);

-- `holder_id` is deliberately not indexed. Raised by review and skipped rather
-- than overlooked.
--
-- `unit_id` is already covered: the exclusion constraint builds a gist index on
-- `(unit_id, held_during)`, which is what both of story 2.1's questions filter
-- by -- who held a unit on a date, and the history of a unit. Nothing in this
-- epic queries by holder, and no story before 2.4 writes these tables from the
-- application, so there is no `delete from unit_holder` path whose referential
-- check would scan. An index no query uses is schema nobody tested.
--
-- Add it when either arrives: a query answering "which units does this person
-- hold", or a delete path for `unit_holder`.

-- Migration 003 revoked the reader's blanket select, so read access is an
-- explicit decision per table. SELECT only -- AD-4 keeps the LLM-driven query
-- path unable to invent a holder or a membership, and a membership that exists
-- because a model asked for it would attribute somebody else's dues.
grant select on unit_holder to watchdog_reader;
grant select on unit_membership to watchdog_reader;

comment on table unit_holder is
  'A person who holds a unit. Not a board_member: that table is authentication, and a unit holder may never sign in. Names are deliberately not unique -- the second John Smith must be recordable.';
comment on table unit_membership is
  'Who held a unit, and over what dates. Half-open daterange so a sale on 1 July is one membership ending and the next beginning that day. Overlaps for one unit are rejected by the database (23P01), not by application code.';
comment on column unit_membership.held_during is
  'Half-open [) date range; an unbounded upper bound means the holder still holds it. Postgres canonicalises the bounds, so no check asserts them.';
