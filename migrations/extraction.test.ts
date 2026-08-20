/**
 * The `extraction` table — what a document was read to say, and the invariant
 * that it says it exactly once.
 *
 * Every value here arrives from a parser reading a file somebody uploaded, so
 * the dangerous inputs are not gibberish. They are plausible-but-wrong: an empty
 * vendor name that looks like data, a page of text in a name field, a cent
 * invented by rounding. Those are what these constraints exist for.
 *
 * **Requires a database and skips without one**, matching `document.test.ts`:
 * the suite stays runnable without credentials, and the skip is loud.
 */

import { randomBytes } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validate } from '../core/extraction/validate'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured
  ? describe
  : (describe.skip.bind(null) as unknown as typeof describe)

if (!configured) {
  console.warn(
    '\n  extraction-table tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL are not set.\n' +
      '  Run `npm run migrate`, then `npm run test:db`.\n',
  )
}

const NOT_NULL_VIOLATION = '23502'
const FOREIGN_KEY_VIOLATION = '23503'
const CHECK_VIOLATION = '23514'
const NUMERIC_OUT_OF_RANGE = '22003'
const INSUFFICIENT_PRIVILEGE = '42501'

/** SQLSTATE by code, never a bare `rejects.toThrow()` — that also passes when the table is absent. */
async function expectRefusal(query: Promise<unknown>, code: string): Promise<void> {
  await expect(query).rejects.toMatchObject({ code })
}

/** Per-run prefix so debris from a killed run cannot collide and look like a constraint defect. */
const RUN_PREFIX = randomBytes(8).toString('hex')
const COUNTER_WIDTH = 64 - RUN_PREFIX.length
let hashCounter = 0
function distinctHash(): string {
  const digest = `${RUN_PREFIX}${(hashCounter++).toString(16).padStart(COUNTER_WIDTH, '0')}`
  if (digest.length !== 64) {
    throw new Error(`distinctHash produced ${digest.length} characters, expected 64`)
  }
  return digest
}

interface ExtractionInput {
  documentId?: string
  documentKind?: string
  vendorName?: string | null
  documentNumber?: string | null
  issuedOn?: string | null
  totalAmount?: string | null
  currency?: string
}

