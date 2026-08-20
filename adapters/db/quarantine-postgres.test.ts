/**
 * `Quarantine` against real Postgres.
 *
 * The claim worth testing here is idempotency, and it cannot be tested with a
 * fake: the rule that makes a second *spelling* the same question lives in a
 * generated column and a composite unique index, not in this file. A fake would
 * only agree with whatever the adapter already believes.
 */

import { randomBytes } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createQuarantine } from './quarantine-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const configured = Boolean(writerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn('\n  quarantine adapter tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL must be set.\n')
}

const RUN_PREFIX = randomBytes(4).toString('hex')
const named = (suffix: string) => `${RUN_PREFIX} ${suffix}`

describeWithDatabase('createQuarantine', () => {
  const quarantine = createQuarantine()
  let seed: Client

  async function makeDocument(suffix: string): Promise<string> {
    const { rows } = await seed.query(
      `insert into document (filename, content_type, byte_size, content_hash, storage_key, uploaded_by, association_id) values ($1, 'application/pdf', 1024, $2, $3, (select id from board_member limit 1), '00000000-0000-7000-8000-000000000001')
       returning id`,
      [named(suffix), randomBytes(32).toString('hex'), `documents/${randomBytes(8).toString('hex')}`],
    )
    return rows[0].id
  }

  beforeAll(async () => {
    seed = new Client({ connectionString: writerUrl })
    await seed.connect()
  })

  afterAll(async () => {
    if (!seed) return
    // The cascade takes the items with the documents.
    await seed.query('delete from document where filename like $1', [`${RUN_PREFIX}%`]).catch(() => undefined)
    await seed.end().catch(() => undefined)
  })

  it('records a name against its document', async () => {
    const documentId = await makeDocument('one.pdf')

    await quarantine.hold(documentId, named('Unknown Roofing'))

    await expect(quarantine.heldNames(documentId)).resolves.toEqual([named('Unknown Roofing')])
  })

  it('keeps the name as it was given, not folded', async () => {
    const documentId = await makeDocument('spelling.pdf')
    const spelled = `  ${named('EverGREEN   Gardens')} `

    await quarantine.hold(documentId, spelled)

    await expect(quarantine.heldNames(documentId)).resolves.toEqual([spelled])
  })

  it('holding the same name twice holds it once', async () => {
    const documentId = await makeDocument('twice.pdf')

    await quarantine.hold(documentId, named('Acme Plumbing'))
    await quarantine.hold(documentId, named('Acme Plumbing'))

    await expect(quarantine.heldNames(documentId)).resolves.toHaveLength(1)
  })

  it('holding a second spelling of a held name holds it once', async () => {
    // The reason the unique index is keyed on the normalised column. A plain
    // "already exactly this string?" check would let this through and ask the
    // treasurer the same question twice.
    const documentId = await makeDocument('spellings.pdf')

    await quarantine.hold(documentId, named('Acme Plumbing'))
    await quarantine.hold(documentId, `  ${named('ACME   plumbing')} `)

    await expect(quarantine.heldNames(documentId)).resolves.toHaveLength(1)
  })

  it('does not raise when absorbing a duplicate', async () => {
    // The port promises idempotency rather than an error the caller has to
    // recognise and swallow. A caller that had to catch 23505 would eventually
    // catch something else with it.
    const documentId = await makeDocument('quiet.pdf')

    await quarantine.hold(documentId, named('Quiet Vendor'))

    await expect(quarantine.hold(documentId, named('Quiet Vendor'))).resolves.toBeUndefined()
  })

  it('holds two different names for one document', async () => {
    const documentId = await makeDocument('two-names.pdf')

    await quarantine.hold(documentId, named('First Unknown'))
    await quarantine.hold(documentId, named('Second Unknown'))

    await expect(quarantine.heldNames(documentId)).resolves.toHaveLength(2)
  })

  it('holds two documents for the same name', async () => {
    // Two invoices from one unfamiliar vendor are two decisions waiting, and
    // an index keyed on the name alone would silently keep only the first.
    const first = await makeDocument('first.pdf')
    const second = await makeDocument('second.pdf')
    const vendor = named('Northwind Roofing')

    await quarantine.hold(first, vendor)
    await quarantine.hold(second, vendor)

    await expect(quarantine.heldNames(first)).resolves.toHaveLength(1)
    await expect(quarantine.heldNames(second)).resolves.toHaveLength(1)
  })

  it('reports nothing for a document that is not held', async () => {
    const documentId = await makeDocument('clear.pdf')

    await expect(quarantine.heldNames(documentId)).resolves.toEqual([])
  })

  it('reports nothing for a document that does not exist', async () => {
    // Not an error. "No document" and "no holds" are the same answer to the
    // question this method asks.
    await expect(
      quarantine.heldNames('018f3a2b-0000-7000-8000-00000000dead'),
    ).resolves.toEqual([])
  })

  it('refuses a name the table will not store, rather than absorbing it', async () => {
    // `on conflict do nothing` must not swallow a check violation. A name that
    // breaks the bound is a defect somewhere upstream, and silently dropping it
    // would leave a document unheld with nothing to show for it.
    const documentId = await makeDocument('overlong.pdf')

    await expect(quarantine.hold(documentId, 'x'.repeat(201))).rejects.toMatchObject({
      code: '23514',
    })
  })
})
