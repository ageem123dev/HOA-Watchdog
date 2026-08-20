/**
 * Migration 015: what actually arrived, against the unit it settles.
 *
 * The assertion that matters most is the money one. `payment.amount` must be
 * `numeric(14,2)` — the same as `extraction.total_amount` and
 * `assessment.annual_amount` — because epic 4 compares this column against an
 * assessment, and story 2.2's whole decision exists so that comparison needs no
 * conversion.
 */

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { executable } from './executable-sql'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  payment migration tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL must both be set.\n',
  )
}

const CHECK_VIOLATION = '23514'
const FOREIGN_KEY_VIOLATION = '23503'
const NOT_NULL_VIOLATION = '23502'
const INSUFFICIENT_PRIVILEGE = '42501'

/** Four files already write to `unit`; see the note in `unit.test.ts`. */
const RUN_PREFIX = `p${randomBytes(4).toString('hex')}`

const MIGRATION = readFileSync(join(__dirname, '015_payment.sql'), 'utf8')

describe('the migration says what it does', () => {
  it('creates the payment table', () => {
    expect(executable(MIGRATION)).toMatch(/create\s+table\s+payment\s*\(/i)
  })

  it('stores the amount at the same precision and scale as everything else money', () => {
    // The column epic 4 compares against `assessment.annual_amount`. A different
    // precision here would put a conversion inside that comparison, which is the
    // one place story 2.2 decided a fiduciary tool cannot be approximate.
    expect(executable(MIGRATION)).toMatch(/amount\s+numeric\s*\(\s*14\s*,\s*2\s*\)/i)
  })

  it('never declares money as a floating-point type', () => {
    expect(executable(MIGRATION)).not.toMatch(/\b(real|double\s+precision|float\d*)\b/i)
  })

  it('cascades from the document, as extraction does', () => {
    // A payment without its document is debris that still satisfies a foreign
    // key, and the document is the evidence a treasurer would be shown.
    expect(executable(MIGRATION)).toMatch(
      /document_id[^,]*references\s+document\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i,
    )
  })

  it('does not cascade from the unit', () => {
    // Beside the case above, and a different decision: deleting a unit must not
    // silently erase the record of what it paid. Units are not deleted in this
    // system, and if that ever changes it should fail loudly here.
    expect(executable(MIGRATION)).not.toMatch(
      /unit_id[^,]*references\s+unit\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i,
    )
  })

  it('grants select on payment to watchdog_reader', () => {
    expect(executable(MIGRATION)).toMatch(/grant\s+select\s+on\s+payment\s+to\s+watchdog_reader/i)
  })

  it('grants the reader nothing that writes', () => {
    expect(executable(MIGRATION)).not.toMatch(
      /grant\s+[^;]*\b(insert|update|delete|truncate|all)\b[^;]*\bto\s+watchdog_reader/i,
    )
  })

  it('strips comments without eating this migration statements', () => {
    const stripped = executable(MIGRATION)

    expect(stripped).toMatch(/create\s+table\s+payment\s*\(/i)
    expect(stripped).toMatch(/grant\s+select/i)
    expect(stripped.length).toBeLessThan(MIGRATION.length)
  })
})

describeWithDatabase('a payment', () => {
  let writer: Client
  let reader: Client
  let boardMemberId = ''
  let scope = ''

  const named = (suffix: string) => `${RUN_PREFIX}-${scope}-${suffix}`

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    reader = new Client({ connectionString: readerUrl })
    await writer.connect()
    await reader.connect()

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash, association_id) values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA', '00000000-0000-7000-8000-000000000001')
       returning id`,
      [`payment-${RUN_PREFIX}@example.test`],
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
    await writer.end()
    await reader.end()
  })

  const newDocument = async (): Promise<string> => {
    const hash = randomBytes(32).toString('hex')
    const { rows } = await writer.query<{ id: string }>(
      `insert into document (content_hash, storage_key, filename, content_type, byte_size, uploaded_by, association_id) values ($1, $2, 'deposits.csv', 'text/csv', 512, $3, '00000000-0000-7000-8000-000000000001')
       returning id`,
      [hash, `documents/${hash}`, boardMemberId],
    )
    return rows[0]!.id
  }

  const newUnit = async (suffix = '4B'): Promise<string> => {
    const { rows } = await writer.query<{ id: string }>(
      'insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\') returning id',
      [named(suffix)],
    )
    return rows[0]!.id
  }

  const pay = (unitId: string, documentId: string, amount: string, paidOn = '2024-03-01') =>
    writer.query(
      'insert into payment (unit_id, document_id, paid_on, amount, association_id) values ($1, $2, $3::date, $4, \'00000000-0000-7000-8000-000000000001\')',
      [unitId, documentId, paidOn, amount],
    )

  const amountFor = async (unitId: string) => {
    const { rows } = await writer.query<{ amount: string }>(
      'select amount from payment where unit_id = $1',
      [unitId],
    )
    return rows[0]?.amount
  }

  it('records what arrived, exactly as given', async () => {
    // Reverse-it, and the money assertion. A string, because `numeric` crosses
    // as a decimal string — a float would return 1234.5599999999999 and a
    // `number` would erase the difference between 120 and 120.00.
    const unitId = await newUnit()

    await pay(unitId, await newDocument(), '1234.56')

    expect(await amountFor(unitId)).toBe('1234.56')
  })

  it('keeps the trailing zero the scale implies', async () => {
    const unitId = await newUnit()

    await pay(unitId, await newDocument(), '120')

    expect(await amountFor(unitId)).toBe('120.00')
  })

  it('carries the declared column type, not merely a value that looks right', async () => {
    // Cross-check by an independent route: the round trip above passes against
    // numeric(20,4) too. This pins the declaration, read from the catalog rather
    // than from the migration text.
    const { rows } = await writer.query<{
      data_type: string
      numeric_precision: number
      numeric_scale: number
    }>(
      `select data_type, numeric_precision, numeric_scale
         from information_schema.columns
        where table_name = 'payment' and column_name = 'amount'`,
    )

    expect(rows[0]).toMatchObject({ data_type: 'numeric', numeric_precision: 14, numeric_scale: 2 })
  })

  it('matches the precision of the column it will be compared against', async () => {
    // The reason the two match is epic 4's comparison. Asserted against
    // `assessment.annual_amount` directly, so that changing one and not the
    // other fails here rather than in an arrears finding a year later.
    const { rows } = await writer.query<{ table_name: string; numeric_precision: number; numeric_scale: number }>(
      `select table_name, numeric_precision, numeric_scale
         from information_schema.columns
        where (table_name = 'payment' and column_name = 'amount')
           or (table_name = 'assessment' and column_name = 'annual_amount')
        order by table_name`,
    )

    expect(rows).toHaveLength(2)
    expect(rows[0]?.numeric_precision).toBe(rows[1]?.numeric_precision)
    expect(rows[0]?.numeric_scale).toBe(rows[1]?.numeric_scale)
  })

  it('accepts the smallest amount above zero', async () => {
    const unitId = await newUnit()

    await pay(unitId, await newDocument(), '0.01')

    expect(await amountFor(unitId)).toBe('0.01')
  })

  it('refuses a payment of zero', async () => {
    const unitId = await newUnit()

    await expect(pay(unitId, await newDocument(), '0')).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    })
  })

  it('refuses a negative payment, because reversals are out of scope', async () => {
    // Recorded rather than silently permitted. A reversal needs a decision about
    // whether it offsets a payment or stands as its own row, and that belongs
    // with whoever builds refunds.
    const unitId = await newUnit()

    await expect(pay(unitId, await newDocument(), '-1.00')).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    })
  })

  it('requires a date', async () => {
    const unitId = await newUnit()
    const documentId = await newDocument()

    await expect(
      writer.query(
        'insert into payment (unit_id, document_id, paid_on, amount, association_id) values ($1, $2, null, $3, \'00000000-0000-7000-8000-000000000001\')',
        [unitId, documentId, '120.00'],
      ),
    ).rejects.toMatchObject({ code: NOT_NULL_VIOLATION })
  })

  it('refuses a payment for a unit that does not exist', async () => {
    await expect(
      pay('00000000-0000-0000-0000-000000000000', await newDocument(), '120.00'),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION })
  })

  it('refuses a payment for a document that does not exist', async () => {
    // Asserted separately from the unit key: one test covering "a bad reference"
    // would pass with either key missing.
    const unitId = await newUnit()

    await expect(
      pay(unitId, '00000000-0000-0000-0000-000000000000', '120.00'),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION })
  })

  it('goes when its document goes', async () => {
    // The cascade. A payment whose document was deleted is debris that still
    // satisfies a foreign key.
    const unitId = await newUnit()
    const documentId = await newDocument()
    await pay(unitId, documentId, '120.00')

    await writer.query('delete from document where id = $1', [documentId])

    const { rows } = await writer.query<{ n: string }>(
      'select count(*)::text n from payment where unit_id = $1',
      [unitId],
    )
    expect(rows[0]?.n).toBe('0')
  })

  it('records two payments for one unit in one month', async () => {
    // Deliberately not unique on (unit_id, paid_on): a unit may pay twice, and
    // a constraint forbidding it would reject a legitimate deposit.
    const unitId = await newUnit()
    const documentId = await newDocument()

    await pay(unitId, documentId, '60.00', '2024-03-01')
    await pay(unitId, documentId, '60.00', '2024-03-15')

    const { rows } = await writer.query<{ n: string }>(
      'select count(*)::text n from payment where unit_id = $1',
      [unitId],
    )
    expect(rows[0]?.n).toBe('2')
  })

  it('lets watchdog_reader read it but not write it', async () => {
    // AD-4: a payment that existed because a model asked for one would clear an
    // arrears finding that should have stood.
    const unitId = await newUnit()
    const documentId = await newDocument()
    await pay(unitId, documentId, '120.00')

    const { rows } = await reader.query<{ amount: string }>(
      'select amount from payment where unit_id = $1',
      [unitId],
    )
    expect(rows[0]?.amount).toBe('120.00')

    await expect(
      reader.query(
        'insert into payment (unit_id, document_id, paid_on, amount, association_id) values ($1, $2, $3::date, $4, \'00000000-0000-7000-8000-000000000001\')',
        [unitId, documentId, '2024-04-01', '1.00'],
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
  })
})
