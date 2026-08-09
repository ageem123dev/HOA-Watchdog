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

/**
 * A reference the database cannot be sent at all.
 *
 * `text` cannot hold a NUL, so passing one as a parameter raises 22021 — which
 * aborts the transaction the ingest is running in, so one malformed line would
 * take every payment in the document with it. Exactly the shape migration 017
 * was written to fix, in a new place.
 *
 * Dropped rather than cleaned. A reference containing a NUL cannot match a unit
 * either way, because no `unit_number` can contain one; stripping it would
 * invent a different reference and might match the wrong unit.
 */
function sendable(reference: string): boolean {
  return !reference.includes('\u0000')
}

export function createUnitDirectory(options: { pool?: Pool } = {}): UnitDirectory {
  const pool = () => options.pool ?? getPool()

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
      const { rows } = await pool().query<UnitHolding>(
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
      const { rows } = await pool().query<UnitHolding>(
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

    async unitIdsFor(references: readonly string[]): Promise<ReadonlyMap<string, string>> {
      // Distinct before asking. A deposit where forty lines name the same unit
      // is one question, and the map is keyed by reference either way.
      //
      // Order preserved rather than going through a Set alone, so the parameter
      // a test asserts on is stable and a failure is readable.
      const seen = new Set<string>()
      const asking: string[] = []

      for (const reference of references) {
        if (!sendable(reference) || seen.has(reference)) continue
        seen.add(reference)
        asking.push(reference)
      }

      // Applied to what will actually be sent, not to what arrived — dropping
      // the unsendable references can empty a non-empty list. An empty array
      // would still be a round trip to answer a question with one possible
      // answer.
      if (asking.length === 0) return new Map()

      // `unnest` and one round trip, not one query per line. The join does the
      // folding on both sides through the function migration 011 defines, so a
      // reference matches exactly what the roll would match and nothing else.
      //
      // `r.reference` is echoed back deliberately: the caller keys on its own
      // string. Returning `unit.normalised_number` instead would silently
      // require core's `fold` and `unit_normalised_number` to agree, and they
      // do not — see the port's note on U+3000.
      const { rows } = await pool().query<{ reference: string; id: string }>(
        `select r.reference as "reference", unit.id as "id"
           from unnest($1::text[]) as r(reference)
           join unit on unit.normalised_number = unit_normalised_number(r.reference)`,
        [asking],
      )

      const found = new Map<string, string>()
      for (const row of rows) found.set(row.reference, row.id)

      return found
    },
  }
}
