/**
 * The `document` table — AD-13's idempotency invariant, enforced by the database.
 *
 * "Every uploaded document carries a content hash computed before extraction.
 * Re-ingesting a document with an existing hash **replaces** that document's
 * derived rows rather than appending."
 *
 * The uniqueness half of that is a database constraint rather than an application
 * check, and the distinction is the whole point. An application check reads the
 * table, decides the hash is new, and inserts — and two uploads arriving together
 * both read before either writes, so both decide the hash is new and both insert.
 * In a product whose headline feature is duplicate-invoice detection, an ingestion
 * path that manufactures duplicates under concurrency is the defect it exists to
 * find. Only the database can close that race.
 *
 * **These tests require a database and skip without one**, matching the trade made
 * in `roles.test.ts`: the suite stays runnable without credentials, and the skip is
 * loud rather than silent.
 */

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured
  ? describe
  : (describe.skip.bind(null) as unknown as typeof describe)

if (!configured) {
  console.warn(
    '\n  document-table tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL are not set.\n' +
      '  Run `node --env-file=.env.local scripts/migrate.mjs`, then `npm run test:db`.\n',
  )
}

/** A distinct 64-char lower-case hex digest per call, so tests never collide. */
let hashCounter = 0
function distinctHash(): string {
  hashCounter += 1
  return hashCounter.toString(16).padStart(64, 'a')
}

/**
 * Postgres SQLSTATE codes, asserted by code rather than by "it threw".
 *
 * A bare `rejects.toThrow()` here passes against a table that does not exist yet,
 * which makes it indistinguishable from a constraint that was never written. The
 * code is what says the database refused for the stated reason.
 */
const NOT_NULL_VIOLATION = '23502'
const FOREIGN_KEY_VIOLATION = '23503'
const UNIQUE_VIOLATION = '23505'
const CHECK_VIOLATION = '23514'
const INSUFFICIENT_PRIVILEGE = '42501'

async function expectRefusal(query: Promise<unknown>, code: string): Promise<void> {
  await expect(query).rejects.toMatchObject({ code })
}

const PDF = 'application/pdf'

interface DocumentInput {
  contentHash?: string
  storageKey?: string
  filename?: string
  contentType?: string
  byteSize?: number
  uploadedBy?: string
}

