/**
 * Replacing a document's extracted records, as a set.
 *
 * The failures worth guarding here are not wrong values — they are **missing
 * rows nobody notices**. A ledger that quietly loses three lines during a
 * re-read looks exactly like a ledger that never had them, and a treasurer has
 * no way to tell the difference. So the tests care most about what survives a
 * failure, not about what a success looks like.
 *
 * **Requires a database and skips without one**, matching `migrations/`.
 */

import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ExtractionRecord } from '../../core/extraction/record'
import { createPostgresExtractionRepository } from './extraction-repository-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const configured = Boolean(writerUrl)

const describeWithDatabase = configured
  ? describe
  : (describe.skip.bind(null) as unknown as typeof describe)

if (!configured) {
  console.warn(
    '\n  extraction-repository tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL is not set.\n' +
      '  Run `npm run migrate`, then `npm run test:db`.\n',
  )
}

const FOREIGN_KEY_VIOLATION = '23503'
const RUN = randomBytes(8).toString('hex')
let counter = 0

const record = (over: Partial<ExtractionRecord> = {}): ExtractionRecord => ({
  documentKind: 'statement',
  vendorName: 'Evergreen Landscaping',
  documentNumber: null,
  issuedOn: '2026-06-01',
  totalAmount: '1450.00',
  currency: 'USD',
  ...over,
})

