import type { Pool } from 'pg'
import type { HeldPayment, HeldPaymentQueue } from '../../core/ports/held-payment-queue'
import { readerPool } from './pool'

/**
 * The `HeldPaymentQueue` port backed by Postgres.
 *
 * Connects as `watchdog_reader`, like the quarantine queue it mirrors. This only
 * ever reads, and AD-4's separation is only real where a connection string makes
 * it real. Migration 016 granted SELECT on `held_payment` to the reader for
 * exactly this, and a grant nothing exercises is a comment.
 *
 * The reader cannot resolve a held payment, which is the half that matters.
 * Skipping a treasurer's decision is the failure AC2 exists to prevent, so the
 * path that renders the queue is deliberately incapable of emptying it.
 */

/**
 * The pool is injectable so the SQL can actually be executed in a test.
 *
 * Raised by review, and it was a real gap: the connection test mocks `pg`, so
 * without this the query below was never run against a database. A malformed
 * column name or a bad `to_char` would have passed every test in this repo.
 * `payment-repository-postgres.ts` takes the same option for the same reason.
 */
export function createHeldPaymentQueue(options: { pool?: Pool } = {}): HeldPaymentQueue {
  const resolvePool = () => options.pool ?? readerPool()

  return {
    async held(): Promise<readonly HeldPayment[]> {
      // Columns named one by one rather than `select *`: `held_payment` carries
      // `normalised_reference` and `document` carries `storage_key`, and both
      // would ride along. AD-10 keeps storage keys inside the storage adapter,
      // and the folded reference is a comparison key a treasurer has no use for.
      //
      // `join`, not `left join`: the foreign key with `on delete cascade` means
      // a held payment without its document cannot exist, and a left join would
      // answer that impossible case with a row whose filename is null.
      //
      // `id` breaks ties on `created_at`, which is not decoration: rows written
      // by one replacement share `now()` to the microsecond, and without it the
      // order is whatever the plan produced. Two renders of an unchanged queue
      // would then disagree.
      const { rows } = await resolvePool().query<HeldPayment>(
        `select held_payment.document_id     as "documentId",
                document.filename            as "filename",
                held_payment.unit_reference  as "unitReference",
                to_char(held_payment.paid_on, 'YYYY-MM-DD') as "paidOn",
                held_payment.amount          as "amount",
                held_payment.hold_reason     as "reason"
           from held_payment
           join document on document.id = held_payment.document_id
          order by held_payment.created_at asc, held_payment.id asc`,
      )

      return rows
    },
  }
}
