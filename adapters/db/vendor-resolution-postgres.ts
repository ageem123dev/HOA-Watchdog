import type { PoolClient } from 'pg'

import type {
  AlreadyResolved,
  VendorCreated,
  VendorMatched,
  VendorResolution,
} from '../../core/ports/vendor-resolution'
import { writerPool } from './pool'

/**
 * The `VendorResolution` port backed by Postgres.
 *
 * On the **writer** connection. The queue adapter beside this one uses the
 * reader because it only reads; this is the one path in epic story 1.6 that
 * writes on a human's instruction, and AD-4 puts writes on `watchdog_writer`.
 * No migration grants it: migration 002's `alter default privileges` already
 * covers tables created later, which is exactly why it is written that way.
 *
 * Every resolution is one transaction, and that is the whole design. The
 * dangerous half-state is a hold deleted without a vendor recorded: the document
 * leaves the queue, no surface ever asks about it again, and the treasurer's
 * decision was silently discarded. The reverse — a vendor created with the hold
 * still standing — is merely untidy, because the next attempt matches it.
 */

/**
 * Run `work` inside a transaction, rolling back on any throw.
 *
 * The `finally` is what keeps the pool alive: a client not released on the error
 * path is a client gone forever, and at `max: 5` that is five failed
 * resolutions from a dead adapter.
 */
async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await writerPool().connect()
  let released = false

  try {
    // Stated, not inherited. `default_transaction_isolation` is server
    // configuration, and `confirmAsNew`'s conflict-then-select is only correct
    // under `read committed`: it needs a fresh snapshot to see the row that won
    // the race. Under `repeatable read` that select uses the transaction
    // snapshot, cannot see the concurrently committed vendor, and rolls back a
    // confirmation that was correct. Raised in review.
    await client.query('begin isolation level read committed')
    const result = await work(client)
    await client.query('commit')
    return result
  } catch (error) {
    let rollbackFailed = false

    await client.query('rollback').catch(() => {
      // The rollback itself can fail when the connection is already gone. The
      // original error is still the one worth reporting.
      rollbackFailed = true
    })

    // Released with a truthy argument so `pg` destroys the client rather than
    // returning it to the pool: a connection whose rollback failed may still be
    // inside a transaction, and the next borrower would inherit it. Raised in
    // review.
    client.release(rollbackFailed ? (error instanceof Error ? error : new Error('rollback failed')) : undefined)
    released = true

    throw error
  } finally {
    if (!released) client.release()
  }
}

/**
 * Clear this document's hold on this name, reporting whether there was one.
 *
 * Keyed on the *normalised* name, matching the unique index the hold was written
 * under, so a second spelling of a name already answered is recognised as the
 * same question. And on the name as well as the document: one document held for
 * two unrecognised vendors is two questions, and answering one must not answer
 * the other.
 */
async function clearHold(
  client: PoolClient,
  documentId: string,
  extractedName: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `delete from quarantine_item
      where document_id = $1
        and normalised_name = vendor_normalised_name($2)`,
    [documentId, extractedName],
  )

  return (rowCount ?? 0) > 0
}

export function createVendorResolution(): VendorResolution {
  return {
    async confirmAsNew(
      documentId: string,
      extractedName: string,
    ): Promise<VendorCreated | VendorMatched | AlreadyResolved> {
      return inTransaction(async (client) => {
        // The hold goes first so its absence settles the question before any
        // vendor is written: without this, a second confirmation of an already
        // answered item creates a duplicate identity for a name somebody has
        // already decided.
        if (!(await clearHold(client, documentId, extractedName))) {
          return { outcome: 'already-resolved' }
        }

        // `do nothing` rather than letting 23505 escape. Two treasurers
        // confirming the same new name have both answered correctly, and the one
        // whose insert loses the race should end up pointing at the other's row
        // — not looking at a constraint violation. The same path covers a single
        // treasurer confirming a name that normalises onto a vendor already
        // recorded.
        const inserted = await client.query<{ id: string }>(
          // A vendor belongs to the association whose document named it.
          // Derived rather than passed so the two cannot disagree.
          `insert into vendor (display_name, association_id)
           select $1, parent.association_id
             from document as parent
            where parent.id = $2
           on conflict (normalised_name) do nothing
           returning id`,
          [extractedName, documentId],
        )

        const createdId = inserted.rows[0]?.id
        if (createdId !== undefined) return { outcome: 'created', vendorId: createdId }

        const existing = await client.query<{ id: string }>(
          'select id from vendor where normalised_name = vendor_normalised_name($1)',
          [extractedName],
        )

        const matchedId = existing.rows[0]?.id
        if (matchedId === undefined) {
          // Neither inserted nor found. Something is wrong with the assumption
          // that the conflict was on this name, and continuing would clear a
          // hold with no identity recorded — the one outcome this file exists to
          // prevent. Fail, and let the transaction roll the hold back.
          throw new Error(
            `vendor for ${JSON.stringify(extractedName)} was neither created nor found`,
          )
        }

        return { outcome: 'matched', vendorId: matchedId }
      })
    },

    async matchToExisting(
      documentId: string,
      extractedName: string,
      vendorId: string,
    ): Promise<VendorMatched | AlreadyResolved> {
      return inTransaction(async (client) => {
        // Checked before the hold is cleared. An id that names nothing would
        // otherwise take the document out of the queue pointing at no identity,
        // which is the same silent loss as clearing a hold with no vendor.
        //
        // A malformed id raises 22P02 from here and is left to escape: that is a
        // fault at the call site, not a treasurer's mistake, and reporting it as
        // "no such vendor" would hide a bug in whatever built the form.
        //
        // `for key share` and not a bare select: without the lock this proves
        // only that the vendor existed at the moment it was read. A concurrent
        // transaction may delete it before this one commits, and the hold is
        // then cleared pointing at a vendor that is gone — the failure this
        // check exists to prevent, reached one step later. Raised in review.
        // The weakest lock that blocks deletion; it does not block other
        // readers, and two treasurers resolving different documents onto the
        // same vendor do not queue behind each other.
        const { rows } = await client.query<{ id: string }>(
          'select id from vendor where id = $1 for key share',
          [vendorId],
        )

        if (rows.length === 0) throw new Error(`no vendor with id ${vendorId}`)

        if (!(await clearHold(client, documentId, extractedName))) {
          return { outcome: 'already-resolved' }
        }

        // Nothing is inserted on this path, and there is no branch that could.
        // AC2's "no vendor is created" is a property of the code's shape here,
        // not of a flag somebody could pass.
        return { outcome: 'matched', vendorId }
      })
    },
  }
}