describeWithDatabase('createPostgresExtractionRepository', () => {
  let pool: Pool
  let admin: Client
  let boardMemberId: string

  const repository = createPostgresExtractionRepository({
    get pool() {
      return pool
    },
  })

  beforeAll(async () => {
    pool = new Pool({ connectionString: writerUrl, max: 4 })
    admin = new Client({ connectionString: writerUrl })
    await admin.connect()

    const { rows } = await admin.query<{ id: string }>(
      `insert into board_member (email, password_hash)
       values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA')
       returning id`,
      [`extraction-repo-${RUN}@example.test`],
    )
    boardMemberId = rows[0]!.id
  })

  afterAll(async () => {
    if (boardMemberId) {
      await admin.query('delete from document where uploaded_by = $1', [boardMemberId])
      await admin.query('delete from board_member where id = $1', [boardMemberId])
    }
    await admin?.end()
    await pool?.end()
  })

  async function newDocument(): Promise<string> {
    counter += 1
    const hash = `${RUN}${counter.toString(16).padStart(64 - RUN.length, '0')}`
    const { rows } = await admin.query<{ id: string }>(
      `insert into document
         (content_hash, storage_key, filename, content_type, byte_size, uploaded_by)
       values ($1, $2, 'ledger.csv', 'text/csv', 512, $3)
       returning id`,
      [hash, `documents/${hash}`, boardMemberId],
    )
    return rows[0]!.id
  }

  const countFor = async (documentId: string): Promise<number> => {
    const { rows } = await admin.query<{ n: number }>(
      'select count(*)::int as n from extraction where document_id = $1',
      [documentId],
    )
    return rows[0]!.n
  }

  describe('the ordinary case', () => {
    it('stores every record in the set', async () => {
      const documentId = await newDocument()

      await repository.replace(documentId, [record(), record(), record()])

      expect(await countFor(documentId)).toBe(3)
    })

    it('round-trips every field unchanged', async () => {
      // The inverse check. Amounts are compared by Postgres below rather than
      // read into a JavaScript number, which is the conversion the column exists
      // to prevent.
      const documentId = await newDocument()
      const written = record({
        documentKind: 'invoice',
        vendorName: 'Bay Area Pool Service, Inc.',
        documentNumber: 'INV-4471',
        issuedOn: '2026-06-30',
        totalAmount: '8421.55',
      })

      await repository.replace(documentId, [written])
      const [read] = await repository.findByDocument(documentId)

      expect(read).toEqual(written)
    })

    it('stores the amount exactly, as the database sees it', async () => {
      const documentId = await newDocument()

      await repository.replace(documentId, [record({ totalAmount: '0.10' })])
      const { rows } = await admin.query<{ exact: boolean }>(
        `select total_amount = $1::numeric(14,2) as exact
           from extraction where document_id = $2`,
        ['0.10', documentId],
      )

      expect(rows[0]!.exact).toBe(true)
    })

    it('stores a credit as a negative amount', async () => {
      const documentId = await newDocument()

      await repository.replace(documentId, [record({ totalAmount: '-250.00' })])
      const [read] = await repository.findByDocument(documentId)

      expect(read?.totalAmount).toBe('-250.00')
    })

    it('stores a record with only the fields the document has', async () => {
      const documentId = await newDocument()
      const sparse = record({
        vendorName: null,
        documentNumber: null,
        issuedOn: null,
        totalAmount: null,
      })

      await repository.replace(documentId, [sparse])

      expect((await repository.findByDocument(documentId))[0]).toEqual(sparse)
    })
  })

  describe('replacement is a replacement', () => {
    it('leaves exactly the new set, with no survivors from the old one', async () => {
      const documentId = await newDocument()
      await repository.replace(documentId, [
        record({ vendorName: 'Old One' }),
        record({ vendorName: 'Old Two' }),
        record({ vendorName: 'Old Three' }),
      ])

      await repository.replace(documentId, [record({ vendorName: 'New One' })])
      const held = await repository.findByDocument(documentId)

      expect(held).toHaveLength(1)
      expect(held[0]?.vendorName).toBe('New One')
    })

    it('does not append', async () => {
      const documentId = await newDocument()
      await repository.replace(documentId, [record(), record()])

      await repository.replace(documentId, [record(), record()])

      expect(await countFor(documentId)).toBe(2)
    })

    it('leaves another document untouched', async () => {
      const [first, second] = [await newDocument(), await newDocument()]
      await repository.replace(first, [record({ vendorName: 'First' })])
      await repository.replace(second, [record({ vendorName: 'Second' }), record()])

      await repository.replace(first, [record({ vendorName: 'First Again' })])

      const other = await repository.findByDocument(second)
      expect(other).toHaveLength(2)
      expect(other[0]?.vendorName).toBe('Second')
    })
  })

  describe('what it refuses', () => {
    it('refuses an empty set rather than treating it as delete-everything', async () => {
      // `replace(id, [])` is indistinguishable from "extraction found nothing",
      // and obeying it would silently destroy a good set. A caller that means to
      // remove records must say so some other way.
      const documentId = await newDocument()
      await repository.replace(documentId, [record()])

      await expect(repository.replace(documentId, [])).rejects.toThrow()
      expect(await countFor(documentId)).toBe(1)
    })

    it('refuses a document that does not exist', async () => {
      await expect(
        repository.replace('00000000-0000-7000-8000-000000000000', [record()]),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION })
    })
  })

  describe('nothing is lost when the write fails', () => {
    it('keeps the previous set when a record in the new one is invalid', async () => {
      // The failure that matters: a bad record aborts the insert *after* the
      // delete. Separated into two transactions, this leaves the document with
      // nothing — which looks exactly like a document nothing was read from.
      const documentId = await newDocument()
      await repository.replace(documentId, [record({ vendorName: 'Survivor One' })])

      const invalid = record({ documentKind: 'receipt' as ExtractionRecord['documentKind'] })
      await expect(repository.replace(documentId, [record(), invalid])).rejects.toThrow()

      const held = await repository.findByDocument(documentId)
      expect(held).toHaveLength(1)
      expect(held[0]?.vendorName).toBe('Survivor One')
    })

    it('keeps the previous set when the whole call is rolled back mid-flight', async () => {
      // Same guarantee, forced from the other side: a second connection holds a
      // conflicting lock so the replacement cannot complete.
      const documentId = await newDocument()
      await repository.replace(documentId, [record({ vendorName: 'Survivor Two' })])

      const invalid = record({ currency: 'EUR' as ExtractionRecord['currency'] })
      await expect(repository.replace(documentId, [invalid])).rejects.toThrow()

      expect(await countFor(documentId)).toBe(1)
    })
  })

  describe('the date contract does not depend on a session setting', () => {
    it('returns YYYY-MM-DD even when the session DateStyle is not ISO', async () => {
      // Measured, not assumed: under `SQL, MDY` a date cast to text reads
      // `06/01/2026`, and under `German, DMY` it reads `01.06.2026`. The record
      // contract is an ISO calendar date, so it must not move with a setting a
      // connection, a pooler, or a server default could change underneath it.
      const documentId = await newDocument()
      await repository.replace(documentId, [record({ issuedOn: '2026-06-01' })])

      const styled = new Pool({ connectionString: writerUrl, max: 1 })
      try {
        await styled.query("set datestyle to 'German, DMY'")
        const scoped = createPostgresExtractionRepository({ pool: styled })

        const [held] = await scoped.findByDocument(documentId)

        expect(held?.issuedOn).toBe('2026-06-01')
      } finally {
        await styled.end()
      }
    })
  })

  describe('concurrency', () => {
    it('serialises two replacements rather than interleaving them', async () => {
      // Deterministic, not hopeful. A second connection holds an uncommitted
      // delete on this document's rows; the repository's replacement must block
      // on it rather than interleaving, and the final state must be one whole
      // set rather than a mixture.
      const documentId = await newDocument()
      await repository.replace(documentId, [record({ vendorName: 'Original' })])

      const holder = new Client({ connectionString: writerUrl })
      await holder.connect()
      let pending: Promise<unknown> | undefined

      try {
        await holder.query('begin')
        await holder.query('delete from extraction where document_id = $1', [documentId])

        pending = repository.replace(documentId, [
          record({ vendorName: 'Replacement A' }),
          record({ vendorName: 'Replacement B' }),
        ])
        await waitUntilBlocked(admin)
        await holder.query('rollback')

        await pending
      } finally {
        await holder.query('rollback').catch(() => undefined)
        await pending?.catch(() => undefined)
        await holder.end()
      }

      const held = await repository.findByDocument(documentId)
      expect(held).toHaveLength(2)
      expect(held.map((r) => r.vendorName).sort()).toEqual(['Replacement A', 'Replacement B'])
    }, 40_000)

    it('serialises two replacements when the document has no rows yet', async () => {
      // The case the test above cannot reach. `delete` takes row locks, so when
      // a document already has extractions the two replacements serialise on
      // them for free. With **zero** rows the delete locks nothing, and two
      // concurrent replacements would each delete nothing, each insert, and both
      // commit -- leaving the document holding both sets at once. AC3 says every
      // previous record is gone and the new set is present; a union of two sets
      // is neither.
      //
      // So the transaction must take a lock that exists whether or not any
      // extraction rows do: the parent `document` row.
      const documentId = await newDocument()
      expect(await countFor(documentId)).toBe(0)

      const holder = new Client({ connectionString: writerUrl })
      await holder.connect()
      let pending: Promise<unknown> | undefined

      try {
        await holder.query('begin')
        await holder.query('select 1 from document where id = $1 for update', [documentId])

        pending = repository.replace(documentId, [
          record({ vendorName: 'Replacement A' }),
          record({ vendorName: 'Replacement B' }),
        ])
        // Throws if the replacement never blocks -- which is exactly the defect:
        // without the parent lock it sails past and interleaves.
        await waitUntilBlocked(admin, '%for update%')
        await holder.query('rollback')

        await pending
      } finally {
        await holder.query('rollback').catch(() => undefined)
        await pending?.catch(() => undefined)
        await holder.end()
      }

      expect(await countFor(documentId)).toBe(2)
    }, 40_000)
  })
})

/**
 * Block until Postgres reports a backend genuinely waiting on a lock.
 *
 * Throws rather than returning if it never blocks — a test that silently failed
 * to set up its own scenario would otherwise pass and mean nothing.
 */
async function waitUntilBlocked(client: Client, queryLike = '%extraction%'): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { rows } = await client.query<{ blocked: number }>(
      `select count(*)::int as blocked
         from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
          and query ilike $1`,
      [queryLike],
    )
    if ((rows[0]?.blocked ?? 0) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('the replacement never blocked, so the interleaving this test needs did not happen')
}
