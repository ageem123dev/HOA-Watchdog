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
import { describeValue, fromMinorUnits, toMinorUnits } from './minor-units'

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
    throw new RangeError(
      `an assessment must be for a positive amount: ${describeValue(terms.annualAmount)}`,
    )
  }

  if (!Number.isSafeInteger(terms.assessmentYear)) {
    // A fractional year yields '2024.5-01-01', which is not a date and sorts
    // nowhere sensible. The database constrains the year to 1900-2200; that
    // range is deliberately not restated here, because a second statement of a
    // rule is only safe when something fails on disagreement (migration 007's
    // note) and nothing here would.
    throw new RangeError(`not a calendar year: ${describeValue(terms.assessmentYear)}`)
  }

  // `Object.hasOwn`, not a bare lookup. `DUE_MONTHS.constructor` is a function
  // with a `length` of 1 and no `map`, and `DUE_MONTHS.__proto__` is an object
  // with neither -- so an unvalidated key does not give `undefined`, it gives
  // something that fails three lines later as "months.map is not a function",
  // naming nothing useful. Story 1.6d shipped this exact defect, where
  // `suggestions[key] ?? []` returned Object.prototype members for a vendor name
  // that folded to `constructor`.
  if (!Object.hasOwn(DUE_MONTHS, terms.billingCycle)) {
    throw new TypeError(`not a billing cycle: ${describeValue(terms.billingCycle)}`)
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
    // The year is padded too: '999-01-01' < '2024-01-01' is false, so a short
    // year silently breaks the string ordering these dates exist to provide.
    dueOn: `${String(terms.assessmentYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`,
    // The earliest `remainder` instalments carry one extra minor unit, which is
    // what makes the instalments sum to exactly the annual amount.
    amount: fromMinorUnits(base + (index < remainder ? 1 : 0)),
  }))
}

/**
 * `YYYY-MM-DD`. Shape only, deliberately.
 *
 * This does not check that the date exists — `2024-13-01` passes. Validating a
 * real calendar date belongs where dates enter the system, not here, and the
 * shape is what this function actually depends on: string comparison is date
 * comparison only while every date has the same width. `2024-6-01` sorts *after*
 * `2024-12-01`, which would quietly change which instalments count.
 */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * What a unit is expected to have paid by a given date.
 *
 * The sum of every instalment already due — **including one falling due on the
 * date itself**, because dues are collected in advance. A unit owes January's
 * instalment on 1 January, not on 2 January.
 *
 * The date is a parameter and the comparison is a string comparison. Parsing
 * either side into a `Date` would make it an instant at local midnight and shift
 * the day for anyone west of UTC, changing which instalments count. Story 2.1
 * recorded the same hazard for membership dates.
 */
/**
 * Whether an instalment has fallen due by a date.
 *
 * One predicate, used by both `expectedBy` and `instalmentsDueBy`. Story 4.4
 * counted instalments with its own `dueOn <= on` and CodeRabbit pointed out
 * that the two could drift: a finding would then say "3 instalments" beside an
 * expected figure covering four. `<=` and not `<` because dues are collected in
 * advance — a unit owes January's instalment *on* 1 January.
 */
function hasFallenDue(instalment: Instalment, on: string): boolean {
  return instalment.dueOn <= on
}

/**
 * How many instalments have fallen due by a date.
 *
 * The count beside `expectedBy`'s figure, and deliberately not derivable from
 * it — two instalments of 50 and one of 100 both total 100.
 */
export function instalmentsDueBy(schedule: readonly Instalment[], on: string): number {
  if (typeof on !== 'string' || !CALENDAR_DATE.test(on)) {
    throw new RangeError(`not a calendar date: ${describeValue(on)}`)
  }

  return schedule.filter((instalment) => hasFallenDue(instalment, on)).length
}

export function expectedBy(schedule: readonly Instalment[], on: string): string {
  if (typeof on !== 'string' || !CALENDAR_DATE.test(on)) {
    throw new RangeError(`not a calendar date: ${describeValue(on)}`)
  }

  // Summed in minor units, then formatted once. Adding decimal strings as
  // numbers would drift, and the drift would be invisible until an arrears
  // finding was a cent out.
  const total = schedule
    .filter((instalment) => hasFallenDue(instalment, on))
    .reduce((sum, instalment) => sum + toMinorUnits(instalment.amount), 0)

  return fromMinorUnits(total)
}
