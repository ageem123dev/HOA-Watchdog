import { Pool } from 'pg'

import type {
  VendorDirectory,
  VendorResolution,
  VendorSuggestion,
} from '../../core/ports/vendor-directory'
import { readWriterDatabaseUrl } from '../auth/env'

/**
 * The `VendorDirectory` port backed by Postgres.
 *
 * Both queries call `vendor_normalised_name()` rather than normalising in
 * TypeScript first. That is the point: the generated column that decides
 * identity is computed by that same function, so a lookup and a stored key
 * cannot drift apart. `core/vendor/name.ts` holds an equivalent implementation
 * for callers that need one, and a test runs both over a shared corpus — but
 * nothing on this path depends on the two agreeing, because only one of them is
 * used here.
 *
 * The two methods stay apart on purpose. `resolve` is an indexed equality on the
 * normalised key and is allowed to decide. `suggest` is a similarity ranking and
 * is not. Collapsing them — "resolve, and failing that take the best
 * suggestion" — reintroduces automatic near-matching, which writes a false
 * vendor identity into the comparison history and reports success.
 */

/**
 * How similar a name must be to appear as a candidate at all.
 *
 * Written here rather than left to `pg_trgm.similarity_threshold`, which the `%`
 * operator reads from the session. A setting another connection or a pooler can
 * change is behaviour nobody can see in this file.
 *
 * This affects only what a human is offered, never what resolves. Lowering it
 * lengthens a list; it cannot merge two vendors.
 */
const SUGGESTION_FLOOR = 0.3

let sharedPool: Pool | null = null

/** One pool per process, built on first use — see the `next build` note in `../auth/env.ts`. */
function getPool(): Pool {
  if (sharedPool === null) {
    sharedPool = new Pool({
      connectionString: readWriterDatabaseUrl(),
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

export function createVendorDirectory(): VendorDirectory {
  return {
    async resolve(extractedName: string): Promise<VendorResolution> {
      // Equality on the indexed generated column. Not `similarity`, not `like`,
      // not a prefix — each of those resolves names that are merely close, and
      // a wrong resolution here is both silent and permanent.
      const { rows } = await getPool().query<{ id: string }>(
        'select id from vendor where normalised_name = vendor_normalised_name($1)',
        [extractedName],
      )

      const found = rows[0]

      return found === undefined
        ? { outcome: 'unresolved' }
        : { outcome: 'resolved', vendorId: found.id }
    },

    async suggest(extractedName: string, limit: number): Promise<readonly VendorSuggestion[]> {
      // Guarded at the boundary, and loudly. Postgres rejects a negative LIMIT
      // with a syntax error and silently truncates a fractional one; neither
      // tells the caller what it did wrong.
      if (!Number.isInteger(limit) || limit < 0) {
        throw new RangeError(`suggest limit must be a non-negative integer, received ${limit}`)
      }

      if (limit === 0) return []

      const { rows } = await getPool().query<{
        id: string
        display_name: string
        // `similarity()` is float4, which pg deserialises to a JS number --
        // checked, not assumed. It was typed `string` here with a `Number()`
        // call downstream that looked like a conversion and was a no-op.
        score: number
      }>(
        `select id,
                display_name,
                similarity(normalised_name, vendor_normalised_name($1)) as score
           from vendor
          where similarity(normalised_name, vendor_normalised_name($1)) >= $2
          order by score desc, display_name asc
          limit $3`,
        [extractedName, SUGGESTION_FLOOR, limit],
      )

      return rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        score: row.score,
      }))
    },
  }
}
