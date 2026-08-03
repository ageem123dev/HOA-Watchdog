/**
 * The document repository against a real database.
 *
 * The one thing that cannot be tested with a fake is the thing this adapter
 * exists to get right: whether "have we already got these bytes" is decided by
 * the database or by a read-then-write that two concurrent uploads can both win.
 * A fake repository answers that question however the fake was written.
 *
 * **Requires a database and skips without one**, matching `migrations/`: the
 * suite stays runnable without credentials and the skip is loud.
 */

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { contentHash } from '../../core/ingestion/content-hash'
import { storageKeyFor } from '../../core/ingestion/storage-key'
import { createPostgresDocumentRepository } from './document-repository-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const configured = Boolean(writerUrl)

const describeWithDatabase = configured
  ? describe
  : (describe.skip.bind(null) as unknown as typeof describe)

if (!configured) {
  console.warn(
    '\n  document-repository tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL is not set.\n' +
      '  Run `npm run migrate`, then `npm run test:db`.\n',
  )
}

const bytesFor = (label: string) => new TextEncoder().encode(`%PDF-1.7 ${label}`)

/**
 * Block until Postgres reports a backend genuinely waiting on a lock to insert
 * into `document`.
 *
 * A timer would leave the interleaving to chance, and a test that silently fails
 * to interleave passes for the wrong reason. This throws instead — if the second
 * insert never blocked, the scenario did not happen and the result means
 * nothing.
 */
async function waitUntilBlockedOnInsert(client: Client): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { rows } = await client.query<{ blocked: number }>(
      `select count(*)::int as blocked
         from pg_stat_activity
        where wait_event_type = 'Lock'
          and query ilike 'insert into document%'`,
    )

    if ((rows[0]?.blocked ?? 0) > 0) return

    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  throw new Error(
    'the adapter’s insert never blocked, so the interleaving this test needs did not happen',
  )
}

const newDocument = (label: string, uploadedBy: string) => {
  const hash = contentHash(bytesFor(label))

  return {
    contentHash: hash,
    storageKey: storageKeyFor(hash),
    filename: `${label}.pdf`,
    contentType: 'application/pdf',
    byteSize: bytesFor(label).length,
    uploadedBy,
  }
}

