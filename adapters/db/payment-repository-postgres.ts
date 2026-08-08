import { Pool, type PoolClient } from 'pg'

import type { PaymentRepository } from '../../core/ports/payment-repository'
import type { ResolvedLine } from '../../core/payment/resolve-line'
import { readWriterDatabaseUrl } from '../auth/env'

/**
 * The `PaymentRepository` port backed by Postgres.
 *
 * Connects as `watchdog_writer`. This is the one adapter epic 2 added that
 * writes, because payments are derived from a document rather than typed by a
 * treasurer.
 *
 * The replacement follows `extraction-repository-postgres.ts` deliberately,
 * including the part that is easy to leave out.
 */

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


/** Absent, not empty. See the note at the held-payment insert. */
function blankToNull(value: string): string | null {
  return value.trim().length === 0 ? null : value
}

export function createPaymentRepository(options: { pool?: Pool } = {}): PaymentRepository {
  const pool = () => options.pool ?? getPool()

  return {
    async replace(documentId: string, lines: readonly ResolvedLine[]): Promise<void> {
      // Refused rather than obeyed, for the reason the extraction repository
      // records: `replace(id, [])` reads identically to "extraction found
      // nothing", and obeying it would destroy a good set on a caller's mistake.
      //
      // The bar is the *combined* set. A deposit whose every line was held is an
      // ordinary outcome — an unfamiliar reference format, a new roll — and
      // refusing it would reject a real document.
      if (lines.length === 0) {
        throw new RangeError(
          'replace requires at least one line; clearing a document needs a deliberate removal',
        )
      }

      const client: PoolClient = await pool().connect()

      try {
        await client.query('begin')

        // Lock the parent row before touching anything.
        //
        // The deletes below take row locks on what they remove, which serialises
        // two replacements against each other — but only when there are rows to
        // lock. On a document holding none, both transactions delete nothing,
        // both insert, and both commit, leaving the document holding two
        // readings at once. AD-13 says the previous reading is gone and the new
        // one is present; a union of two is neither. The `document` row exists
        // either way, so locking it is what makes replacement serialise
        // regardless of what the document already holds.
        await client.query('select 1 from document where id = $1 for update', [documentId])

        // Both tables, in the same transaction. A line either became a payment
        // or was held, and the two are one reading — clearing one and not the
        // other leaves the document described half by this reading and half by
        // the last, with nothing able to tell which.
        await client.query('delete from payment where document_id = $1', [documentId])
        await client.query('delete from held_payment where document_id = $1', [documentId])

        for (const line of lines) {
          if (line.kind === 'attributed') {
            await client.query(
              `insert into payment (unit_id, document_id, paid_on, amount)
               values ($1, $2, $3::date, $4)`,
              [line.unitId, documentId, line.paidOn, line.amount],
            )
          } else {
            // Empty means absent, and absent is the whole reason the line is
            // held. Migration 017 made these columns nullable for exactly this:
            // an empty string into a `date` raises 22007 and into `numeric`
            // 22P02, and either aborts the transaction -- so one malformed line
            // in a deposit used to lose every payment in that document.
            await client.query(
              `insert into held_payment
                 (document_id, unit_reference, paid_on, amount, hold_reason)
               values ($1, $2, $3::date, $4, $5)`,
              [
                documentId,
                blankToNull(line.unitReference),
                blankToNull(line.paidOn),
                blankToNull(line.amount),
                line.reason,
              ],
            )
          }
        }

        await client.query('commit')
      } catch (error) {
        // Rolled back so a failure midway leaves the previous reading intact.
        // The alternative is a document holding nothing at all, which is worse
        // than a stale reading: a treasurer can see that last month's figures
        // are old, and cannot see figures that are absent.
        await client.query('rollback').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },
  }
}