describeWithDatabase('the extraction table', () => {
  let writer: Client
  let reader: Client
  let boardMemberId: string

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    reader = new Client({ connectionString: readerUrl })
    await Promise.all([writer.connect(), reader.connect()])

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash, association_id) values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA', '00000000-0000-7000-8000-000000000001')
       returning id`,
      [`extraction-test-${RUN_PREFIX}@example.test`],
    )
    boardMemberId = rows[0]!.id
  })

  afterAll(async () => {
    // Guarded on boardMemberId, not on `writer`: `writer` is assigned before
    // connect() resolves, so a failure in beforeAll would run these deletes with
    // an undefined parameter and replace the real setup error in the report.
    if (boardMemberId) {
      await writer.query(
        'delete from document where uploaded_by = $1',
        [boardMemberId],
      )
      await writer.query('delete from board_member where id = $1', [boardMemberId])
    }
    await Promise.all([writer?.end(), reader?.end()].filter(Boolean))
  })

  /** A fresh document to hang an extraction from. */
  async function newDocument(): Promise<string> {
    const hash = distinctHash()
    const { rows } = await writer.query<{ id: string }>(
      `insert into document (content_hash, storage_key, filename, content_type, byte_size, uploaded_by, association_id) values ($1, $2, 'ledger.csv', 'text/csv', 512, $3, '00000000-0000-7000-8000-000000000001')
       returning id`,
      [hash, `documents/${hash}`, boardMemberId],
    )
    return rows[0]!.id
  }

  const insert = async (input: ExtractionInput = {}) => {
    const documentId = input.documentId ?? (await newDocument())
    return writer.query(
      `insert into extraction (document_id, document_kind, vendor_name, document_number, issued_on, total_amount, currency, association_id) values ($1, $2, $3, $4, $5, $6, $7, '00000000-0000-7000-8000-000000000001')
       returning *`,
      [
        documentId,
        input.documentKind ?? 'invoice',
        input.vendorName === undefined ? 'Evergreen Landscaping' : input.vendorName,
        input.documentNumber === undefined ? 'INV-4471' : input.documentNumber,
        input.issuedOn === undefined ? '2026-06-01' : input.issuedOn,
        input.totalAmount === undefined ? '1450.00' : input.totalAmount,
        input.currency ?? 'USD',
      ],
    )
  }

  describe('which rows are representable', () => {
    it('accepts a fully populated extraction', async () => {
      const { rows } = await insert()

      expect(rows).toHaveLength(1)
      expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('reads back every value unchanged, so no column silently coerces', async () => {
      const written = {
        documentKind: 'statement',
        vendorName: 'Bay Area Pool Service, Inc.',
        documentNumber: 'ST-2026-06',
        issuedOn: '2026-06-30',
        totalAmount: '8421.55',
      }

      const { rows: inserted } = await insert(written)
      // issued_on is selected as text: comparing a driver-built Date reintroduces
      // a timezone shift, and asserting only its type would let a different date
      // pass a test whose title promises every value is unchanged.
      const { rows: read } = await writer.query(
        'select *, issued_on::text as issued_on_text from extraction where id = $1',
        [inserted[0].id],
      )

      expect(read[0].document_kind).toBe(written.documentKind)
      expect(read[0].vendor_name).toBe(written.vendorName)
      expect(read[0].document_number).toBe(written.documentNumber)
      expect(read[0].issued_on_text).toBe(written.issuedOn)
      expect(read[0].total_amount).toBe(written.totalAmount)
      expect(read[0].currency).toBe('USD')
    })

    it.each([['invoice'], ['statement'], ['assessment_roll'], ['other']])(
      'accepts the known document kind %s',
      async (documentKind) => {
        const { rows } = await insert({ documentKind })

        expect(rows[0].document_kind).toBe(documentKind)
      },
    )

    it('refuses a document kind outside the known set', async () => {
      await expectRefusal(insert({ documentKind: 'receipt' }), CHECK_VIOLATION)
    })

    it('accepts an absent vendor, because a statement has none', async () => {
      const { rows } = await insert({ vendorName: null })

      expect(rows[0].vendor_name).toBeNull()
    })

    it('refuses an empty vendor name, which is a parse failure dressed as data', async () => {
      // Absent and present-but-empty are different facts. The first is a
      // statement with no vendor; the second is a parser that found nothing and
      // said so in the wrong vocabulary.
      await expectRefusal(insert({ vendorName: '' }), CHECK_VIOLATION)
    })

    it.each([
      ['a whitespace-only vendor name', { vendorName: '   ' }],
      ['a whitespace-only document number', { documentNumber: '\t\n ' }],
    ])('refuses %s, which a bare length check would admit', async (_label, input) => {
      // `char_length('   ')` is 3, so length alone is satisfied. The validator
      // refuses these too; this is the boundary that holds if anything ever
      // writes here without going through it.
      await expectRefusal(insert(input), CHECK_VIOLATION)
    })

    it('accepts a vendor name at the 200-character limit', async () => {
      const vendorName = 'v'.repeat(200)

      const { rows } = await insert({ vendorName })

      expect(rows[0].vendor_name).toHaveLength(200)
    })

    it('refuses a vendor name one character past the limit', async () => {
      await expectRefusal(insert({ vendorName: 'v'.repeat(201) }), CHECK_VIOLATION)
    })

    it('accepts a document number at the 64-character limit', async () => {
      const { rows } = await insert({ documentNumber: 'n'.repeat(64) })

      expect(rows[0].document_number).toHaveLength(64)
    })

    it.each([
      ['an empty document number', ''],
      ['a document number past the limit', 'n'.repeat(65)],
    ])('refuses %s', async (_label, documentNumber) => {
      await expectRefusal(insert({ documentNumber }), CHECK_VIOLATION)
    })

    it('accepts an absent document number and an absent date', async () => {
      const { rows } = await insert({ documentNumber: null, issuedOn: null })

      expect(rows[0].document_number).toBeNull()
      expect(rows[0].issued_on).toBeNull()
    })

    it('refuses a currency outside what the pilot supports', async () => {
      await expectRefusal(insert({ currency: 'XYZ' }), CHECK_VIOLATION)
    })

    it('refuses an extraction attached to no document', async () => {
      await expectRefusal(
        writer.query(
          `insert into extraction (document_kind, currency, association_id) values ('invoice', 'USD', '00000000-0000-7000-8000-000000000001')`,
        ),
        NOT_NULL_VIOLATION,
      )
    })

    it('refuses an extraction attached to a document that does not exist', async () => {
      await expectRefusal(
        insert({ documentId: '00000000-0000-7000-8000-000000000000' }),
        FOREIGN_KEY_VIOLATION,
      )
    })

    it('records timestamps with their zone, not a bare local timestamp', async () => {
      const { rows } = await writer.query<{ data_type: string }>(
        // Schema-scoped: an `extraction` table in another visible schema would
        // otherwise satisfy this and describe the wrong column.
        `select data_type from information_schema.columns
         where table_schema = 'public'
           and table_name = 'extraction'
           and column_name = 'extracted_at'`,
      )

      expect(rows[0]?.data_type).toBe('timestamp with time zone')
    })
  })

  describe('money', () => {
    it.each([
      ['a value a float cannot represent', '0.10'],
      ['the largest value the column admits', '999999999999.99'],
      ['one order below the limit', '99999999999.99'],
      ['a whole number', '1450.00'],
    ])('round-trips %s exactly', async (_label, totalAmount) => {
      // Compared as strings on purpose. Reading into a JS number is the very
      // conversion this column exists to avoid, and would make the test agree
      // with the bug.
      const { rows } = await insert({ totalAmount })

      expect(rows[0].total_amount).toBe(totalAmount)
    })

    it('accepts a negative amount, which is a credit to the association', async () => {
      const { rows } = await insert({ totalAmount: '-250.00' })

      expect(rows[0].total_amount).toBe('-250.00')
    })

    it('accepts an absent amount', async () => {
      const { rows } = await insert({ totalAmount: null })

      expect(rows[0].total_amount).toBeNull()
    })

    it('refuses an amount beyond the column precision rather than truncating it', async () => {
      // One digit past the twelve the column holds, so the edge is pinned
      // rather than approached from two orders away.
      await expectRefusal(insert({ totalAmount: '9999999999999.99' }), NUMERIC_OUT_OF_RANGE)
    })
  })

  describe('the validator agrees with the column it writes to', () => {
    // The independent oracle for `core/extraction/validate.ts`. Its amount rules
    // are only worth anything if the real column agrees, and only the real
    // column can answer that.

    it('stores every amount the validator accepts, unchanged', async () => {
      const accepted = ['1450.00', '-250.00', '0.00', '0.01', '1450', '1450.5', '999999999999.99']

      for (const totalAmount of accepted) {
        expect(
          validate({ documentKind: 'invoice', currency: 'USD', totalAmount }).ok,
          `validator rejected ${totalAmount}`,
        ).toBe(true)

        const { rows } = await insert({ totalAmount })
        // Compared by asking Postgres, not by converting both sides to doubles —
        // that conversion is the step `numeric` exists to avoid.
        const { rows: same } = await writer.query<{ equal: boolean }>(
          'select total_amount = $1::numeric(14,2) as equal from extraction where id = $2',
          [totalAmount, rows[0].id],
        )
        expect(same[0]!.equal).toBe(true)
      }
    })

    it('proves the column would silently round what the validator refuses', async () => {
      // The whole reason the third decimal place is refused in application code:
      // the column does not error on it, it rounds. This asserts that Postgres
      // really behaves that way rather than taking the comment's word for it —
      // if a future Postgres started refusing, the guard would be redundant and
      // this test would say so.
      const refused = '1.005'

      expect(validate({ documentKind: 'invoice', currency: 'USD', totalAmount: refused }).ok).toBe(
        false,
      )

      const { rows } = await insert({ totalAmount: refused })

      expect(rows[0].total_amount).not.toBe(refused)
      expect(Number(rows[0].total_amount)).toBeCloseTo(1.01, 5)
    })
  })

  describe('many records per document, replaced as a set', () => {
    // A bank feed uploaded as CSV is one document and many lines, which is what
    // `DOCUMENT ||--o{ EXTRACTION` in the architecture spine says. AD-13's
    // replacement is therefore set-shaped: everything this document produced is
    // removed and the new reading inserted, never merged row by row.

    it('accepts many extractions for one document', async () => {
      const documentId = await newDocument()

      await insert({ documentId, documentNumber: 'LINE-1' })
      await insert({ documentId, documentNumber: 'LINE-2' })
      await insert({ documentId, documentNumber: 'LINE-3' })

      const { rows } = await writer.query(
        'select id from extraction where document_id = $1',
        [documentId],
      )

      expect(rows).toHaveLength(3)
    })

    it('replaces the whole set rather than merging into it', async () => {
      const documentId = await newDocument()
      await insert({ documentId, documentNumber: 'OLD-1' })
      await insert({ documentId, documentNumber: 'OLD-2' })

      // Rolled back on failure: `writer` is shared by every test in this file,
      // and an aborted transaction would make each later test fail with 25P02,
      // burying the one real failure under a cascade of false ones.
      try {
        await writer.query('begin')
        await writer.query('delete from extraction where document_id = $1', [documentId])
        await writer.query(
          `insert into extraction (document_id, document_kind, document_number, currency, association_id) values ($1, 'statement', 'NEW-1', 'USD', '00000000-0000-7000-8000-000000000001')`,
          [documentId],
        )
        await writer.query('commit')
      } catch (error) {
        await writer.query('rollback')
        throw error
      }

      const { rows } = await writer.query(
        'select document_number from extraction where document_id = $1 order by document_number',
        [documentId],
      )

      expect(rows.map((r) => r.document_number)).toEqual(['NEW-1'])
    })

    it('leaves another document’s records untouched when one document is replaced', async () => {
      const [first, second] = [await newDocument(), await newDocument()]
      await insert({ documentId: first, documentNumber: 'FIRST-1' })
      await insert({ documentId: second, documentNumber: 'SECOND-1' })
      await insert({ documentId: second, documentNumber: 'SECOND-2' })

      await writer.query('delete from extraction where document_id = $1', [first])

      const { rows } = await writer.query(
        'select document_number from extraction where document_id = $1',
        [second],
      )

      expect(rows).toHaveLength(2)
    })

    it('removes every record when the document is deleted', async () => {
      const documentId = await newDocument()
      await insert({ documentId, documentNumber: 'A' })
      await insert({ documentId, documentNumber: 'B' })

      await writer.query('delete from document where id = $1', [documentId])
      const { rows } = await writer.query('select id from extraction where document_id = $1', [
        documentId,
      ])

      expect(rows).toHaveLength(0)
    })
  })

  describe('role separation on the new table', () => {
    it('lets the writer insert, update and delete, because ingestion must', async () => {
      const { rows } = await insert()
      const id = rows[0].id

      await expect(
        writer.query('update extraction set vendor_name = $1 where id = $2', ['Renamed', id]),
      ).resolves.toBeDefined()
      await expect(
        writer.query('delete from extraction where id = $1', [id]),
      ).resolves.toBeDefined()
    })

    it('lets the reader select, because the catalog must cite a figure', async () => {
      await insert()

      await expect(
        reader.query('select id, total_amount from extraction'),
      ).resolves.toBeDefined()
    })

    it('does not let the reader insert', async () => {
      const documentId = await newDocument()

      await expectRefusal(
        reader.query(
          `insert into extraction (document_id, document_kind, currency, association_id) values ($1, 'invoice', 'USD', '00000000-0000-7000-8000-000000000001')`,
          [documentId],
        ),
        INSUFFICIENT_PRIVILEGE,
      )
    })

    it('does not let the reader update', async () => {
      // Scoped by id even though the privilege check runs first. If a later
      // migration ever widened the grant, an unscoped statement would not simply
      // fail — it would rewrite every vendor name in the shared test database,
      // and the report would describe a privilege problem rather than the loss.
      const { rows } = await insert()

      await expectRefusal(
        reader.query("update extraction set vendor_name = 'x' where id = $1", [rows[0].id]),
        INSUFFICIENT_PRIVILEGE,
      )
    })

    it('does not let the reader delete', async () => {
      const { rows } = await insert()

      await expectRefusal(
        reader.query('delete from extraction where id = $1', [rows[0].id]),
        INSUFFICIENT_PRIVILEGE,
      )
    })
  })
})
