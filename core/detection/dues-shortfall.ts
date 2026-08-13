import {
  deriveSchedule,
  expectedBy,
  instalmentsDueBy,
  type AssessmentTerms,
} from '../assessment/schedule'
import { fromMinorUnits, toMinorUnits } from '../assessment/minor-units'
import type { BillingCycle } from '../assessment/billing-cycle'

/**
 * What a unit owed against what arrived (FR-7, story 4.4).
 *
 * > "Uploaded bank deposit data is compared against the expected assessment roll
 * > to identify units with missed or partial payments, without manual
 * > reconciliation."
 *
 * ## The schedule is story 2.3's, and re-deriving it here would be the defect
 *
 * `deriveSchedule` and `expectedBy` already answer "how much was owed by this
 * date". They settle two things this file would otherwise settle worse:
 * instalments sum to exactly the annual amount with the remainder placed on the
 * earliest ones, and instalments fall due at the **start** of the period they
 * cover, because dues are collected in advance.
 *
 * Writing `annualAmount / 12` here instead would be a second definition of when
 * money is owed — the defect story 1.6 exists to prevent, arriving somewhere
 * new. It would also be wrong by cents: 1000.00 over twelve months is 83.33 with
 * four left over, and only the schedule knows where those four went.
 *
 * ## Two findings, and what actually separates them
 *
 * The epic asks for two flags — *paid late* and *paid the wrong amount* — and
 * they are only distinguishable if this file says how. At an evaluation date the
 * comparison is cumulative: this much had fallen due, this much arrived. Both
 * flags are the same subtraction, so the split is the other question:
 *
 * - **Nothing has been recorded** against what was due. FR-7's "missed".
 * - **Something has, and it does not cover it.** FR-7's "partial".
 *
 * One test, `received === 0`, so a unit can never be both. Anything finer — such
 * as matching each payment to the instalment it was meant for — would need an
 * allocation rule nobody has stated, and would invent one silently.
 *
 * ## No clock
 *
 * The evaluation date is a parameter, exactly as story 2.3 required of the
 * schedule. A detector that consulted the current date would answer a different
 * question every day, and re-running it would amend a finding a board member had
 * already reviewed. Choosing the date is the caller's job and is argued where it
 * is chosen.
 *
 * ## No credit guard, and that is a schema fact rather than an oversight
 *
 * Story 4.3 dropped negative amounts because a vendor credit arrives as a
 * negative `total_amount`. Nothing here does: `payment_amount_positive` is a
 * check constraint, so a payment is positive or it is not a row. Writing the
 * guard again would be a guard nothing can break.
 */

/** One payment that arrived, as the reader hands it over. */
export interface ReceivedPayment {
  /** `YYYY-MM-DD`. Carried for the evidence; the sum does not depend on it. */
  readonly paidOn: string
  /** A decimal string, as every amount in this system is. */
  readonly amount: string
}

export interface DuesShortfall {
  /**
   * Which of FR-7's two flags this is.
   *
   * `not-recorded` deliberately does not say *unpaid*. The commonest cause of
   * nothing being recorded is a deposit nobody has uploaded yet, and UX-DR23
   * forbids implying a certainty the system lacks — least of all about whether
   * a named person paid their dues.
   */
  readonly kind: 'not-recorded' | 'below-expected'
  /** What the schedule expected by `evaluatedOn`, as a decimal string. */
  readonly expected: string
  /** What arrived, as a decimal string. */
  readonly received: string
  /** `expected - received`, positive by construction. */
  readonly shortfall: string
  /** UX-DR24's count: how many instalments had fallen due. */
  readonly instalmentsDue: number
  /** Carried so a board member can see why an annual payer owes it all in January. */
  readonly billingCycle: BillingCycle
  /** The date the comparison was made against, never "today". */
  readonly evaluatedOn: string
}

/**
 * Whether this unit is behind its schedule, and by how much.
 *
 * `payments` is what the reader selected for this assessment year; choosing them
 * is the reader's job, the way ordering is in `duplicatesAmong`. Everything
 * handed over is counted.
 */
export function shortfallAgainst(
  assessment: AssessmentTerms,
  payments: readonly ReceivedPayment[],
  evaluatedOn: string,
): DuesShortfall | null {
  const schedule = deriveSchedule(assessment)
  // Throws on a malformed date rather than comparing it as a string, which
  // would quietly match no instalment and expect nothing.
  const expected = toMinorUnits(expectedBy(schedule, evaluatedOn))

  const received = payments.reduce((total, payment) => total + toMinorUnits(payment.amount), 0)

  // **One comparison, and it covers more than it looks like.** An explicit
  // `expected <= 0` guard stood above this until the sensitivity check removed
  // it and all sixteen tests still passed: before anything has fallen due,
  // expected is zero, and zero received is not less than zero expected. The
  // third such guard deleted in this epic. *Is silent before anything has
  // fallen due* is the test that keeps the behaviour honest without it.
  if (received >= expected) return null

  return {
    kind: received === 0 ? 'not-recorded' : 'below-expected',
    expected: fromMinorUnits(expected),
    received: fromMinorUnits(received),
    shortfall: fromMinorUnits(expected - received),
    // `instalmentsDueBy`, not a `dueOn <= evaluatedOn` of its own. The two
    // spellings could drift, and a finding reading "3 instalments" beside an
    // expected figure covering four is a number a board member cannot check.
    // Raised by CodeRabbit.
    instalmentsDue: instalmentsDueBy(schedule, evaluatedOn),
    billingCycle: assessment.billingCycle,
    evaluatedOn,
  }
}
