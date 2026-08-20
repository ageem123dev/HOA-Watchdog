/**
 * `quarantine_item` — a document waiting on a human to say who a vendor is.
 *
 * The row exists so that a name nobody recognises stops rather than becomes a
 * vendor. What makes it subtle is the uniqueness rule: holding the same
 * document twice for one vendor spelled two ways would put the same decision in
 * front of the treasurer twice, and holding two *different* documents for one
 * unknown vendor must still hold both. Those pull in opposite directions and a
 * single-column index gets one of them wrong.
 *
 * Against real Postgres. A generated column, a composite unique index, a
 * cascade and a grant are all claims about the database.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { normaliseVendorName } from '../core/vendor/name'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  quarantine-item tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL must both be set.\n',
  )
}

const NOT_NULL_VIOLATION = '23502'
const FOREIGN_KEY_VIOLATION = '23503'
const UNIQUE_VIOLATION = '23505'
const CHECK_VIOLATION = '23514'
const INSUFFICIENT_PRIVILEGE = '42501'

const RUN_PREFIX = randomBytes(4).toString('hex')
const named = (suffix: string) => `${RUN_PREFIX} ${suffix}`

const MIGRATION = readFileSync(join(__dirname, '010_quarantine_item.sql'), 'utf8')

/**
 * The statements only.
 *
 * These migrations explain their own hazards in prose, so a check for a bad
 * shape matches the sentence warning against it unless comments come out first.
 */
const executable = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')

