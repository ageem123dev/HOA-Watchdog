import { Pool, type PoolClient } from 'pg'

import type { ExtractionRecord } from '../../core/extraction/record'
import type { ExtractionRepository } from '../../core/ports/extraction-repository'
import { readWriterDatabaseUrl } from '../auth/env'

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

    sharedPool.on('error', (error) => {
      console.error('[extraction-repository] idle client error; the pool will discard it', error)
    })
  }

  return sharedPool
}

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
  currency: string
}

export function createPostgresExtractionRepository(
  options: PostgresExtractionRepositoryOptions = {},
): ExtractionRepository {
  const pool = () => options.pool ?? getPool()

  return {
    async replace(documentId: string, records: readonly ExtractionRecord[]): Promise<void> {
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

      try {
        await client.query('begin')
        await client.query('delete from extraction where document_id = $1', [documentId])

        for (const record of records) {
          await client.query(
            `insert into extraction
               (document_id, document_kind, vendor_name, document_number,
                issued_on, total_amount, currency)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              documentId,
              record.documentKind,
              record.vendorName,
              record.documentNumber,
              record.issuedOn,
              record.totalAmount,
              record.currency,
            ],
          )
        }

        await client.query('commit')
      } catch (error) {
        // The rollback is what makes the previous set survive. Without it the
        // delete stands and the document is left empty — the failure this whole
        // method is shaped around.
        await client.query('rollback').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },

    async findByDocument(documentId: string): Promise<readonly ExtractionRecord[]> {
      // `issued_on` is read as text: letting the driver build a Date and
      // formatting it back introduces a timezone shift, and the record's
      // contract is an ISO calendar date rather than an instant.
      const { rows } = await pool().query<ExtractionRow>(
        `select document_kind, vendor_name, document_number,
                issued_on::text as issued_on_text, total_amount, currency
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
        currency: row.currency as ExtractionRecord['currency'],
      }))
    },
  }
}
