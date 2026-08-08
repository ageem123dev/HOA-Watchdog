-- What actually arrived, against the unit it settles.
--
-- The other side of every arrears finding epic 4 will make: migration 013 says
-- what a unit owes for a year, 2.3's schedule says when it falls due, and this
-- says what was paid.
--
-- A payment is derived from a deposit document, so it is subject to AD-13:
-- re-ingesting the document replaces its payments rather than appending to them.
-- The replacement is set-shaped, exactly as `extraction` describes for itself.

create table payment (
  id          uuid          primary key default uuidv7(),

  -- The unit this settles, already resolved.
  --
  -- `extraction.unit_reference` keeps the reference as the document spelled it;
  -- this keeps the answer. A line whose reference does not fold to a known unit
  -- never reaches this table -- it is held for a human in `held_payment`, and no
  -- unit is invented for it.
  unit_id     uuid          not null references unit (id),

  -- Cascade, matching `extraction`. A payment without its document is debris
  -- that still satisfies a foreign key, and the document is what a treasurer
  -- would be shown as evidence.
  document_id uuid          not null references document (id) on delete cascade,

  -- The date on the deposit, not the date it was ingested. Lateness is measured
  -- against when the money arrived.
  paid_on     date          not null,

  -- `numeric(14,2)`, matching `extraction.total_amount` and
  -- `assessment.annual_amount` exactly.
  --
  -- This is the column epic 4 compares against an assessment. The money decision
  -- story 2.2 recorded -- exact decimal end to end, a decimal string across every
  -- boundary -- exists precisely so that comparison is a comparison and not a
  -- conversion with a rounding rule buried in it.
  amount      numeric(14,2) not null,

  created_at  timestamptz   not null default now(),

  -- A deposit of zero is not a payment, and a negative amount is a reversal.
  --
  -- Reversals are **out of scope** for this story, recorded rather than silently
  -- permitted: they need a decision about whether they offset a payment or stand
  -- as their own row, and that decision belongs with whoever builds refunds.
  -- Until then a negative amount is refused rather than half-supported.
  constraint payment_amount_positive check (amount > 0)
);

-- Both directions matter, and for different reasons.
--
-- By document: the AD-13 replacement path deletes every payment a document
-- produced on each re-ingest, which is the hottest query this table has.
create index payment_document_id_idx on payment (document_id);

-- By unit and date: epic 4 asks "what did 4B pay during 2024", which is exactly
-- this order. Deliberately not unique -- a unit may pay twice in a month, and two
-- units may pay identical amounts on the same day.
create index payment_unit_id_paid_on_idx on payment (unit_id, paid_on);

-- Migration 003 revoked the reader's blanket select, so read access is an
-- explicit decision per table. SELECT only -- AD-4 keeps the LLM-driven query
-- path unable to invent a payment, and a payment that existed because a model
-- asked for one would clear an arrears finding that should have stood.
grant select on payment to watchdog_reader;

comment on table payment is
  'What arrived, against the unit it settles. Derived from a deposit document and replaced set-wise on re-ingest, per AD-13.';
comment on column payment.amount is
  'numeric(14,2), matching extraction.total_amount and assessment.annual_amount. Crosses every boundary as a decimal string. Positive only: reversals are out of scope and refused rather than half-supported.';
comment on column payment.paid_on is
  'The date on the deposit, not the ingest date. Lateness is measured against when the money arrived.';