describeWithDatabase('the document table', () => {
  let writer: Client
  let reader: Client
  let boardMemberId: string

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    reader = new Client({ connectionString: readerUrl })
    await Promise.all([writer.connect(), reader.connect()])

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash)
       values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA')
       returning id`,
      [`document-test-${Date.now()}@example.test`],
    )
    boardMemberId = rows[0]!.id
  })

  afterAll(async () => {
    if (writer) {
      await writer.query('delete from document where uploaded_by = $1', [boardMemberId])
      await writer.query('delete from board_member where id = $1', [boardMemberId])
    }
    await Promise.all([writer?.end(), reader?.end()].filter(Boolean))
  })

  const insert = (input: DocumentInput = {}) =>
    writer.query(
      `insert into document (content_hash, storage_key, filename, content_type, byte_size, uploaded_by)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [
        input.contentHash ?? distinctHash(),
        input.storageKey ?? 'uploads/probe.pdf',
        input.filename ?? 'probe.pdf',
        input.contentType ?? PDF,
        input.byteSize ?? 1024,
        input.uploadedBy ?? boardMemberId,
      ],
    )

  describe('which rows are representable', () => {
    it('accepts a document with every column populated', async () => {
      const { rows } = await insert()

      expect(rows).toHaveLength(1)
      expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('reads back exactly what was written, so no column silently coerces', async () => {
      const written = {
        contentHash: distinctHash(),
        storageKey: 'uploads/2026/statement.pdf',
        filename: 'operating-statement-june.pdf',
        contentType: PDF,
        byteSize: 204_800,
      }

      const { rows: inserted } = await insert(written)
      const { rows: read } = await writer.query('select * from document where id = $1', [
        inserted[0].id,
      ])

      expect(read[0].content_hash).toBe(written.contentHash)
      expect(read[0].storage_key).toBe(written.storageKey)
      expect(read[0].filename).toBe(written.filename)
      expect(read[0].content_type).toBe(written.contentType)
      expect(Number(read[0].byte_size)).toBe(written.byteSize)
      expect(read[0].uploaded_by).toBe(boardMemberId)
    })

    it('refuses a row with no content hash, which AD-13 could not enforce', async () => {
      await expectRefusal(
        writer.query(
          `insert into document (storage_key, filename, content_type, byte_size, uploaded_by)
           values ('uploads/x.pdf', 'x.pdf', $1, 1, $2)`,
          [PDF, boardMemberId],
        ),
        NOT_NULL_VIOLATION,
      )
    })

    it('refuses an upper-case hash, so one digest has one spelling', async () => {
      await expectRefusal(
        insert({ contentHash: distinctHash().toUpperCase() }),
        CHECK_VIOLATION,
      )
    })

    it('refuses a truncated hash', async () => {
      await expectRefusal(insert({ contentHash: 'abc123' }), CHECK_VIOLATION)
    })

    it('refuses a hash with non-hex characters', async () => {
      await expectRefusal(insert({ contentHash: 'z'.repeat(64) }), CHECK_VIOLATION)
    })

    it('refuses a zero-byte document', async () => {
      await expectRefusal(insert({ byteSize: 0 }), CHECK_VIOLATION)
    })

    it('refuses a negative byte size', async () => {
      await expectRefusal(insert({ byteSize: -1 }), CHECK_VIOLATION)
    })

    it('accepts a one-byte document, the smallest real one', async () => {
      const { rows } = await insert({ byteSize: 1 })

      expect(Number(rows[0].byte_size)).toBe(1)
    })

    it('refuses a content type outside the accepted set', async () => {
      await expectRefusal(insert({ contentType: 'application/x-msdownload' }), CHECK_VIOLATION)
    })

    it.each([
      ['application/pdf'],
      ['image/png'],
      ['image/jpeg'],
      ['text/csv'],
      ['application/vnd.ms-excel'],
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ])('accepts the supported content type %s', async (contentType) => {
      const { rows } = await insert({ contentType })

      expect(rows[0].content_type).toBe(contentType)
    })

    it('refuses an empty filename', async () => {
      await expectRefusal(insert({ filename: '' }), CHECK_VIOLATION)
    })

    it('accepts a filename at the 255-character limit', async () => {
      const filename = `${'f'.repeat(251)}.pdf`

      const { rows } = await insert({ filename })

      expect(rows[0].filename).toHaveLength(255)
    })

    it('refuses a filename one character past the limit', async () => {
      await expectRefusal(insert({ filename: 'f'.repeat(256) }), CHECK_VIOLATION)
    })

    it('refuses a document attributed to no board member', async () => {
      await expectRefusal(
        writer.query(
          `insert into document (content_hash, storage_key, filename, content_type, byte_size)
           values ($1, 'uploads/x.pdf', 'x.pdf', $2, 1)`,
          [distinctHash(), PDF],
        ),
        NOT_NULL_VIOLATION,
      )
    })

    it('refuses a document attributed to a board member who does not exist', async () => {
      await expectRefusal(
        insert({ uploadedBy: '00000000-0000-7000-8000-000000000000' }),
        FOREIGN_KEY_VIOLATION,
      )
    })

    it('records timestamps with their zone, not a bare local timestamp', async () => {
      const { rows } = await writer.query<{ data_type: string }>(
        `select data_type from information_schema.columns
         where table_name = 'document' and column_name = 'uploaded_at'`,
      )

      expect(rows[0]?.data_type).toBe('timestamp with time zone')
    })
  })

  describe('content-hash uniqueness (AD-13)', () => {
    it('refuses a second document carrying an existing hash', async () => {
      const contentHash = distinctHash()
      await insert({ contentHash })

      await expectRefusal(insert({ contentHash }), UNIQUE_VIOLATION)
    })

    it('refuses it even under a different filename, since the bytes are what identify it', async () => {
      const contentHash = distinctHash()
      await insert({ contentHash, filename: 'invoice.pdf' })

      await expectRefusal(
        insert({ contentHash, filename: 'invoice-copy.pdf' }),
        UNIQUE_VIOLATION,
      )
    })

    it('still admits two documents with different hashes, so the constraint is not blanket', async () => {
      const first = await insert()
      const second = await insert()

      expect(first.rows[0].content_hash).not.toBe(second.rows[0].content_hash)
    })
  })

  describe('role separation on the new table (AD-4)', () => {
    it('lets the writer insert, update and delete, because ingestion must', async () => {
      const { rows } = await insert()
      const id = rows[0].id

      await expect(
        writer.query('update document set filename = $1 where id = $2', ['renamed.pdf', id]),
      ).resolves.toBeDefined()
      await expect(writer.query('delete from document where id = $1', [id])).resolves.toBeDefined()
    })

    it('lets the reader select, because the catalog must attribute a figure to its document', async () => {
      await insert()

      await expect(reader.query('select id, content_hash from document')).resolves.toBeDefined()
    })

    it('does not let the reader insert', async () => {
      await expectRefusal(
        reader.query(
          `insert into document (content_hash, storage_key, filename, content_type, byte_size, uploaded_by)
           values ($1, 'uploads/x.pdf', 'x.pdf', $2, 1, $3)`,
          [distinctHash(), PDF, boardMemberId],
        ),
        INSUFFICIENT_PRIVILEGE,
      )
    })

    it('does not let the reader update', async () => {
      await expectRefusal(
        reader.query("update document set filename = 'x.pdf'"),
        INSUFFICIENT_PRIVILEGE,
      )
    })

    it('does not let the reader delete', async () => {
      await expectRefusal(reader.query('delete from document'), INSUFFICIENT_PRIVILEGE)
    })
  })
})
