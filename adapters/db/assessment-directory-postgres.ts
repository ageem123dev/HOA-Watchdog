import { Pool } from 'pg'

import type { AssessmentDirectory, UnitAssessment } from '../../core/ports/assessment-directory'
import { readReaderDatabaseUrl } from '../auth/env'

/**
 * The `AssessmentDirectory` port backed by Postgres.
 *
 * Connects as `watchdog_reader`, like the unit directory and the quarantine
 * queue, and for the same reason: this only ever reads, and AD-4's separation is
 * only real where a connection string makes it real. Migration 013 granted
 * SELECT on `assessment` to the reader for exactly this, and a grant nothing
 * exercises is a comment.
 *
 * The reader cannot record an assessment. That is data entry — a roll arrives
 * once a year — and an assessment that existed because the LLM-driven query path
 * asked for one would carry dues nobody owes.
 */

let sharedPool: Pool | null = null

/** One pool per process, built on first use — see the `next build` note in `../auth/env.ts`. */
function getPool(): Pool {
  if (sharedPool === null) {
    sharedPool = new Pool({
      connectionString: readReaderDatabaseUrl(),
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
    })

    sharedPool.on('error', () => {
      // An idle client failing has no request to reject. With no listener here
      // Node treats it as unhandled and takes the process down.
    })
  }

  return sharedPool
}

export function createAssessmentDirectory(): AssessmentDirectory {
  return {
    async forUnitAndYear(unitNumber: string, year: number): Promise<UnitAssessment | null> {
      // `annual_amount` is selected as-is. `pg` maps `numeric` to a decimal
      // string, which is exactly the contract — no cast, no `Number()`, no
      // `parseFloat`. Any of those would undo the money decision this story was
      // written around, and would still pass every test whose value happens to
      // round-trip cleanly, like 1200.
      //
      // Columns named one by one rather than `select *`: `unit` carries
      // `normalised_number`, a comparison key no human has a use for, and both
      // tables carry ids that no caller needs.
      //
      // `unit_normalised_number($1)` and not the raw column, so `4b ` off a roll
      // finds `4B`. Migration 011 defines the folding and pins its `search_path`.
      //
      // At most one row: migration 013's `assessment_one_per_unit_year` makes a
      // second row for the pair unrepresentable, and `migrations/assessment.test.ts`
      // proves it fires. No defensive length check is written for a case nothing
      // could produce without dropping that constraint.
      const { rows } = await getPool().query<UnitAssessment>(
        `select unit.unit_number             as "unitNumber",
                assessment.assessment_year   as "assessmentYear",
                assessment.annual_amount     as "annualAmount",
                assessment.billing_cycle     as "billingCycle"
           from assessment
           join unit on unit.id = assessment.unit_id
          where unit.normalised_number = unit_normalised_number($1)
            and assessment.assessment_year = $2`,
        [unitNumber, year],
      )

      return rows[0] ?? null
    },
  }
}
