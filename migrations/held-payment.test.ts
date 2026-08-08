/**
 * Migration 016: a deposit line whose unit could not be identified.
 *
 * The decision this table embodies is a separation, and the tests assert it
 * directly: unit identity is folded by `unit_normalised_number()`, never by
 * `vendor_normalised_name()`. Migration 011 refused that coupling because a
 * later change to how vendor names are matched would otherwise silently change
 * which units are considered the same unit.
 */

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { executable } from './executable-sql'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  held payment migration tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL must both be set.\n',
  )
}

const CHECK_VIOLATION = '23514'
const FOREIGN_KEY_VIOLATION = '23503'
const INSUFFICIENT_PRIVILEGE = '42501'

const RUN_PREFIX = `h${randomBytes(4).toString('hex')}`

const MIGRATION = readFileSync(join(__dirname, '016_held_payment.sql'), 'utf8')

describe('the migration says what it does', () => {
  it('creates the held payment table', () => {
    expect(executable(MIGRATION)).toMatch(/create\s+table\s+held_payment\s*\(/i)
  })

  it('folds the reference with the unit normaliser', () => {
    // The separation this table exists to preserve. Asserted as what the
    // generated column *calls* — an allow-list on the dependency, not a
    // deny-list on a word appearing somewhere. Story 2.1 shipped the deny-list
    // version and it failed on a `comment on` literal; task 1 of this story
    // shipped it again.
    expect(executable(MIGRATION)).toMatch(
      /generated\s+always\s+as\s*\(\s*unit_normalised_number\s*\(\s*unit_reference\s*\)\s*\)\s+stored/i,
    )
  })

  it('stores the amount at the same precision as a payment', () => {
    // A held line becomes a payment unchanged once a human names its unit, so
    // the amount must survive the move without conversion.
    expect(executable(MIGRATION)).toMatch(/amount\s+numeric\s*\(\s*14\s*,\s*2\s*\)/i)
  })

  it('does not make the reference unique within a document', () => {
    // One deposit can carry two unresolved lines for the same unknown reference
    // on different dates. A unique constraint would reject the second, and the
    // money it represents would vanish without anyone being told.
    expect(executable(MIGRATION)).not.toMatch(/unique[^;]*normalised_reference/i)
    expect(executable(MIGRATION)).not.toMatch(/create\s+unique\s+index[^;]*held_payment/i)
  })

  it('grants select to watchdog_reader and nothing that writes', () => {
    const sql = executable(MIGRATION)

    expect(sql).toMatch(/grant\s+select\s+on\s+held_payment\s+to\s+watchdog_reader/i)
    expect(sql).not.toMatch(
      /grant\s+[^;]*\b(insert|update|delete|truncate|all)\b[^;]*\bto\s+watchdog_reader/i,
    )
  })

  it('strips comments without eating this migration statements', () => {
    const stripped = executable(MIGRATION)

    expect(stripped).toMatch(/create\s+table\s+held_payment\s*\(/i)
    expect(stripped).toMatch(/grant\s+select/i)
    expect(stripped.length).toBeLessThan(MIGRATION.length)
  })
})

describeWithDatabase('a held payment', () => {
  let writer: Client
  let reader: Client
  let boardMemberId = ''

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    reader = new Client({ connectionString: readerUrl })
    await writer.connect()
    await reader.connect()

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash)
       values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA')
       returning id`,
      [`held-payment-${RUN_PREFIX}@example.test`],
    )
    boardMemberId = rows[0]!.id
  })

  afterAll(async () => {
    if (boardMemberId) {
      await writer.query('delete from document where uploaded_by = $1', [boardMemberId])
      await writer.query('delete from board_member where id = $1', [boardMemberId])
    }
    await writer.end()
    await reader.end()
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

  const hold = (documentId: string, reference: string, amount = '120.00', paidOn = '2024-03-01') =>
    writer.query(
      'insert into held_payment (document_id, unit_reference, paid_on, amount) values ($1, $2, $3::date, $4)',
      [documentId, reference, paidOn, amount],
    )

  it('keeps the reference as the document spelled it', async () => {
    // Unfolded. A human is being asked which unit this is, and the answer
    // depends on seeing what was actually read.
    const documentId = await newDocument()
    await hold(documentId, '  4b Upper  ')

    const { rows } = await writer.query<{ unit_reference: string }>(
      'select unit_reference from held_payment where document_id = $1',
      [documentId],
    )
    expect(rows[0]?.unit_reference).toBe('  4b Upper  ')
  })

  it('folds two spellings of one reference to the same key', async () => {
    // So a treasurer is not asked the same question twice. This is the folding
    // migration 011 defines — case and whitespace, nothing else.
    const documentId = await newDocument()
    await hold(documentId, '4B')
    await hold(documentId, '  4b ', '60.00', '2024-03-15')

    const { rows } = await writer.query<{ normalised_reference: string }>(
      'select distinct normalised_reference from held_payment where document_id = $1',
      [documentId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.normalised_reference).toBe('4b')
  })

  it('keeps genuinely different references apart', async () => {
    // Beside the case above: a normaliser folding everything together would
    // satisfy it and be useless.
    const documentId = await newDocument()
    await hold(documentId, '4B')
    await hold(documentId, '5B')

    const { rows } = await writer.query<{ n: string }>(
      'select count(distinct normalised_reference)::text n from held_payment where document_id = $1',
      [documentId],
    )
    expect(rows[0]?.n).toBe('2')
  })

  it('folds by the unit normaliser, not the vendor one', async () => {
    // The cross-check on the separation, by an independent route: read the
    // generated column's expression out of the catalog rather than out of the
    // migration text. A migration saying the right thing and a column doing it
    // are different facts.
    const { rows } = await writer.query<{ expression: string }>(
      `select pg_get_expr(d.adbin, d.adrelid) as expression
         from pg_attrdef d
         join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
        where d.adrelid = 'held_payment'::regclass and a.attname = 'normalised_reference'`,
    )

    expect(rows[0]?.expression).toMatch(/unit_normalised_number/)
    expect(rows[0]?.expression).not.toMatch(/vendor_normalised_name/)
  })

  it('holds two lines for the same unknown reference on different dates', async () => {
    // Deliberately not unique. A unique constraint would reject the second line
    // and the money it represents would vanish from the ledger silently.
    const documentId = await newDocument()

    await hold(documentId, '4B', '60.00', '2024-03-01')
    await expect(hold(documentId, '4B', '60.00', '2024-03-15')).resolves.toBeDefined()

    const { rows } = await writer.query<{ n: string }>(
      'select count(*)::text n from held_payment where document_id = $1',
      [documentId],
    )
    expect(rows[0]?.n).toBe('2')
  })

  it('refuses a blank reference', async () => {
    await expect(hold(await newDocument(), '   ')).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('refuses a reference that is only padding around one character', async () => {
    await expect(hold(await newDocument(), `x${' '.repeat(300)}`)).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    })
  })

  it('refuses a non-positive amount', async () => {
    // Same rule as `payment`. A line failing this is malformed rather than
    // unattributable, and holding it would put a question to a human that has no
    // good answer.
    const documentId = await newDocument()

    await expect(hold(documentId, '4B', '0')).rejects.toMatchObject({ code: CHECK_VIOLATION })
    await expect(hold(documentId, '4B', '-1.00')).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('refuses a line for a document that does not exist', async () => {
    await expect(
      hold('00000000-0000-0000-0000-000000000000', '4B'),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION })
  })

  it('goes when its document goes', async () => {
    const documentId = await newDocument()
    await hold(documentId, '4B')

    await writer.query('delete from document where id = $1', [documentId])

    const { rows } = await writer.query<{ n: string }>(
      'select count(*)::text n from held_payment where document_id = $1',
      [documentId],
    )
    expect(rows[0]?.n).toBe('0')
  })

  it('lets watchdog_reader read it but not write it', async () => {
    const documentId = await newDocument()
    await hold(documentId, '7A')

    const { rows } = await reader.query<{ unit_reference: string }>(
      'select unit_reference from held_payment where document_id = $1',
      [documentId],
    )
    expect(rows[0]?.unit_reference).toBe('7A')

    await expect(
      reader.query(
        'insert into held_payment (document_id, unit_reference, paid_on, amount) values ($1, $2, $3::date, $4)',
        [documentId, '9Z', '2024-04-01', '1.00'],
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
  })
})

describeWithDatabase('migration 017: a held line may be incomplete', () => {
  let writer: Client
  let boardMemberId = ''

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash)
       values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA')
       returning id`,
      [`held-017-${RUN_PREFIX}@example.test`],
    )
    boardMemberId = rows[0]!.id
  })

  afterAll(async () => {
    if (boardMemberId) {
      await writer.query('delete from document where uploaded_by = $1', [boardMemberId])
      await writer.query('delete from board_member where id = $1', [boardMemberId])
    }
    await writer.end()
  })

  const doc = async (): Promise<string> => {
    const hash = randomBytes(32).toString('hex')
    const { rows } = await writer.query<{ id: string }>(
      `insert into document
         (content_hash, storage_key, filename, content_type, byte_size, uploaded_by)
       values ($1, $2, 'deposits.csv', 'text/csv', 512, $3) returning id`,
      [hash, `documents/${hash}`, boardMemberId],
    )
    return rows[0]!.id
  }

  it.each([
    ['no reference', 'unit_reference', 'missing-reference'],
    ['no date', 'paid_on', 'missing-date'],
    ['no amount', 'amount', 'missing-amount'],
  ])('holds a line with %s', async (_label, column, reason) => {
    // Migration 016 made these `not null`, copied from `payment`, which made the
    // table unable to hold the very lines it exists for. One malformed line then
    // aborted the whole replacement and lost every payment in the document.
    const documentId = await doc()
    const values: Record<string, unknown> = {
      unit_reference: '9Z',
      paid_on: '2024-03-01',
      amount: '60.00',
    }
    values[column] = null

    await expect(
      writer.query(
        `insert into held_payment (document_id, unit_reference, paid_on, amount, hold_reason)
         values ($1, $2, $3::date, $4, $5)`,
        [documentId, values.unit_reference, values.paid_on, values.amount, reason],
      ),
    ).resolves.toBeDefined()
  })

  it('still refuses a present-but-nonsense value', async () => {
    // Absence is not the same as nonsense. A reference that is there must still
    // be a real reference, and an amount that is there must still be positive.
    const documentId = await doc()

    await expect(
      writer.query(
        `insert into held_payment (document_id, unit_reference, paid_on, amount, hold_reason)
         values ($1, '   ', null, null, 'unknown-unit')`,
        [documentId],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })

    await expect(
      writer.query(
        `insert into held_payment (document_id, unit_reference, paid_on, amount, hold_reason)
         values ($1, '9Z', null, '-1.00', 'unknown-unit')`,
        [documentId],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('accepts the reason migration 018 added', async () => {
    // The parity test reads migration 018's *text*, so it would pass while the
    // database still refused the value -- the constraint could have failed to
    // apply and nothing would have noticed. Raised by review.
    const documentId = await doc()

    await expect(
      writer.query(
        `insert into held_payment (document_id, unit_reference, paid_on, amount, hold_reason)
         values ($1, '9Z', '2024-03-01'::date, null, 'unsupported-amount')`,
        [documentId],
      ),
    ).resolves.toBeDefined()
  })
  it('refuses a hold reason outside the vocabulary', async () => {
    const documentId = await doc()

    await expect(
      writer.query(
        `insert into held_payment (document_id, unit_reference, paid_on, amount, hold_reason)
         values ($1, '9Z', null, null, 'because-i-said-so')`,
        [documentId],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('leaves the folded reference null when there is no reference to fold', async () => {
    // `unit_normalised_number` is `strict`, so a null in gives a null out. Worth
    // pinning: a generated column silently producing '' would group every
    // reference-less line together as one unknown unit.
    const documentId = await doc()
    await writer.query(
      `insert into held_payment (document_id, unit_reference, paid_on, amount, hold_reason)
       values ($1, null, null, null, 'missing-reference')`,
      [documentId],
    )

    const { rows } = await writer.query<{ normalised_reference: string | null }>(
      'select normalised_reference from held_payment where document_id = $1',
      [documentId],
    )
    expect(rows[0]?.normalised_reference).toBeNull()
  })
})
