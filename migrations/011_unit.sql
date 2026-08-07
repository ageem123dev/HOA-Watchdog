-- A unit of the association: the durable thing dues attach to.
--
-- Epic 2's foundation. Dues are owed per unit, not per person, and the person
-- tied to a unit changes -- so the unit is the identity that survives, and
-- migration 012 models the holder as a dated relationship rather than a column
-- here. A `current_owner_id` on this table would answer "who owns 4B" and could
-- never answer "who owned 4B in March", which is the question an arrears finding
-- has to answer.

-- Its own normalisation, deliberately not `vendor_normalised_name`.
--
-- The two functions are identical today, and sharing one would be the obvious
-- economy. It is the wrong one: a unit number and a vendor name are different
-- kinds of thing, and a later change to how vendor names are matched -- to make
-- "Acme Inc" and "Acme, Inc." one vendor, say -- would silently change which
-- units are considered the same unit. Nobody making that change would look here.
--
-- Case-folded, ends trimmed, internal runs of whitespace collapsed to one space.
-- `chr()` rather than an escape sequence, for the reason migration 009 records:
-- E'\s+' in a stored generated column is a portability trap.
--
-- Leading zeroes are deliberately NOT folded. `04B` and `4B` stay two units,
-- because zero-padding is a real convention in some associations and deciding it
-- means nothing is a data decision rather than a schema one. If a roll arrives
-- padded, that belongs to whoever loads it.
-- `search_path` pinned, which matters more here than in an ordinary function.
--
-- The body calls `lower`, `regexp_replace`, `btrim` and `chr` unqualified. A
-- role able to create a schema earlier in the caller's `search_path` could
-- shadow any of them, and this function decides *unit identity*: it backs a
-- stored generated column and the unique index built on it. A shadowed `lower`
-- would silently change which unit numbers are considered the same unit, and
-- the rows already written would not agree with the rows written afterwards.
-- Raised by review.
--
-- `pg_temp` last is deliberate: it is searched before anything else unless it is
-- named explicitly, so leaving it out would not remove it from the path.
create or replace function unit_normalised_number(raw text)
  returns text
  language sql
  immutable
  strict
  parallel safe
  set search_path = pg_catalog, pg_temp
as $$
  select lower(
           regexp_replace(
             btrim(raw, ' ' || chr(9) || chr(10) || chr(13) || chr(11) || chr(12) || chr(160) || chr(8239)),
             '[' || ' ' || chr(9) || chr(10) || chr(13) || chr(11) || chr(12) || chr(160) || chr(8239) || ']+',
             ' ',
             'g'
           )
         )
$$;

create table unit (
  id                uuid        primary key default uuidv7(),

  -- What a treasurer types off the roll, in the spelling they typed it. Shown
  -- back to them unchanged; the folded form below is a comparison key and is no
  -- use to a human.
  unit_number       text        not null,

  normalised_number text        generated always as (unit_normalised_number(unit_number)) stored,

  created_at        timestamptz not null default now(),

  -- Two measurements answering two questions, the shape migration 009 reached
  -- after getting it wrong twice. `char_length(btrim(...)) between 1 and 64` is
  -- the version that fails: it lets 'x' plus three hundred spaces through,
  -- because btrim removes the padding before anything counts it.
  --
  --   char_length(unit_number) <= 64  -- how much is actually stored
  --   char_length(btrim(...))  >= 1   -- whether anything is actually there
  --
  -- 64 because a unit number is a label like `4B` or `Building C, Unit 12`, not
  -- an address. A pasted spreadsheet cell should fail here rather than become a
  -- unit nobody can find.
  constraint unit_number_length check (
    char_length(unit_number) <= 64
    and char_length(
      btrim(unit_number, ' ' || chr(9) || chr(10) || chr(13) || chr(11) || chr(12) || chr(160) || chr(8239))
    ) >= 1
  )
);

-- On the *normalised* number, so `4B` and `4b  ` collide rather than becoming
-- two properties. Two rows for one unit would split every dues figure between
-- them and neither would look wrong from either side.
create unique index unit_normalised_number_key on unit (normalised_number);

-- Migration 003 revoked the reader's blanket select, so read access is an
-- explicit decision per table.
--
-- Granted: epic 3's catalog answers questions about units, and the read path is
-- how it gets there. SELECT only -- AD-4 keeps the LLM-driven query path unable
-- to invent a unit, and a unit that exists because a model asked for it would
-- carry dues nobody owes.
grant select on unit to watchdog_reader;

comment on table unit is
  'A unit of the association: the durable identity dues attach to. Who holds it is a dated relationship in migration 012, not a column here, because the holder changes and an arrears finding must name whoever held it at the time.';
comment on column unit.unit_number is
  'As the treasurer typed it off the roll. Shown back unchanged.';
comment on column unit.normalised_number is
  'Case-folded and whitespace-collapsed by unit_normalised_number(). A comparison key, not for display. Deliberately separate from vendor_normalised_name() so vendor matching cannot silently redefine unit identity.';
