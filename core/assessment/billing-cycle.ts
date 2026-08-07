/**
 * The cadences on which an annual assessment is settled.
 *
 * Stated here and in migration 013's `assessment_cycle_known` check constraint,
 * with a test reading the migration to prove the two agree. Migration 007's
 * comment gives the reason a second statement is allowed at all: it is only safe
 * when something fails on disagreement.
 *
 * The cycle changes *when* the annual amount falls due, never *how much* is owed
 * for the year. Two units with the same annual figure on different cycles owe the
 * same total -- which is why `assessment.annual_amount` holds the annual figure
 * and never the instalment. Story 2.3 turns this pair into the instalments.
 *
 * Lower-case, matching the constraint. `Monthly` is a value the database rejects
 * and every comparison here would miss.
 */
export const BILLING_CYCLES = Object.freeze(['monthly', 'six_monthly', 'annual'] as const)

export type BillingCycle = (typeof BILLING_CYCLES)[number]
