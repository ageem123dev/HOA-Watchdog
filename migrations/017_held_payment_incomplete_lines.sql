-- A held payment is a question, not a payment waiting for a label.
--
-- Migration 016 gave `held_payment` the same `not null` columns and positive
-- amount check as `payment`. That was copied without asking what "held" means,
-- and it made the table unable to hold the very lines it exists for.
--
-- `resolveLine` holds a line whose reference, date or amount is missing --
-- because a payment the system silently forgot is worse than one waiting for a
-- human. Those lines then could not be inserted: an empty date raises 22007, an
-- empty amount 22P02, an empty reference 23514. Each aborts the transaction, so
-- **one malformed line in a deposit lost every payment in that document**.
--
-- Found by the whole-story review, in the seam between two sets of tests that
-- each passed: `resolve-line.test.ts` proved the holds, and
-- `payment-repository-postgres.test.ts` proved held lines are written -- with
-- well-formed ones. Nobody put the two together.

alter table held_payment alter column unit_reference drop not null;
alter table held_payment alter column paid_on        drop not null;
alter table held_payment alter column amount         drop not null;

-- The constraints stay, conditioned on presence. A reference that is there must
-- still be a real reference, and an amount that is there must still be positive;
-- absence is a different thing from nonsense.
alter table held_payment drop constraint held_payment_amount_positive;
alter table held_payment
  add constraint held_payment_amount_positive check (amount is null or amount > 0);

alter table held_payment drop constraint held_payment_reference_length;
alter table held_payment
  add constraint held_payment_reference_length check (
    unit_reference is null
    or (
      char_length(unit_reference) <= 64
      and char_length(
        btrim(unit_reference, ' ' || chr(9) || chr(10) || chr(13) || chr(11) || chr(12) || chr(160) || chr(8239))
      ) >= 1
    )
  );

-- Why it is being held.
--
-- Without this a row with a null amount says nothing about whether the document
-- omitted it or the reader failed to read it, and a human is asked a question
-- with no context. `resolveLine` already decides this; it was being discarded.
--
-- A closed vocabulary the database enforces, in the style of
-- `document_extraction_state` and `assessment_cycle_known`. The application
-- states the same four values in `core/payment/resolve-line.ts`, and a test
-- reads this file to prove the two agree -- a second statement of a shape is only
-- safe when something fails on disagreement.
--
-- Defaulted for the rows migration 016 already allowed, all of which were held
-- because their unit was unknown.
alter table held_payment add column hold_reason text not null default 'unknown-unit';

alter table held_payment
  add constraint held_payment_reason_known check (
    hold_reason in ('unknown-unit', 'missing-reference', 'missing-amount', 'missing-date')
  );

comment on column held_payment.hold_reason is
  'Why this line could not become a payment. Closed vocabulary, matching HOLD_REASONS in core/payment/resolve-line.ts.';
comment on column held_payment.unit_reference is
  'What the document said, unfolded. Null when the document gave no reference at all -- which is itself a reason to hold the line rather than drop it.';
