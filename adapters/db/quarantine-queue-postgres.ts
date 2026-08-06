import { Pool } from 'pg'

import type { HeldItem, QuarantineQueue } from '../../core/ports/quarantine-queue'
import { readReaderDatabaseUrl } from '../auth/env'

/**
 * The `QuarantineQueue` port backed by Postgres.
 *
 * The first adapter here to connect as `watchdog_reader`. Every other one uses
 * the writer because every other one writes; this only ever reads, and AD-4's
 * separation is only real where a connection string makes it real. Migration
 * 010 granted this table's SELECT to the reader for exactly this, and a grant
 * nothing exercises is a comment.
 *
 * The reader cannot clear a hold, which is the half that matters. Skipping a
 * treasurer's decision is the failure AD-8 exists to prevent, so the path that
 * renders the queue is deliberately incapable of emptying it.
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

export function createQuarantineQueue(): QuarantineQueue {
  return {
    async held(): Promise<readonly HeldItem[]> {
      // Columns named one by one rather than `select *`: `quarantine_item` also
      // carries `normalised_name` and `document` carries `storage_key`, and
      // both would ride along. AD-10 keeps storage keys inside the storage
      // adapter, and the folded name is a comparison key a treasurer has no use
      // for.
      //
      // `join`, not `left join`: the foreign key with `on delete cascade` means
      // an item without its document cannot exist, and a left join would answer
      // that impossible case with a row whose filename is null — inventing a
      // shape the type says is unreachable.
      //
      // `id` breaks ties on `created_at`, which is not decoration: rows written
      // by one statement share `now()` to the microsecond, and without it the
      // order is whatever the plan happened to produce. Two renders of an
      // unchanged queue would then disagree with each other.
      const { rows } = await getPool().query<HeldItem>(
        `select quarantine_item.document_id  as "documentId",
                document.filename            as "filename",
                quarantine_item.extracted_name as "extractedName"
           from quarantine_item
           join document on document.id = quarantine_item.document_id
          order by quarantine_item.created_at asc, quarantine_item.id asc`,
      )

      return rows
    },
  }
}
