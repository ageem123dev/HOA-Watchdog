-- What a unit owes for a year, and on what cadence it is paid.
--
-- Migration 011 made the unit the durable identity and 012 recorded who held it
-- when. This is the other half of an arrears finding: without the expected
-- amount there is nothing for a payment to be compared against.
--
-- Amount and cycle are different things, and the domain note in epics.md is
-- explicit about it: the amount is set annually per unit, and the cycle on which
-- that annual amount is settled varies by member. A monthly payer and an annual
-- payer owe the same figure for the year.

create table assessment (
  id              uuid          primary key default uuidv7(),

  unit_id         uuid          not null references unit (id),

  -- The year the assessment is for, not the year it was entered.
  assessment_year integer       not null,

  -- The ANNUAL figure. Never the instalment.
  --
  -- This is the one modelling error this table invites: recording 500 for a
  -- monthly payer instead of 6000. No check constraint can tell those apart --
  -- both are positive amounts -- so what guards it is this column's name, this
  -- comment, and a test asserting that two units owing the same for the year
  -- store the same amount whatever their cycles. Story 2.3 divides this figure
  -- into instalments; if it were stored already divided, 2.3 would divide it
  -- twice and every expected instalment would be wrong by a factor of twelve.
  --
  -- `numeric(14,2)`, matching `extraction.total_amount` exactly.
  --
  -- The architecture's Consistency Conventions said "integer minor units (cents)
  -- end to end" until 2026-08-07, and epic 1 had shipped the other way. Both
  -- avoid floats; they are different representations. Story 2.4 compares an
  -- extracted payment against this column, and two representations would put a
  -- rounding conversion inside the comparison that produces arrears findings.
  -- The shipped convention won and the architecture row was amended to match.
  -- A decimal string crosses every boundary -- never a float, never a JS number.
  --
  -- Note what the type does rather than what one might hope: an amount with more
  -- decimals than the scale is **rounded**, not rejected. 1234.567 is stored as
  -- 1234.57. `extraction.total_amount` behaves identically. Pinned by a test so
  -- a caller finds it there rather than in production.
  annual_amount   numeric(14,2) not null,

  -- A closed vocabulary the database enforces, in the same style as
  -- `document_extraction_state` and `extraction.document_kind`. A check
  -- constraint rather than a Postgres enum: nothing in this schema uses one, and
  -- adding a cycle to an enum is a migration where this is a one-line change.
  --
  -- The application states the same three values, and a test reads this file to
  -- prove the two agree -- for the reason migration 007 records: a second
  -- statement of a shape is only safe when something fails on disagreement.
  --
  -- Lower-case, and the constraint enforces it. `Monthly` would otherwise be a
  -- row that every comparison in story 2.3 silently misses.
  billing_cycle   text          not null,

  created_at      timestamptz   not null default now(),

  -- A unit that owes nothing has no assessment, rather than one of zero: the
  -- absence is the statement. And a negative annual due is not a thing.
  constraint assessment_amount_positive check (annual_amount > 0),

  constraint assessment_cycle_known check (
    billing_cycle in ('monthly', 'six_monthly', 'annual')
  ),

  -- A typo'd 20024, or a pasted cell, should fail here rather than become a row
  -- nobody can find. The bounds are deliberately loose -- this is a sanity
  -- check, not a business rule about which years an association may bill.
  constraint assessment_year_plausible check (assessment_year between 1900 and 2200),

  -- One answer to "what does 4B owe for 2024". Two rows would be two answers,
  -- and neither would look wrong from either side.
  --
  -- On the pair, not on either column alone: `unit_id` alone would allow one
  -- assessment per unit for all time, and `assessment_year` alone would allow
  -- exactly one unit in the entire association.
  constraint assessment_one_per_unit_year unique (unit_id, assessment_year)
);

-- Migration 003 revoked the reader's blanket select, so read access is an
-- explicit decision per table. SELECT only -- AD-4 keeps the LLM-driven query
-- path unable to invent an assessment, and an assessment that exists because a
-- model asked for it would carry dues nobody owes.
grant select on assessment to watchdog_reader;

comment on table assessment is
  'What a unit owes for a year and the cadence it is settled on. One row per unit per year.';
comment on column assessment.annual_amount is
  'The ANNUAL figure, never the instalment. numeric(14,2) matching extraction.total_amount; crosses every boundary as a decimal string. An amount with more decimals than the scale is rounded, not rejected.';
comment on column assessment.billing_cycle is
  'monthly, six_monthly or annual. The cycle changes when the annual amount falls due, never how much is owed for the year.';
