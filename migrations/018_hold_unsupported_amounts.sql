-- A line whose amount a payment cannot hold is held, not crashed on.
--
-- `extraction.total_amount` is documented as negative for a credit to the
-- association, and `validate.ts` accepts negatives deliberately. `payment.amount`
-- refuses them, because a reversal needs a decision about whether it offsets a
-- payment or stands as its own row -- migration 015 recorded that as out of
-- scope.
--
-- "Out of scope" was implemented as a check constraint, which means the insert
-- raises 23514 and aborts the replacement. That loses every payment in the
-- document, and the generic handler treats the failure as a retryable outage, so
-- the document is retried forever. This is the same shape as migration 017's
-- defect: a line the system cannot use should become a question, never an
-- exception.
--
-- So `resolveLine` now holds such a line, and this is the reason it records.

alter table held_payment drop constraint held_payment_reason_known;

alter table held_payment
  add constraint held_payment_reason_known check (
    hold_reason in (
      'unknown-unit',
      'missing-reference',
      'missing-amount',
      'missing-date',
      'unsupported-amount'
    )
  );
