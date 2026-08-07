/**
 * The instalments an annual assessment is actually paid in.
 *
 * A pure function. No I/O, no imports outside `core/`, and **no clock** — story
 * 2.3's third acceptance criterion says the evaluation date is a parameter, and
 * a schedule that consulted the current date would answer a different question
 * every day.
 *
 * **Instalments fall due at the start of the period they cover**, because dues
 * are collected in advance. A monthly instalment for March is due 1 March; the
 * single annual instalment is due 1 January. That was settled before this was
 * written, and it had a consequence worth stating: every due date is the first
 * of a month, so leap years and short months never arise here. Period-end
 * instalments would have needed a day-count rule and a 29 February case.
 *
 * The remainder from an uneven division goes onto the **earliest** instalments —
 * one extra minor unit each until it is exhausted. 1000.00 over twelve months is
 * 83.33 with 0.04 left, so January through April are 83.34. Chosen so the
 * association is never short early in the year, and so no single instalment
 * carries a visibly odd figure.
 */

import type { BillingCycle } from './billing-cycle'
import { fromMinorUnits, toMinorUnits } from './minor-units'

export interface Instalment {
  /** `YYYY-MM-DD`, the first day of the period this instalment covers. */
  readonly dueOn: string

  /** A decimal string, as every amount in this system is. */
  readonly amount: string
}

/** The part of an assessment a schedule is derived from. */
export interface AssessmentTerms {
  readonly annualAmount: string
  readonly billingCycle: BillingCycle
  readonly assessmentYear: number
}

/**
 * The month each instalment falls due in, per cycle.
 *
 * One table rather than a `switch`, and typed `Record<BillingCycle, …>` so that
 * adding a cycle to `BILLING_CYCLES` fails the type check **here** rather than
 * falling through a default at runtime. The instalment count is this list's
 * length, so the two can never disagree.
 */
const DUE_MONTHS: Record<BillingCycle, readonly number[]> = {
  monthly: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  six_monthly: [1, 7],
  annual: [1],
}

export function deriveSchedule(terms: AssessmentTerms): readonly Instalment[] {
  const total = toMinorUnits(terms.annualAmount)

  if (total <= 0) {
    throw new RangeError(`an assessment must be for a positive amount: ${terms.annualAmount}`)
  }

  const months = DUE_MONTHS[terms.billingCycle]
  const count = months.length

  // Integer arithmetic throughout, and exact. `total % count` is exact for safe
  // integers, `total - remainder` is then exactly divisible, and dividing an
  // exactly-divisible pair inside 2^53 is exact too. `Math.floor(total / count)`
  // would usually agree and is not worth relying on.
  const remainder = total % count
  const base = (total - remainder) / count

  return months.map((month, index) => ({
    dueOn: `${terms.assessmentYear}-${String(month).padStart(2, '0')}-01`,
    // The earliest `remainder` instalments carry one extra minor unit, which is
    // what makes the instalments sum to exactly the annual amount.
    amount: fromMinorUnits(base + (index < remainder ? 1 : 0)),
  }))
}