describeWithDatabase('createPostgresDocumentRepository', () => {
  let pool: Pool
  let admin: Client
  let boardMemberId: string
  const repository = createPostgresDocumentRepository({
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
      [`repo-test-${Date.now()}@example.test`],
    )
    boardMemberId = rows[0]!.id
  })

  afterAll(async () => {
    await admin.query('delete from document where uploaded_by = $1', [boardMemberId])
    await admin.query('delete from board_member where id = $1', [boardMemberId])
    await admin.end()
    await pool.end()
  })

  it('records a document and reports it as new', async () => {
    const result = await repository.record(newDocument(`fresh-${Date.now()}`, boardMemberId))

    expect(result.alreadyHeld).toBe(false)
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('writes every column through, so nothing is silently dropped', async () => {
    const document = newDocument(`columns-${Date.now()}`, boardMemberId)

    const { id } = await repository.record(document)
    const { rows } = await admin.query('select * from document where id = $1', [id])

    expect(rows[0]).toMatchObject({
      content_hash: document.contentHash,
      storage_key: document.storageKey,
      filename: document.filename,
      content_type: document.contentType,
      uploaded_by: boardMemberId,
    })
    expect(Number(rows[0].byte_size)).toBe(document.byteSize)
  })

  it('reports the second sighting of the same bytes as already held', async () => {
    const document = newDocument(`repeat-${Date.now()}`, boardMemberId)

    const first = await repository.record(document)
    const second = await repository.record(document)

    expect(first.alreadyHeld).toBe(false)
    expect(second.alreadyHeld).toBe(true)
  })

  it('returns the existing document id, not a new one', async () => {
    // The caller uses this id to replace derived rows. A different id there
    // means AD-13 replaces the wrong document's data.
    const document = newDocument(`same-id-${Date.now()}`, boardMemberId)

    const first = await repository.record(document)
    const second = await repository.record({ ...document, filename: 'renamed.pdf' })

    expect(second.id).toBe(first.id)
  })

  it('keeps the first filename, because the bytes are the document', async () => {
    const document = newDocument(`first-name-${Date.now()}`, boardMemberId)

    const { id } = await repository.record(document)
    await repository.record({ ...document, filename: 'later-name.pdf' })
    const { rows } = await admin.query('select filename from document where id = $1', [id])

    expect(rows[0].filename).toBe(document.filename)
  })

  it('leaves exactly one row after a repeat', async () => {
    const document = newDocument(`one-row-${Date.now()}`, boardMemberId)

    await repository.record(document)
    await repository.record(document)
    const { rows } = await admin.query('select id from document where content_hash = $1', [
      document.contentHash,
    ])

    expect(rows).toHaveLength(1)
  })

  it('resolves four simultaneous records of the same bytes to one row and one id', async () => {
    // Worth keeping, but read it for what it is: `Promise.all` does not force an
    // interleaving, so this passes whether or not the race is actually closed.
    // It was verified against a deliberately broken read-then-write
    // implementation and still passed. The test below is the one that
    // discriminates.
    const document = newDocument(`race-${Date.now()}`, boardMemberId)

    const results = await Promise.all([
      repository.record(document),
      repository.record(document),
      repository.record(document),
      repository.record(document),
    ])

    const { rows } = await admin.query('select id from document where content_hash = $1', [
      document.contentHash,
    ])

    expect(rows).toHaveLength(1)
    expect(new Set(results.map((result) => result.id)).size).toBe(1)
    expect(results.filter((result) => !result.alreadyHeld)).toHaveLength(1)
  })

  it('waits for an in-flight insert of the same bytes instead of racing it', async () => {
    // The deterministic version, and the one that earns the claim.
    //
    // Another transaction inserts the same hash and holds it uncommitted. The
    // adapter then records those bytes, and its insert blocks on the unique
    // index. We wait until Postgres reports it genuinely blocked — rather than
    // guessing with a timer — and only then commit.
    //
    // A read-then-write implementation fails here: its SELECT runs before the
    // commit and finds nothing, so it inserts, blocks, and is then handed a
    // unique violation the moment the other transaction lands.
    const document = newDocument(`interleave-${Date.now()}`, boardMemberId)
    const holder = new Client({ connectionString: writerUrl })
    await holder.connect()

    try {
      await holder.query('begin')
      const { rows } = await holder.query<{ id: string }>(
        `insert into document
           (content_hash, storage_key, filename, content_type, byte_size, uploaded_by)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [
          document.contentHash,
          document.storageKey,
          'held-by-the-other-transaction.pdf',
          document.contentType,
          document.byteSize,
          document.uploadedBy,
        ],
      )
      const firstId = rows[0]!.id

      const pending = repository.record(document)
      await waitUntilBlockedOnInsert(admin)
      await holder.query('commit')

      expect(await pending).toEqual({ id: firstId, alreadyHeld: true })
    } finally {
      await holder.query('rollback').catch(() => undefined)
      await holder.end()
    }
  })

  it('lets a constraint violation escape rather than reporting a phantom success', async () => {
    // An unsupported content type must not come back as "recorded".
    const document = { ...newDocument(`bad-type-${Date.now()}`, boardMemberId), contentType: 'application/zip' }

    await expect(repository.record(document)).rejects.toMatchObject({ code: '23514' })
  })

  it('lets an unknown uploader escape as a foreign-key violation', async () => {
    const document = {
      ...newDocument(`bad-user-${Date.now()}`, '00000000-0000-7000-8000-000000000000'),
    }

    await expect(repository.record(document)).rejects.toMatchObject({ code: '23503' })
  })

  describe('replaceDerivedRows', () => {
    it('accepts a document id without failing, so the AD-13 seam is callable today', async () => {
      const { id } = await repository.record(newDocument(`derived-${Date.now()}`, boardMemberId))

      await expect(repository.replaceDerivedRows(id)).resolves.toBeUndefined()
    })
  })
})
