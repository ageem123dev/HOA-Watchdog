/**
 * Resolution against the real database.
 *
 * The whole point of this adapter is that two writes happen together or not at
 * all, and that is only observable against a real transaction. Every case here
 * asserts *both* halves — the vendor table's row count and the hold's absence —
 * because each is an independent reading of "resolved" and a bug that satisfied
 * one while breaking the other is precisely what one assertion would miss.
 *
 * Scoped per test in `beforeEach`, not per file. The queue adapter's first
 * version scoped per run and its tests promptly stopped being independent.
 */

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createVendorResolution } from './vendor-resolution-postgres'

// The writer only. This adapter connects through `readWriterDatabaseUrl()` and
// this file opens one writer client; requiring the reader too meant an
// environment with just the writer skipped the whole suite while the run still
// reported success. Raised in review — a suite that silently does not run is
// indistinguishable from one that passed.
const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const configured = Boolean(writerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  vendor-resolution adapter tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL must be set.\n',
  )
}

const RUN_PREFIX = randomBytes(4).toString('hex')
let testScope = RUN_PREFIX
const scoped = (suffix: string) => `${testScope} ${suffix}`

let writer: Client
let memberId: string

async function seedDocument(): Promise<string> {
  const { rows } = await writer.query<{ id: string }>(
    `insert into document (content_hash, storage_key, filename, content_type, byte_size, uploaded_by, association_id) values ($1, $2, $3, 'application/pdf', 1024, $4, '00000000-0000-7000-8000-000000000001')
     returning id`,
    [
      randomBytes(32).toString('hex'),
      `${RUN_PREFIX}/${randomBytes(6).toString('hex')}`,
      scoped('invoice.pdf'),
      memberId,
    ],
  )

  const id = rows[0]?.id
  if (id === undefined) throw new Error('seeding a document returned no id')

  return id
}

async function hold(documentId: string, extractedName: string): Promise<void> {
  await writer.query('insert into quarantine_item (document_id, extracted_name, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')', [
    documentId,
    extractedName,
  ])
}

async function seedVendor(displayName: string): Promise<string> {
  const { rows } = await writer.query<{ id: string }>(
    'insert into vendor (display_name, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\') returning id',
    [displayName],
  )

  const id = rows[0]?.id
  if (id === undefined) throw new Error('seeding a vendor returned no id')

  return id
}

/** How many holds remain for this document — the second, independent reading. */
async function holdsFor(documentId: string): Promise<number> {
  const { rows } = await writer.query<{ count: string }>(
    'select count(*)::text as count from quarantine_item where document_id = $1',
    [documentId],
  )

  return Number(rows[0]?.count ?? '-1')
}

/** Vendors this test created, so the conservation check ignores other runs. */
async function vendorCount(): Promise<number> {
  const { rows } = await writer.query<{ count: string }>(
    'select count(*)::text as count from vendor where display_name like $1',
    [`${testScope}%`],
  )

  return Number(rows[0]?.count ?? '-1')
}

