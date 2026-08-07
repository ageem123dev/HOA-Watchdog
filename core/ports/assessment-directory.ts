/**
 * The port through which a caller asks what a unit owes for a year.
 *
 * One question, because it is the one this story answers. Story 2.3 turns the
 * answer into instalments; story 2.4 compares what arrived against it.
 *
 * **This port can only read.** Recording an assessment is data entry — a roll
 * arrives once a year and is typed or uploaded — and no story before 2.4 does it
 * from the application. A write method here would satisfy the same acceptance
 * criteria and delete that argument; the absence is the design, because a caller
 * cannot quietly reach for a method that was never declared.
 * `core/ports/unit-directory.ts` and `quarantine-queue.ts` make the same case.
 *
 * There is deliberately no "every assessment for a year" method either. AC2's
 * comparison is between two units a caller already has in hand, and the roll
 * view belongs to whichever surface first shows one.
 */

import type { BillingCycle } from '../assessment/billing-cycle'

/**
 * What one unit owes for one year, and when it falls due.
 */
export interface UnitAssessment {
  /**
   * The unit number as a treasurer typed it, not the folded comparison key.
   *
   * Migration 011's `normalised_number` is how the lookup matches; it is no use
   * to a human and never leaves the adapter.
   */
  readonly unitNumber: string

  readonly assessmentYear: number

  /**
   * The annual figure, as a decimal string.
   *
   * A string and deliberately not a `number`. A binary float cannot represent
   * 0.10, and a `number` also erases the difference between `1200` and
   * `1200.00` — which matters because story 2.4 compares this against an
   * extracted payment that crosses the same boundary the same way
   * (`ExtractionRecord.totalAmount`). Two representations would put a rounding
   * conversion inside the comparison that produces arrears findings.
   *
   * The **annual** figure, never the instalment. A monthly payer owing 1200 for
   * the year reads `'1200.00'` here, not `'100.00'`; story 2.3 is what divides
   * it. Migration 013 says the same thing in its column comment, because no
   * constraint can enforce it.
   */
  readonly annualAmount: string

  /**
   * When the annual amount falls due — never how much is owed.
   *
   * The shared union rather than `string`: a bare string would let a caller
   * construct a cycle the database rejects, and the three-value union is what
   * makes story 2.3's handling of it exhaustive at compile time.
   */
  readonly billingCycle: BillingCycle
}

export interface AssessmentDirectory {
  /**
   * What the unit owes for that year, or `null` if no assessment was recorded.
   *
   * At most one, and that is the database's guarantee rather than this
   * function's: migration 013's `assessment_one_per_unit_year` makes a second
   * row for the same pair unrepresentable, and `migrations/assessment.test.ts`
   * proves it fires. No defensive check is written for a case that cannot be
   * produced without dropping that constraint.
   *
   * `null` also covers a unit number matching no unit at all. Nothing in this
   * epic needs to tell those apart, so nothing here invents an error contract
   * for it; the distinction belongs to whichever surface first lets a treasurer
   * type a unit number and get it wrong.
   *
   * `unitNumber` is matched as a treasurer would type it — `4b ` finds `4B`.
   */
  forUnitAndYear(unitNumber: string, year: number): Promise<UnitAssessment | null>
}