describe('the migration says what it does', () => {
  it('grants select to the reader, because 1.6c reads the queue', () => {
    expect(MIGRATION).toMatch(/grant\s+select\s+on\s+quarantine_item\s+to\s+watchdog_reader/i)
  })

  it('grants the reader nothing else', () => {
    // AD-8 puts a human in this loop. A write grant here would let the
    // LLM-driven query path create or clear a hold, which removes them.
    expect(MIGRATION).not.toMatch(
      /grant\s+[^;]*\b(insert|update|delete|truncate|all)\b[^;]*\bto\s+watchdog_reader/i,
    )
  })

  it('reuses the vendor identity rule rather than writing a second one', () => {
    // If quarantine and vendor disagree about what "the same name" is, a
    // document can be held twice for one vendor under two spellings -- the
    // original defect wearing a different hat.
    expect(MIGRATION).toMatch(/vendor_normalised_name\s*\(/)
  })

  it('bounds the name with the shape 1.6a arrived at, not the one it replaced', () => {
    // `char_length(btrim(...)) between 1 and 200` lets 'x' plus 300 trailing
    // spaces through. That was fixed twice in 009 and must not come back here.
    //
    // Comments stripped first. The migration names the bad shape in prose so
    // the next person does not rediscover it, and the first version of this
    // test matched that very sentence -- the identical mistake 009's backslash
    // check made, made again one story later by the person who fixed it.
    expect(executable(MIGRATION)).not.toMatch(
      /char_length\s*\(\s*btrim[\s\S]{0,160}?between\s+1\s+and\s+200/i,
    )
    expect(executable(MIGRATION)).toMatch(/char_length\s*\(\s*extracted_name\s*\)\s*<=\s*200/i)
  })

  it('would notice the replaced shape if it came back', () => {
    // Stripping comments could hide the thing the check hunts, so prove the
    // predicate still fires on it.
    const offending = 'constraint c check (char_length(btrim(extracted_name, x)) between 1 and 200)'

    expect(executable(offending)).toMatch(
      /char_length\s*\(\s*btrim[\s\S]{0,160}?between\s+1\s+and\s+200/i,
    )
  })
})

describeWithDatabase('quarantine_item', () => {
  let writer: Client
  let reader: Client
  let documentId: string
  let otherDocumentId: string

  async function makeDocument(suffix: string): Promise<string> {
    const { rows } = await writer.query(
      `insert into document (filename, content_type, byte_size, content_hash, storage_key, uploaded_by, association_id) values ($1, 'application/pdf', 1024, $2, $3, (select id from board_member limit 1), '00000000-0000-7000-8000-000000000001')
       returning id`,
      [named(suffix), randomBytes(32).toString('hex'), `documents/${randomBytes(8).toString('hex')}`],
    )
    return rows[0].id
  }

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    reader = new Client({ connectionString: readerUrl })
    await writer.connect()
    await reader.connect()
    documentId = await makeDocument('invoice.pdf')
    otherDocumentId = await makeDocument('another-invoice.pdf')
  })

  afterAll(async () => {
    if (writer) {
      // The cascade clears the items with them.
      await writer.query('delete from document where filename like $1', [`${RUN_PREFIX}%`])
      await writer.end().catch(() => undefined)
    }
    if (reader) await reader.end().catch(() => undefined)
  })

  describe('holding one', () => {
    it('stores the name as the document said it', async () => {
      // Not normalised. 1.6c shows the treasurer what was actually read; the
      // normalised form is a comparison key and is no use to a human.
      const spelled = '  EverGREEN   Landscaping '
      const { rows } = await writer.query(
        'insert into quarantine_item (document_id, extracted_name, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\') returning id, extracted_name, normalised_name',
        [documentId, spelled],
      )

      expect(rows[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/)
      expect(rows[0].extracted_name).toBe(spelled)
      expect(rows[0].normalised_name).toBe(normaliseVendorName(spelled))
    })

    it('refuses a name that is only separators', async () => {
      await expect(
        writer.query('insert into quarantine_item (document_id, extracted_name, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')', [
          documentId,
          '   ',
        ]),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION })
    })

    it('refuses an empty name', async () => {
      await expect(
        writer.query('insert into quarantine_item (document_id, extracted_name, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')', [
          documentId,
          '',
        ]),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION })
    })

    it.each([
      ['plainly too long', 'x'.repeat(201)],
      ['padded by a trailing run', `x${' '.repeat(300)}`],
      ['padded by a leading run', `${' '.repeat(300)}x`],
      ['padded by an internal run', `x${' '.repeat(300)}y`],
    ])('refuses a name %s', async (_label, name) => {
      // All four shapes, because 009's bound was wrong twice and each fix
      // closed one position while leaving another open.
      await expect(
        writer.query('insert into quarantine_item (document_id, extracted_name, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')', [
          documentId,
          name,
        ]),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION })
    })

    it('accepts a name exactly at the bound', async () => {
      const atLimit = `${RUN_PREFIX}${'y'.repeat(200 - RUN_PREFIX.length)}`

      expect(atLimit).toHaveLength(200)
      await expect(
        writer.query('insert into quarantine_item (document_id, extracted_name, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')', [
          otherDocumentId,
          atLimit,
        ]),
      ).resolves.toBeDefined()
    })

    it('refuses a missing name', async () => {
      await expect(
        writer.query('insert into quarantine_item (document_id, extracted_name, association_id) values ($1, null, \'00000000-0000-7000-8000-000000000001\')', [
          documentId,
        ]),
      ).rejects.toMatchObject({ code: NOT_NULL_VIOLATION })
    })

    it('refuses an item for a document that does not exist', async () => {
      await expect(
        writer.query('insert into quarantine_item (document_id, extracted_name, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')', [
          '018f3a2b-0000-7000-8000-00000000dead',
          named('Nowhere Ltd'),
        ]),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION })
    })
  })

  describe('holding twice holds once', () => {
    it('refuses a second spelling of a name already held for that document', async () => {
      const held = await makeDocument('duplicate.pdf')
      await writer.query('insert into quarantine_item (document_id, extracted_name, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')', [
        held,
        named('Acme Plumbing'),
      ])

      await expect(
        writer.query('insert into quarantine_item (document_id, extracted_name, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')', [
          held,
          `  ${named('ACME   plumbing')} `,
        ]),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION })
    })

    it('still holds two different documents for the same unknown vendor', async () => {
      // The opposite direction, and the one a single-column unique index gets
      // wrong: two invoices from one unfamiliar vendor are two decisions
      // waiting, not one.
      const first = await makeDocument('first.pdf')
      const second = await makeDocument('second.pdf')
      const vendor = named('Northwind Roofing')

      await writer.query('insert into quarantine_item (document_id, extracted_name, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')', [
        first,
        vendor,
      ])

      await expect(
        writer.query('insert into quarantine_item (document_id, extracted_name, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')', [
          second,
          vendor,
        ]),
      ).resolves.toBeDefined()
    })

    it('holds one document for two different unknown vendors', async () => {
      // A document can yield several records. Two unknown names on one
      // document are two things to ask about.
      const many = await makeDocument('two-vendors.pdf')

      await writer.query('insert into quarantine_item (document_id, extracted_name, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')', [
        many,
        named('First Unknown'),
      ])

      await expect(
        writer.query('insert into quarantine_item (document_id, extracted_name, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')', [
          many,
          named('Second Unknown'),
        ]),
      ).resolves.toBeDefined()
    })
  })

  describe('an item does not outlive its document', () => {
    it('goes when the document goes', async () => {
      const doomed = await makeDocument('doomed.pdf')
      await writer.query('insert into quarantine_item (document_id, extracted_name, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')', [
        doomed,
        named('Ephemeral Services'),
      ])

      await writer.query('delete from document where id = $1', [doomed])

      const { rows } = await writer.query(
        'select count(*)::int as n from quarantine_item where document_id = $1',
        [doomed],
      )

      expect(rows[0].n).toBe(0)
    })
  })

  describe('the role split (AD-4)', () => {
    it('lets the reader read the queue, which is what 1.6c needs', async () => {
      const visible = await makeDocument('visible.pdf')
      await writer.query('insert into quarantine_item (document_id, extracted_name, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')', [
        visible,
        named('Readable Vendor'),
      ])

      const { rows } = await reader.query(
        'select extracted_name from quarantine_item where document_id = $1',
        [visible],
      )

      expect(rows).toHaveLength(1)
    })

    it('refuses the reader an insert', async () => {
      await expect(
        reader.query('insert into quarantine_item (document_id, extracted_name, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')', [
          documentId,
          named('Forged Hold'),
        ]),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
    })

    it('refuses the reader an update', async () => {
      // Scoped, though the privilege check runs before any row is touched and
      // 42501 raises either way. If the grant is ever widened, the unqualified
      // version rewrites every row in the table -- the test that catches the
      // regression would also cause the damage. Raised in review.
      await expect(
        reader.query('update quarantine_item set extracted_name = $1 where document_id = $2', [
          named('Renamed'),
          documentId,
        ]),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
    })

    it('refuses the reader a delete', async () => {
      // The one that matters most: clearing a hold is how a human's decision
      // gets skipped, and the LLM path must not be able to do it.
      await expect(
        reader.query('delete from quarantine_item where document_id = $1', [documentId]),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
    })
  })
})