describeWithDatabase('resolving a held document', () => {
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
    await writer.query('delete from document where uploaded_by = $1', [memberId])
    await writer.query('delete from vendor where display_name like $1', [`${RUN_PREFIX}%`])
    await writer.query('delete from board_member where id = $1', [memberId])
    await writer.end()
  })

  describe('confirming a name as a new vendor', () => {
    it('creates the vendor and clears the hold', async () => {
      // AC1, and both halves asserted independently.
      const documentId = await seedDocument()
      const name = scoped('Coastal Landscaping')
      await hold(documentId, name)

      const result = await createVendorResolution().confirmAsNew(documentId, name)

      expect(result.outcome).toBe('created')
      expect(await holdsFor(documentId)).toBe(0)
      expect(await vendorCount()).toBe(1)
    })

    it('creates a vendor carrying the name as the document said it', async () => {
      // The reverse-it test: what went in must come back out. A vendor recorded
      // under a folded or trimmed name is a different vendor from the one the
      // treasurer confirmed.
      const documentId = await seedDocument()
      const name = scoped('Coastal  Landscaping  &  Sons')
      await hold(documentId, name)

      const result = await createVendorResolution().confirmAsNew(documentId, name)

      // Asserted rather than narrowed with a ternary. Passing `null` on the
      // unexpected branch reported a `display_name` mismatch, which names the
      // wrong failure — the outcome was wrong, not the name. Raised in review.
      expect(result.outcome).toBe('created')
      if (result.outcome === 'already-resolved') throw new Error('unreachable')

      const { rows } = await writer.query<{ display_name: string }>(
        'select display_name from vendor where id = $1',
        [result.vendorId],
      )
      expect(rows[0]?.display_name).toBe(name)
    })

    it('matches the winner rather than failing when two confirmations race', async () => {
      // C3 and C5. The unique index is on the normalised name, so the second
      // confirmation of the same name collides. Reporting the constraint
      // violation would show a treasurer a failure for a question that was
      // answered correctly, twice.
      const first = await seedDocument()
      const second = await seedDocument()
      const name = scoped('Twice Confirmed')
      await hold(first, name)
      await hold(second, name)

      const resolution = createVendorResolution()
      const a = await resolution.confirmAsNew(first, name)
      const b = await resolution.confirmAsNew(second, name)

      expect(a.outcome).toBe('created')
      expect(b.outcome).toBe('matched')
      expect(await vendorCount()).toBe(1)
      expect(await holdsFor(second)).toBe(0)
    })

    it('reports an item somebody already resolved', async () => {
      // C4 and AC5. Without the row-count check this creates a second vendor
      // for a name that was already answered.
      const documentId = await seedDocument()
      const name = scoped('Answered Already')
      await hold(documentId, name)

      const resolution = createVendorResolution()
      await resolution.confirmAsNew(documentId, name)
      const again = await resolution.confirmAsNew(documentId, name)

      expect(again.outcome).toBe('already-resolved')
      expect(await vendorCount()).toBe(1)
    })

    it('leaves the hold in place when the vendor cannot be created', async () => {
      // C1, the worst outcome in this story: a hold cleared with nobody having
      // answered means the document leaves the queue and no surface ever asks
      // again.
      //
      // Forcing it needs a name that *matches the hold* and still fails the
      // vendor insert, or the run stops at `already-resolved` before reaching
      // the write. Trailing whitespace does both: it normalises away, so the
      // hold on 'Acme' matches, while `display_name` is measured before folding
      // and 300 spaces put it past the 200-character limit. That asymmetry is
      // the same one story 1.6b's guard was rebuilt around.
      const documentId = await seedDocument()
      const held = scoped('Acme')
      await hold(documentId, held)

      // Constrained to the length violation. A bare `rejects.toThrow()` passes
      // for any rejection at all — a missing `vendor_normalised_name`, a wrong
      // column, a dead connection — and the two state assertions below still
      // hold, because nothing was written in any of those cases either. The test
      // would report success while proving nothing about the constraint it was
      // built around. Raised in review; it is this project's signature defect.
      await expect(
        createVendorResolution().confirmAsNew(documentId, `${held}${' '.repeat(300)}`),
      ).rejects.toThrow(/vendor_display_name_length/)

      expect(await holdsFor(documentId)).toBe(1)
      expect(await vendorCount()).toBe(0)
    })
  })

  describe('matching a name to an existing vendor', () => {
    it('clears the hold without creating a vendor', async () => {
      // AC2. The count is the cross-check: "no vendor is created" is a
      // conservation property, independent of what the outcome says.
      const documentId = await seedDocument()
      const name = scoped('Coastal Landscapping')
      await hold(documentId, name)
      const vendorId = await seedVendor(scoped('Coastal Landscaping'))

      const before = await vendorCount()
      const result = await createVendorResolution().matchToExisting(documentId, name, vendorId)

      expect(result).toEqual({ outcome: 'matched', vendorId })
      expect(await holdsFor(documentId)).toBe(0)
      expect(await vendorCount()).toBe(before)
    })

    it('refuses a vendor id that does not exist, and keeps the hold', async () => {
      // D1 and D2. Accepting an unknown id and clearing the hold anyway would
      // send the document out of the queue pointing at nothing, which is C1's
      // failure reached by a different route.
      const documentId = await seedDocument()
      const name = scoped('Unknown Target')
      await hold(documentId, name)

      await expect(
        createVendorResolution().matchToExisting(
          documentId,
          name,
          '018f3a2b-0000-7000-8000-0000000000ff',
        ),
      ).rejects.toThrow(/no vendor with id/)

      expect(await holdsFor(documentId)).toBe(1)
    })

    it('reports an item somebody already resolved', async () => {
      // D3.
      const documentId = await seedDocument()
      const name = scoped('Matched Twice')
      await hold(documentId, name)
      const vendorId = await seedVendor(scoped('Some Vendor'))

      const resolution = createVendorResolution()
      await resolution.matchToExisting(documentId, name, vendorId)
      const again = await resolution.matchToExisting(documentId, name, vendorId)

      expect(again.outcome).toBe('already-resolved')
    })

    it('clears only the hold it was asked about', async () => {
      // One document held for two unrecognised names is two questions. Answering
      // one must not answer the other, and `delete where document_id = $1` alone
      // would.
      const documentId = await seedDocument()
      const answered = scoped('First Unknown')
      const untouched = scoped('Second Unknown')
      await hold(documentId, answered)
      await hold(documentId, untouched)
      const vendorId = await seedVendor(scoped('A Vendor'))

      await createVendorResolution().matchToExisting(documentId, answered, vendorId)

      const { rows } = await writer.query<{ extracted_name: string }>(
        'select extracted_name from quarantine_item where document_id = $1',
        [documentId],
      )
      expect(rows.map((r) => r.extracted_name)).toEqual([untouched])
    })
  })
})
