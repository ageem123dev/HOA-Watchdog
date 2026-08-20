/**
 * The held-payment queue, against the real database.
 *
 * The connection test beside this one mocks `pg`, so until this file existed the
 * query was never executed at all — a malformed column name or a bad `to_char`
 * would have passed every test in the repo. Raised by review.
 */

import { randomBytes } from 'node:crypto'
import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createHeldPaymentQueue } from './held-payment-queue-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn('\n  held payment queue tests SKIPPED: both database URLs must be set.\n')
}

const RUN_PREFIX = `q${randomBytes(4).toString('hex')}`

describeWithDatabase('the held payment queue', () => {
  let writer: Client
  let readerPool: Pool
  let boardMemberId = ''

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    readerPool = new Pool({ connectionString: readerUrl, max: 2 })

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash, association_id) values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA', '00000000-0000-7000-8000-000000000001')
       returning id`,
      [`held-queue-${RUN_PREFIX}@example.test`],
    )
    boardMemberId = rows[0]!.id
  })

  afterAll(async () => {
    if (boardMemberId) {
      await writer.query('delete from document where uploaded_by = $1', [boardMemberId])
      await writer.query('delete from board_member where id = $1', [boardMemberId])
    }
    await readerPool.end()
    await writer.end()
  })

  const newDocument = async (filename: string): Promise<string> => {
    const hash = randomBytes(32).toString('hex')
    const { rows } = await writer.query<{ id: string }>(
      `insert into document (content_hash, storage_key, filename, content_type, byte_size, uploaded_by, association_id) values ($1, $2, $3, 'text/csv', 512, $4, '00000000-0000-7000-8000-000000000001')
       returning id`,
      [hash, `documents/${hash}`, filename, boardMemberId],
    )
    return rows[0]!.id
  }

  it('answers with every field a human needs to resolve the line', async () => {
    // Including the filename, which is what a treasurer recognises — and
    // deliberately not the storage key or the folded reference.
    const documentId = await newDocument(`${RUN_PREFIX}-march.csv`)
    await writer.query(
      `insert into held_payment (document_id, unit_reference, paid_on, amount, hold_reason, association_id) values ($1, '  9z Upper ', '2024-05-04'::date, '61.23', 'unknown-unit', '00000000-0000-7000-8000-000000000001')`,
      [documentId],
    )

    const held = (await createHeldPaymentQueue({ pool: readerPool }).held()).filter(
      (h) => h.documentId === documentId,
    )

    expect(held).toEqual([
      {
        documentId,
        filename: `${RUN_PREFIX}-march.csv`,
        unitReference: '  9z Upper ',
        paidOn: '2024-05-04',
        amount: '61.23',
        reason: 'unknown-unit',
      },
    ])
  })

  it('returns the date as a calendar date and the amount as a decimal string', async () => {
    // `pg` maps a Postgres `date` to a JS `Date` at local midnight, which moves
    // the day west of UTC, and a coerced `numeric` loses its scale.
    const documentId = await newDocument(`${RUN_PREFIX}-types.csv`)
    await writer.query(
      `insert into held_payment (document_id, unit_reference, paid_on, amount, hold_reason, association_id) values ($1, '4B', '2024-01-01'::date, '120.00', 'unknown-unit', '00000000-0000-7000-8000-000000000001')`,
      [documentId],
    )

    const [held] = (await createHeldPaymentQueue({ pool: readerPool }).held()).filter(
      (h) => h.documentId === documentId,
    )

    expect(typeof held?.paidOn).toBe('string')
    expect(held?.paidOn).toBe('2024-01-01')
    expect(held?.amount).toBe('120.00')
  })

  it('reports absence as null rather than inventing a value', async () => {
    const documentId = await newDocument(`${RUN_PREFIX}-partial.csv`)
    await writer.query(
      `insert into held_payment (document_id, unit_reference, paid_on, amount, hold_reason, association_id) values ($1, '4B', null, '120.00', 'missing-date', '00000000-0000-7000-8000-000000000001')`,
      [documentId],
    )

    const [held] = (await createHeldPaymentQueue({ pool: readerPool }).held()).filter(
      (h) => h.documentId === documentId,
    )

    expect(held?.paidOn).toBeNull()
    expect(held?.reason).toBe('missing-date')
  })
})
