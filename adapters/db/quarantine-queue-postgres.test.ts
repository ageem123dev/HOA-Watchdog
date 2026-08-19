/**
 * The queue read, against the real database.
 *
 * Seeded through the writer and read back through the adapter, which is the
 * reverse-it test this behaviour needs: what comes out must agree with what went
 * in, including the spelling.
 *
 * Every assertion is scoped to a per-run prefix. Story 1.6b's suite went flaky
 * because parallel files shared a table, and scoping it then exposed two tests
 * that had been resting on another file's leftovers.
 */

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createQuarantineQueue } from './quarantine-queue-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  quarantine-queue adapter tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL must both be set.\n',
  )
}

const RUN_PREFIX = randomBytes(4).toString('hex')

/**
 * A fresh token per test, not per file.
 *
 * The first version scoped to the run and the tests promptly stopped being
 * independent: each one saw everything its predecessors had seeded, so "returns
 * an empty list" could never be true and the two-name case counted four. Story
 * 1.6b hit the same shape from the other direction, where scoping exposed tests
 * that had been resting on another file's leftovers.
 */
let testScope = RUN_PREFIX
const scoped = (suffix: string) => `${testScope} ${suffix}`

let writer: Client
let memberId: string

/**
 * `content_hash` is a real sha256 — the column carries a
 * `document_content_hash_is_sha256` check, and a prefixed placeholder fails it.
 * Scoping for this run rides on the filename and the extracted name instead.
 */
async function seedDocument(filename: string): Promise<string> {
  const { rows } = await writer.query<{ id: string }>(
    `insert into document (content_hash, storage_key, filename, content_type, byte_size, uploaded_by, association_id) values ($1, $2, $3, 'application/pdf', 1024, $4, '00000000-0000-7000-8000-000000000001')
     returning id`,
    [randomBytes(32).toString('hex'), `${RUN_PREFIX}/${randomBytes(6).toString('hex')}`, filename, memberId],
  )

  const id = rows[0]?.id
  if (id === undefined) throw new Error('seeding a document returned no id')

  return id
}

async function hold(documentId: string, extractedName: string): Promise<void> {
  await writer.query(
    'insert into quarantine_item (document_id, extracted_name, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')',
    [documentId, extractedName],
  )
}

/** Only this test's items — the adapter returns the whole queue by design. */
const ours = <T extends { extractedName: string }>(items: readonly T[]) =>
  items.filter((item) => item.extractedName.startsWith(testScope))

describeWithDatabase('reading the quarantine queue', () => {
  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash, association_id) values ($1, 'scrypt$1$1$1$x$y', '00000000-0000-7000-8000-000000000001')
       returning id`,
      [`${RUN_PREFIX}@example.com`],
    )
    const id = rows[0]?.id
    if (id === undefined) throw new Error('seeding a board member returned no id')
    memberId = id
  })

  beforeEach(() => {
    testScope = `${RUN_PREFIX}-${randomBytes(3).toString('hex')}`
  })

  afterAll(async () => {
    // The document cascade takes the quarantine rows with it.
    await writer.query('delete from document where uploaded_by = $1', [memberId])
    await writer.query('delete from board_member where id = $1', [memberId])
    await writer.end()
  })

  it('returns the name as the document said it, with the document it came from', async () => {
    const documentId = await seedDocument(scoped('coastal-invoice.pdf'))
    await hold(documentId, scoped('Coastal  Landscaping'))

    const items = ours(await createQuarantineQueue().held())

    expect(items).toEqual([
      {
        documentId,
        filename: scoped('coastal-invoice.pdf'),
        extractedName: scoped('Coastal  Landscaping'),
      },
    ])
  })

  it('carries no field beyond the three', async () => {
    // `toEqual` above would already catch an extra key, but this states the
    // reason: `normalised_name` sits on the quarantine row and `storage_key` on
    // the joined document, and a `select *` would take both. AD-10 forbids the
    // second leaving the storage adapter at all.
    const documentId = await seedDocument(scoped('shape.pdf'))
    await hold(documentId, scoped('Shape Check'))

    const [held] = ours(await createQuarantineQueue().held())

    expect(held).toBeDefined()
    expect(Object.keys(held ?? {}).sort()).toEqual(['documentId', 'extractedName', 'filename'])
  })

  it('returns both names when one document holds two', async () => {
    const documentId = await seedDocument(scoped('two-vendors.pdf'))
    await hold(documentId, scoped('First Unknown'))
    await hold(documentId, scoped('Second Unknown'))

    const items = ours(await createQuarantineQueue().held())

    expect(items.map((item) => item.extractedName)).toEqual([
      scoped('First Unknown'),
      scoped('Second Unknown'),
    ])
    expect(new Set(items.map((item) => item.documentId))).toEqual(new Set([documentId]))
  })

  it('returns an empty list when nothing is waiting', async () => {
    // Scoped to this run, so it asserts something even while other files hold
    // rows of their own: zero of ours is still zero.
    const items = ours(await createQuarantineQueue().held())

    expect(items).toEqual([])
  })

  it('orders ties by id rather than by however they were inserted', async () => {
    // Inserted in one statement, so `now()` is identical across all three and
    // `created_at` alone cannot decide.
    //
    // The ids are supplied explicitly and in the *reverse* of insertion order,
    // which is what makes this deterministic. Left to the `uuidv7()` default
    // they ascend with insertion, so heap order and id order agree and an
    // adapter with no tiebreak returns the right answer by luck. Measured: with
    // generated ids, dropping the tiebreak was caught in two runs out of three
    // — a detector that is usually right is the kind of guard this project keeps
    // finding in its own tests.
    const documentId = await seedDocument(scoped('same-instant.pdf'))
    const ids = [
      '018f3a2b-0000-7000-8000-00000000000c',
      '018f3a2b-0000-7000-8000-00000000000b',
      '018f3a2b-0000-7000-8000-00000000000a',
    ]
    await writer.query(
      `insert into quarantine_item (id, document_id, extracted_name, association_id)
       values ($1, $4, $5, '00000000-0000-7000-8000-000000000001'),
              ($2, $4, $6, '00000000-0000-7000-8000-000000000001'),
              ($3, $4, $7, '00000000-0000-7000-8000-000000000001')`,
      [
        ids[0],
        ids[1],
        ids[2],
        documentId,
        scoped('inserted first'),
        scoped('inserted second'),
        scoped('inserted third'),
      ],
    )

    const items = ours(await createQuarantineQueue().held()).map((i) => i.extractedName)

    // Id order, which is the reverse of the order they went in.
    expect(items).toEqual([
      scoped('inserted third'),
      scoped('inserted second'),
      scoped('inserted first'),
    ])

    // Cross-check: the database asked independently, by the same rule.
    const { rows } = await writer.query<{ extracted_name: string }>(
      `select extracted_name from quarantine_item
        where document_id = $1
        order by created_at asc, id asc`,
      [documentId],
    )
    expect(items).toEqual(rows.map((r) => r.extracted_name))
  })
})
