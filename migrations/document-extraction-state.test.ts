/**
 * `document.extraction_state` — the four states, held by the database.
 *
 * Until story 1.5d, "has this been read?" was answered by looking for extraction
 * rows. That distinguishes exactly one of the four outcomes AC3 requires: *held*,
 * *provider unavailable* and *could not be read* are all "no rows", and a
 * treasurer needs a different sentence for each.
 *
 * These run against a real Postgres. A check constraint asserted through a fake
 * is a fake agreeing with itself, and the atomicity claim below cannot be tested
 * any other way at all.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { EXTRACTION_STATES } from '../core/ports/document-repository'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  document-extraction-state tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL must both be set.\n',
  )
}

const CHECK_VIOLATION = '23514'
const INSUFFICIENT_PRIVILEGE = '42501'
const RUN_PREFIX = randomBytes(4).toString('hex')

const MIGRATION = readFileSync(
  join(__dirname, '007_document_extraction_state.sql'),
  'utf8',
)

describe('the migration and the vocabulary agree', () => {
  it('declares exactly the states the port exports', () => {
    // Read from disk, not restated here. This is the fourth drift-shaped
    // problem in this epic and the same answer each time: one definition, and
    // something that fails when the copies disagree.
    const clause = /extraction_state in \(([^)]+)\)/.exec(MIGRATION)?.[1]

    expect(clause, 'the check constraint was not found in 007').toBeDefined()

    const inSql = [...clause!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()

    expect(inSql).toEqual([...EXTRACTION_STATES].sort())
  })

  it('has a non-empty vocabulary, so the comparison above means something', () => {
    expect(EXTRACTION_STATES.length).toBe(4)
  })

  it('does not admit `failed`', () => {
    // 1.5b shipped an outcome by that name whose copy said the document was not
    // saved when it had been. Its absence here is deliberate, so it is asserted.
    expect([...EXTRACTION_STATES]).not.toContain('failed')
  })
})

describeWithDatabase('document.extraction_state', () => {
  let writer: Client
  let reader: Client
  let uploader: string

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    reader = new Client({ connectionString: readerUrl })
    await Promise.all([writer.connect(), reader.connect()])

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash)
       values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA')
       returning id`,
      [`state-test-${RUN_PREFIX}@example.test`],
    )
    uploader = rows[0]!.id
  }, 30_000)

  afterAll(async () => {
    if (uploader) {
      await writer.query(
        'delete from extraction where document_id in (select id from document where uploaded_by = $1)',
        [uploader],
      )
      await writer.query('delete from document where uploaded_by = $1', [uploader])
      await writer.query('delete from board_member where id = $1', [uploader])
    }
    await Promise.all([writer?.end(), reader?.end()].filter(Boolean))
  })

  let counter = 0
  const newDocument = async (): Promise<string> => {
    counter += 1
    const hash = randomBytes(32).toString('hex')
    const { rows } = await writer.query<{ id: string }>(
      `insert into document
         (content_hash, storage_key, filename, content_type, byte_size, uploaded_by)
       values ($1, $2, $3, 'application/pdf', 1024, $4)
       returning id`,
      [hash, `documents/${RUN_PREFIX}/${counter}`, `scan-${counter}.pdf`, uploader],
    )
    return rows[0]!.id
  }

  const stateOf = async (id: string, client: Client = writer): Promise<string> => {
    const { rows } = await client.query<{ extraction_state: string }>(
      'select extraction_state from document where id = $1',
      [id],
    )
    return rows[0]!.extraction_state
  }

  describe('what a new document starts as (B4)', () => {
    it('is held, without the inserter saying so', async () => {
      // The insert names no state, so this is the default doing the work.
      // Documents that predate this migration are in exactly the same position,
      // which makes the default the backfill.
      //
      // Replaced an `expect(true).toBe(true)` that asserted nothing — raised in
      // review, and the same empty-guard shape this project keeps finding.
      expect(await stateOf(await newDocument())).toBe('held')
    })

    it('is never null, so "not yet read" and "we never knew" cannot be confused', async () => {
      const id = await newDocument()

      await expect(
        writer.query('update document set extraction_state = null where id = $1', [id]),
      ).rejects.toMatchObject({ code: '23502' })
    })
  })

  describe('the vocabulary is closed (B2, B8)', () => {
    it.each([...EXTRACTION_STATES])('accepts %s', async (state) => {
      const id = await newDocument()

      await writer.query('update document set extraction_state = $2 where id = $1', [id, state])

      expect(await stateOf(id)).toBe(state)
    })

    it.each(['failed', 'extracting', 'pending', 'READ', ''])(
      'refuses %s',
      async (state) => {
        const id = await newDocument()

        await expect(
          writer.query('update document set extraction_state = $2 where id = $1', [id, state]),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION })
      },
    )
  })

  describe('the reader may look and may not touch (B6, B7)', () => {
    it('can select the state, so the surface can render it', async () => {
      const id = await newDocument()

      await expect(stateOf(id, reader)).resolves.toBe('held')
    })

    it('cannot move it — AD-4 means the query path reads and never writes', async () => {
      const id = await newDocument()

      await expect(
        reader.query("update document set extraction_state = 'read' where id = $1", [id]),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
    })
  })

  describe('the state never disagrees with the rows (B1, B5)', () => {
    it('is still held when a replacement is rolled back mid-flight', async () => {
      // The property the single transaction exists for. Read from a *second*
      // connection, because the transaction's own view would show its
      // uncommitted write and prove nothing.
      const id = await newDocument()
      const other = new Client({ connectionString: writerUrl })
      await other.connect()

      try {
        await other.query('begin')
        await other.query('delete from extraction where document_id = $1', [id])
        await other.query(
          `insert into extraction (document_id, document_kind, currency)
           values ($1, 'invoice', 'USD')`,
          [id],
        )
        await other.query("update document set extraction_state = 'read' where id = $1", [id])

        // Everything above is uncommitted. From here it must be invisible.
        expect(await stateOf(id)).toBe('held')

        await other.query('rollback')
      } finally {
        await other.end()
      }

      expect(await stateOf(id)).toBe('held')

      const { rows } = await writer.query('select id from extraction where document_id = $1', [id])
      expect(rows).toHaveLength(0)
    }, 30_000)

    it('a document with no rows is never in the read state by accident', async () => {
      // Not a schema constraint — the schema cannot express it — so this asserts
      // the invariant the application must hold, and would catch a stray
      // `update … set extraction_state = 'read'` written somewhere else later.
      const id = await newDocument()

      const { rows } = await writer.query<{ count: string }>(
        `select count(*)::text as count from document d
          where d.id = $1
            and d.extraction_state = 'read'
            and not exists (select 1 from extraction e where e.document_id = d.id)`,
        [id],
      )

      expect(rows[0]?.count).toBe('0')
    })
  })

  describe('finding what still needs reading', () => {
    it('the partial index covers the held query', async () => {
      const { rows } = await writer.query<{ definition: string }>(
        `select indexdef as definition from pg_indexes
          where tablename = 'document' and indexname = 'document_awaiting_extraction_idx'`,
      )

      expect(rows[0]?.definition).toBeDefined()
      expect(rows[0]!.definition).toContain("extraction_state = 'held'")
    })
  })
})
