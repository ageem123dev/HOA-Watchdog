import { Pool, type PoolClient } from 'pg'

import type { ExtractionRecord } from '../../core/extraction/record'
import { StaleExtractionClaimError } from '../../core/ports/document-repository'
import type { ExtractionRepository } from '../../core/ports/extraction-repository'
import { writerPool } from './pool'

/**
 * The `ExtractionRepository` port backed by Postgres.
 *
 * Reached through the **writer** role (AD-4). The interesting decision is the
 * transaction: delete and insert are one unit of work, because separating them
 * means a failure in between leaves a document holding *no* records where it
 * held a full set — and a ledger missing three lines looks exactly like a ledger
 * that never had them. Nothing tells the treasurer which happened.
 *
 * So the destructive part and the fallible part share a fate: either the whole
 * new set lands, or the previous one is still there afterwards.
 */

export interface PostgresExtractionRepositoryOptions {
  /** Injected by tests; production uses the shared pool. */
  readonly pool?: Pool
}

interface ExtractionRow {
  document_kind: string
  vendor_name: string | null
  document_number: string | null
  issued_on_text: string | null
  total_amount: string | null
  unit_reference: string | null
  currency: string
}

export function createPostgresExtractionRepository(
  options: PostgresExtractionRepositoryOptions = {},
): ExtractionRepository {
  const pool = () => options.pool ?? writerPool()

  return {
    async replace(
      documentId: string,
      records: readonly ExtractionRecord[],
      fence?: { readonly token: string },
    ): Promise<void> {
      // An empty set is refused rather than obeyed. `replace(id, [])` reads
      // identically to "extraction found nothing", and obeying it would destroy
      // a good set on a caller's mistake. Clearing a document's records is a
      // different intention and needs a different method to say so.
      if (records.length === 0) {
        throw new RangeError(
          'replace requires at least one record; clearing a document needs a deliberate removal',
        )
      }

      const client: PoolClient = await pool().connect()
      // Tracks whether the catch already released, so `finally` does not release
      // a second time — a double release is its own pool corruption.
      let released = false

      try {
        await client.query('begin')

        // Lock the parent row before touching anything. The delete below takes
        // row locks on the extractions it removes, which serialises two
        // replacements against each other — but only when there are rows to
        // lock. On a document with none, both transactions delete nothing, both
        // insert, and both commit, leaving the document holding two sets at
        // once. AC3 says every previous record is gone and the new set is
        // present; a union of two sets is neither. The `document` row exists in
        // both cases, so locking it is what makes replacement serialise
        // regardless of what the document already holds.
        // The fence is checked *inside* this transaction, in the same statement
        // that takes the lock. Checked outside, or before `begin`, there would
        // be a window in which the claim expires between the check and the
        // write — which is the exact gap the fence exists to close.
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

        await client.query('delete from extraction where document_id = $1', [documentId])

        for (const record of records) {
          await client.query(
            // `association_id` comes from the parent document rather than a
            // parameter: a caller cannot supply the wrong one.
            `insert into extraction
               (document_id, document_kind, vendor_name, document_number,
                issued_on, total_amount, unit_reference, currency, association_id)
             select $1, $2, $3, $4, $5, $6, $7, $8, parent.association_id
               from document as parent
              where parent.id = $1`,
            [
              documentId,
              record.documentKind,
              record.vendorName,
              record.documentNumber,
              record.issuedOn,
              record.totalAmount,
              record.unitReference,
              record.currency,
            ],
          )
        }

        // The state moves in the same transaction as the rows it describes.
        // Committed separately, a crash between them leaves `read` with nothing
        // to show or a full set of records still reading `held` -- and story
        // 1.5d's AC3 turns on those never disagreeing.
        await client.query(
          `update document
              set extraction_state = 'read',
                  extraction_claim_token = null,
                  extraction_claim_expires_at = null
            where id = $1`,
          [documentId],
        )

        await client.query('commit')
      } catch (error) {
        // The rollback is what makes the previous set survive. Without it the
        // delete stands and the document is left empty — the failure this whole
        // method is shaped around.
        //
        // **If the rollback itself fails the connection is still inside a
        // transaction**, and releasing it normally hands a poisoned client to the
        // next caller. `release(true)` tells `pg` to destroy it instead. The
        // three other transactional writers here — payment, roll and
        // vendor-resolution — already did this; the swallowed `.catch()` on this
        // one lost the signal entirely.
        //
        // Pre-existing, and **this change is what makes it matter**: that client
        // used to return to this module's own pool, and now returns to the
        // writer pool nine adapters share. Raised by Argus.
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

    async findByDocument(documentId: string): Promise<readonly ExtractionRecord[]> {
      // `issued_on` is read as text: letting the driver build a Date and
      // formatting it back introduces a timezone shift, and the record's
      // contract is an ISO calendar date rather than an instant.
      //
      // `to_char`, not `::text`. Casting a date to text renders it through the
      // session's `DateStyle`, which is a *setting* — under `SQL, MDY` the same
      // date reads `06/01/2026` and under `German, DMY` it reads `01.06.2026`.
      // Both were measured against this database, not assumed. The record's
      // contract is `YYYY-MM-DD`, so the format is stated here rather than
      // inherited from whatever the connection happens to be configured with.
      const { rows } = await pool().query<ExtractionRow>(
        `select document_kind, vendor_name, document_number,
                to_char(issued_on, 'YYYY-MM-DD') as issued_on_text,
                total_amount, unit_reference, currency
           from extraction
          where document_id = $1
          order by extracted_at, id`,
        [documentId],
      )

      return rows.map((row) => ({
        documentKind: row.document_kind as ExtractionRecord['documentKind'],
        vendorName: row.vendor_name,
        documentNumber: row.document_number,
        issuedOn: row.issued_on_text,
        totalAmount: row.total_amount,
        unitReference: row.unit_reference,
        currency: row.currency as ExtractionRecord['currency'],
      }))
    },
  }
}
