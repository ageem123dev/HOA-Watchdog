/**
 * Whether an association holds any units yet, from Postgres (story 5.8).
 *
 * `core/ports/unit-census.ts` is the contract. This is the one query behind it.
 *
 * ## The writer pool, for a read
 *
 * Not a preference, and not the usual choice. Migration 003 revokes **all** on
 * `board_member` from `watchdog_reader`, deliberately: "the LLM-driven query
 * path has no business with credentials". Deriving an association from a member
 * means reading `board_member`, so the reader cannot answer this question at
 * all — a reader-pool version throws a permission error at upload time rather
 * than returning something wrong.
 *
 * `unit-directory-postgres.ts` uses the reader and never hits this, because it
 * does not scope by association. That is the gap AD-4 names about itself:
 * "SELECT-only is a capability control, not an isolation one."
 *
 * ## What makes this cheap
 *
 * Migration 025's `unit (association_id, normalised_number)` has `association_id`
 * as its leading column, so the scoped lookup uses it. Nothing new is needed;
 * recorded because the next person to read this will wonder, and because an
 * unindexed version of this query runs on every upload.
 *
 * ## `exists`, not `count`
 *
 * One row is enough to answer, and this runs on every upload. `count(*)` would
 * read every unit the association holds to learn something the first row
 * settles.
 */

import type { UnitCensus } from '@/core/ports/unit-census'

import { writerPool } from './pool'

export function createUnitCensus(): UnitCensus {
  return {
    async hasUnits(member): Promise<boolean> {
      const found = await writerPool().query<{ any_units: boolean }>(
        // The association is read from the member, never passed in. This answer
        // decides whether deposits may be uploaded, so a caller able to name an
        // association could satisfy it with another board's units.
        `select exists (
           select 1 from unit
            where association_id = (select association_id from board_member where id = $1)
         ) as any_units`,
        [member],
      )

      // An unknown member yields NULL from the subquery, `association_id = null`
      // matches nothing, and `exists` is false — which refuses the upload.
      return found.rows[0]?.any_units === true
    },
  }
}
