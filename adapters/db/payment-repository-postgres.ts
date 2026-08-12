import { Pool, type PoolClient } from 'pg'

import { StaleExtractionClaimError } from '../../core/ports/document-repository'
import type { PaymentRepository } from '../../core/ports/payment-repository'
import type { ResolvedLine } from '../../core/payment/resolve-line'
import { writerPool } from './pool'

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


/** One pool per process, built on first use — see the `next build` note in `../auth/env.ts`. */


/** Absent, not empty. See the note at the held-payment insert. */
function blankToNull(value: string): string | null {
  return value.trim().length === 0 ? null : value
}

export function createPaymentRepository(options: { pool?: Pool } = {}): PaymentRepository {
  const pool = () => options.pool ?? writerPool()

  return {
    async replace(
      documentId: string,
      lines: readonly ResolvedLine[],
      fence?: { readonly token: string },
    ): Promise<void> {
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
      let released = false

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
        // The fence, in the same statement as the lock -- checked outside the
        // transaction there would be a window in which the claim expires between
        // the check and the write, which is the gap it exists to close.
        //
        // Without it a stale run could overwrite a fresher run's payments and
        // nothing would notice: `recordPayments` runs *before* the fenced
        // extraction write, so run A finishing after run B settled the document
        // replaced B's payments, then had its own records correctly refused --
        // leaving extraction rows from B and payment rows from A, on a document
        // marked `read` and never polled again. Raised on the merge request.
        //
        // Optional because the upload path has no claim to fence against: a CSV
        // is read synchronously inside the request that uploaded it, and there
        // is no second runner to race.
        const guarded = await client.query(
          fence === undefined
            ? 'select 1 from document where id = $1 for update'
            : `select 1 from document
                where id = $1 and extraction_claim_token = $2
                for update`,
          fence === undefined ? [documentId] : [documentId, fence.token],
        )

        if (fence !== undefined && guarded.rowCount === 0) {
          throw new StaleExtractionClaimError(documentId)
        }

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
        // If the rollback itself fails the connection is still inside a
        // transaction, and releasing it returns a poisoned client to the pool for
        // the next caller to inherit. Destroyed instead. Raised by review.
        let rollbackFailed = false
        try {
          await client.query('rollback')
        } catch {
          rollbackFailed = true
        }
        client.release(rollbackFailed)
        released = true
        throw error
      } finally {
        if (!released) client.release()
      }
    },
  }
}
