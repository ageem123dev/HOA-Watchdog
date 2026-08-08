/**
 * The payment repository, against the real database.
 *
 * AC3 is the assertion this file exists for: re-ingesting a document replaces
 * what it produced rather than appending. And the part that is easy to get half
 * right — a line either becomes a payment or is held, and both tables must move
 * together, or the document ends up described half by this reading and half by
 * the last.
 */

import { randomBytes } from 'node:crypto'
import { Client, Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { ResolvedLine } from '../../core/payment/resolve-line'
import { createPaymentRepository } from './payment-repository-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const configured = Boolean(writerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn('\n  payment repository tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL must be set.\n')
}

const RUN_PREFIX = `r${randomBytes(4).toString('hex')}`

describeWithDatabase('the payment repository', () => {
  let writer: Client
  let pool: Pool
  let boardMemberId = ''
  let scope = ''

  const named = (suffix: string) => `${RUN_PREFIX}-${scope}-${suffix}`

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    pool = new Pool({ connectionString: writerUrl, max: 4 })

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash)
       values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA')
       returning id`,
      [`payment-repo-${RUN_PREFIX}@example.test`],
    )
    boardMemberId = rows[0]!.id
  })

  beforeEach(() => {
    scope = randomBytes(4).toString('hex')
  })

  afterAll(async () => {
    if (boardMemberId) {
      await writer.query('delete from document where uploaded_by = $1', [boardMemberId])
      await writer.query('delete from board_member where id = $1', [boardMemberId])
    }
    await writer.query('delete from unit where unit_number like $1', [`${RUN_PREFIX}-%`])
    await pool.end()
    await writer.end()
  })

  const newDocument = async (): Promise<string> => {
    const hash = randomBytes(32).toString('hex')
    const { rows } = await writer.query<{ id: string }>(
      `insert into document
         (content_hash, storage_key, filename, content_type, byte_size, uploaded_by)
       values ($1, $2, 'deposits.csv', 'text/csv', 512, $3)
       returning id`,
      [hash, `documents/${hash}`, boardMemberId],
    )
    return rows[0]!.id
  }

  const newUnit = async (suffix = '4B'): Promise<string> => {
    const { rows } = await writer.query<{ id: string }>(
      'insert into unit (unit_number) values ($1) returning id',
      [named(suffix)],
    )
    return rows[0]!.id
  }

  const counts = async (documentId: string) => {
    const { rows } = await writer.query<{ payments: string; held: string }>(
      `select (select count(*) from payment where document_id = $1)::text      as payments,
              (select count(*) from held_payment where document_id = $1)::text as held`,
      [documentId],
    )
    return { payments: rows[0]!.payments, held: rows[0]!.held }
  }

  const attributed = (unitId: string, amount: string, paidOn = '2024-03-01'): ResolvedLine => ({
    kind: 'attributed',
    unitId,
    paidOn,
    amount,
  })

  const held = (reference: string, amount: string, paidOn = '2024-03-01'): ResolvedLine => ({
    kind: 'held',
    unitReference: reference,
    paidOn,
    amount,
    reason: 'unknown-unit',
  })

  it('writes attributed lines as payments and held lines as held payments', async () => {
    const documentId = await newDocument()
    const unitId = await newUnit()

    await createPaymentRepository({ pool }).replace(documentId, [
      attributed(unitId, '120.00'),
      held('9Z', '60.00'),
    ])

    expect(await counts(documentId)).toEqual({ payments: '1', held: '1' })
  })

  it('replaces rather than duplicating when the same document is ingested twice', async () => {
    // AC3, and the assertion this file exists for.
    const documentId = await newDocument()
    const unitId = await newUnit()
    const repository = createPaymentRepository({ pool })

    await repository.replace(documentId, [attributed(unitId, '120.00'), held('9Z', '60.00')])
    await repository.replace(documentId, [attributed(unitId, '120.00'), held('9Z', '60.00')])

    expect(await counts(documentId)).toEqual({ payments: '1', held: '1' })
  })

  it('leaves the second reading present, not the first', async () => {
    // Beside the count above: a replacement that deleted and reinserted the
    // *old* values would keep the counts right and the figures wrong.
    const documentId = await newDocument()
    const unitId = await newUnit()
    const repository = createPaymentRepository({ pool })

    await repository.replace(documentId, [attributed(unitId, '120.00')])
    await repository.replace(documentId, [attributed(unitId, '345.67')])

    const { rows } = await writer.query<{ amount: string }>(
      'select amount from payment where document_id = $1',
      [documentId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.amount).toBe('345.67')
  })

  it('clears held payments too when the second reading resolves them', async () => {
    // The half-replacement this signature exists to prevent. A treasurer names
    // the unit, the document is re-read, and the line is now attributed — if the
    // old held row survived, the same money would appear twice, once as a
    // payment and once as an open question.
    const documentId = await newDocument()
    const unitId = await newUnit()
    const repository = createPaymentRepository({ pool })

    await repository.replace(documentId, [held('9Z', '60.00')])
    expect(await counts(documentId)).toEqual({ payments: '0', held: '1' })

    await repository.replace(documentId, [attributed(unitId, '60.00')])
    expect(await counts(documentId)).toEqual({ payments: '1', held: '0' })
  })

  it('accepts a reading in which every line was held', async () => {
    // An ordinary outcome — an unfamiliar reference format, a new roll — and
    // refusing it would reject a real document.
    const documentId = await newDocument()

    await createPaymentRepository({ pool }).replace(documentId, [
      held('9Z', '60.00'),
      held('8Y', '70.00'),
    ])

    expect(await counts(documentId)).toEqual({ payments: '0', held: '2' })
  })

  it('refuses an entirely empty reading rather than obeying it', async () => {
    // `replace(id, [])` reads identically to "extraction found nothing", and
    // obeying it would destroy a good set on a caller's mistake. The extraction
    // repository records the same reasoning for its own replace.
    const documentId = await newDocument()
    const unitId = await newUnit()
    const repository = createPaymentRepository({ pool })

    await repository.replace(documentId, [attributed(unitId, '120.00')])

    await expect(repository.replace(documentId, [])).rejects.toThrow(RangeError)
    expect(await counts(documentId)).toEqual({ payments: '1', held: '0' })
  })

  it('leaves the previous reading intact when the new one fails midway', async () => {
    // A document holding nothing at all is worse than one holding a stale
    // reading: a treasurer can see that last month's figures are old, and cannot
    // see figures that are absent.
    //
    // The second line names a unit that does not exist, so its insert raises a
    // foreign-key violation *after* the deletes have run.
    const documentId = await newDocument()
    const unitId = await newUnit()
    const repository = createPaymentRepository({ pool })

    await repository.replace(documentId, [attributed(unitId, '120.00'), held('9Z', '60.00')])

    await expect(
      repository.replace(documentId, [
        attributed(unitId, '999.00'),
        attributed('00000000-0000-0000-0000-000000000000', '1.00'),
      ]),
    ).rejects.toMatchObject({ code: '23503' })

    // Unchanged: both rows, and the original amount.
    expect(await counts(documentId)).toEqual({ payments: '1', held: '1' })
    const { rows } = await writer.query<{ amount: string }>(
      'select amount from payment where document_id = $1',
      [documentId],
    )
    expect(rows[0]?.amount).toBe('120.00')
  })

  it('does not touch another document rows', async () => {
    // A delete missing its `where document_id` would pass every test above,
    // because each uses a fresh document.
    const first = await newDocument()
    const second = await newDocument()
    const unitId = await newUnit()
    const repository = createPaymentRepository({ pool })

    await repository.replace(first, [attributed(unitId, '120.00')])
    await repository.replace(second, [attributed(unitId, '340.00')])

    expect(await counts(first)).toEqual({ payments: '1', held: '0' })
    const { rows } = await writer.query<{ amount: string }>(
      'select amount from payment where document_id = $1',
      [first],
    )
    expect(rows[0]?.amount).toBe('120.00')
  })
})
