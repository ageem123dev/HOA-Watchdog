import { Pool } from 'pg'

import type { UnitDirectory, UnitHolding } from '../../core/ports/unit-directory'
import { readReaderDatabaseUrl } from '../auth/env'

/**
 * The `UnitDirectory` port backed by Postgres.
 *
 * Connects as `watchdog_reader`, like the quarantine queue and for the same
 * reason: this only ever reads, and AD-4's separation is only real where a
 * connection string makes it real. Migration 012 granted SELECT on both tables
 * to the reader for exactly this, and a grant nothing exercises is a comment.
 *
 * The reader cannot record a unit, a person, or a change of hands. That is data
 * entry, and no story before 2.4 does it from the application — so the path that
 * answers "who held 4B in March" is deliberately incapable of changing the
 * answer.
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

/**
 * The tenure columns, spelled once.
 *
 * `to_char` on both bounds rather than selecting the `date` and letting `pg`
 * convert it: `pg` builds a JS `Date` at *local* midnight, so 2024-07-01 comes
 * back as 2024-06-30T23:00:00Z for anyone west of UTC and every comparison
 * downstream is a day out for half the world. A calendar date stays text.
 *
 * `upper(...)` is null for an open-ended membership, and `to_char(null, …)` is
 * null — so "still holds it" arrives as `null` without a case expression.
 *
 * Columns named one by one rather than `select *`: `unit` carries
 * `normalised_number`, which is a comparison key no human has a use for, and
 * three ids would ride along with it.
 */
const TENURE_COLUMNS = `unit_holder.full_name as "holderName",
                to_char(lower(unit_membership.held_during), 'YYYY-MM-DD') as "heldFrom",
                to_char(upper(unit_membership.held_during), 'YYYY-MM-DD') as "heldUntil"`

export function createUnitDirectory(): UnitDirectory {
  return {
    async heldBy(unitNumber: string, on: string): Promise<UnitHolding | null> {
      // `held_during @> $2::date` asks the database the containment question
      // rather than reassembling it here from `lower` and `upper`. On a
      // half-open range that is what makes the day of sale belong to exactly one
      // tenure; `lower <= d and upper >= d` in application code would hand it to
      // both, which is the bug the whole dated-membership design exists to
      // prevent.
      //
      // `unit_normalised_number($1)` and not the raw column: `4b  ` off a roll
      // is the same property as `4B`, and migration 011 defines the folding.
      //
      // At most one row comes back, and that is the schema's guarantee rather
      // than this function's — migration 012's exclusion constraint makes two
      // memberships covering one date for one unit unrepresentable. No
      // defensive length check is written here, because nothing could make it
      // fail without dropping that constraint, and a guard that cannot be made
      // to fire proves nothing.
      const { rows } = await getPool().query<UnitHolding>(
        `select ${TENURE_COLUMNS}
           from unit_membership
           join unit on unit.id = unit_membership.unit_id
           join unit_holder on unit_holder.id = unit_membership.holder_id
          where unit.normalised_number = unit_normalised_number($1)
            and unit_membership.held_during @> $2::date`,
        [unitNumber, on],
      )

      return rows[0] ?? null
    },

    async historyFor(unitNumber: string): Promise<readonly UnitHolding[]> {
      // Ordered by when each tenure began. Memberships for one unit cannot
      // overlap, so their start dates are already distinct and no tiebreak is
      // needed — unlike the quarantine queue, where rows written by one
      // statement share `created_at` to the microsecond. The exclusion
      // constraint is what makes that true, which is why it is stated here
      // rather than left as something a reader has to work out.
      const { rows } = await getPool().query<UnitHolding>(
        `select ${TENURE_COLUMNS}
           from unit_membership
           join unit on unit.id = unit_membership.unit_id
           join unit_holder on unit_holder.id = unit_membership.holder_id
          where unit.normalised_number = unit_normalised_number($1)
          order by lower(unit_membership.held_during) asc`,
        [unitNumber],
      )

      return rows
    },
  }
}
