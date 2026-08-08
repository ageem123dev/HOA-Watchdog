-- A deposit line whose unit could not be identified.
--
-- AC2 of story 2.4: nothing is attributed to a unit on a guess. A line naming a
-- reference that does not fold to a known unit is held here for a human, in the
-- same manner an unrecognised vendor is held in `quarantine_item`.
--
-- Deliberately a separate table rather than a `kind` column on `quarantine_item`.
-- That table's `normalised_name` is `generated always as
-- (vendor_normalised_name(extracted_name))` -- a stored generated column -- so
-- holding unit references there would either fold them with the vendor
-- normaliser, or need that generated column dropped and recomputed on a table
-- epic 1 already ships. Migration 011 refused the first in as many words: a
-- later change to how vendor names are matched must not silently change which
-- units are considered the same unit.
--
-- The cost is real and worth naming: epic 3 has two quarantine surfaces to read
-- rather than one. That is the price of the separation, and it was paid once
-- already in 011.

create table held_payment (
  id                   uuid          primary key default uuidv7(),

  -- Cascade, matching `payment` and `extraction`. A held line without its
  -- document is debris, and the document is what a treasurer would be shown
  -- while deciding which unit it belongs to.
  document_id          uuid          not null references document (id) on delete cascade,

  -- What the document said, unfolded. This is the whole point of holding it: a
  -- human is being asked "which unit is this?", and the answer depends on seeing
  -- what was actually read.
  unit_reference       text          not null,

  -- Folded by `unit_normalised_number()`, the function migration 011 defines for
  -- unit identity and pins to `search_path = pg_catalog, pg_temp`. Never
  -- `vendor_normalised_name()`.
  --
  -- Stored so that resolving one held line can find its siblings: a deposit
  -- naming `4b` and `4B ` twice is one unknown reference, and a treasurer should
  -- not be asked the same question twice.
  normalised_reference text          generated always as (unit_normalised_number(unit_reference)) stored,

  paid_on              date          not null,

  -- `numeric(14,2)`, like `payment.amount`. A held line becomes a payment
  -- unchanged once a human names its unit, so the amount must survive the move
  -- without conversion.
  amount               numeric(14,2) not null,

  created_at           timestamptz   not null default now(),

  -- Same rule as `payment`: zero is not a payment and a reversal is out of
  -- scope. A line failing this is malformed rather than merely unattributable,
  -- and holding it would put a question to a human that has no good answer.
  constraint held_payment_amount_positive check (amount > 0),

  -- Measured twice, the shape migration 009 arrived at: measuring after `btrim`
  -- lets 'x' plus three hundred spaces through.
  constraint held_payment_reference_length check (
    char_length(unit_reference) <= 64
    and char_length(
      btrim(unit_reference, ' ' || chr(9) || chr(10) || chr(13) || chr(11) || chr(12) || chr(160) || chr(8239))
    ) >= 1
  )
);

-- Deliberately **no** unique constraint on (document_id, normalised_reference).
--
-- One deposit can legitimately carry two unresolved lines for the same unknown
-- reference on different dates -- a unit paying twice in a month, under a
-- reference nobody recognises yet. A unique constraint would reject the second
-- line, and the money it represents would vanish from the ledger without anyone
-- being told. Holding a duplicate question is recoverable; dropping a payment is
-- not.
create index held_payment_document_id_idx on held_payment (document_id);
create index held_payment_normalised_reference_idx on held_payment (normalised_reference);

grant select on held_payment to watchdog_reader;

comment on table held_payment is
  'A deposit line whose unit could not be identified, waiting on a human. Separate from quarantine_item so unit identity stays governed by unit_normalised_number() rather than vendor_normalised_name().';
comment on column held_payment.normalised_reference is
  'Folded by unit_normalised_number(). A comparison key for grouping the same unknown reference, not for display.';
