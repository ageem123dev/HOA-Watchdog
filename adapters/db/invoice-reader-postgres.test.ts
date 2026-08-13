/**
 * Reading invoices for the duplicate detector, against a real database.
 *
 * Three things here cannot be asserted anywhere else, and each one is a way to
 * ship a detector that reports confidently wrong things:
 *
 * - **The null semantics are SQL's, not a guard's.** `total_amount = $2` with a
 *   null parameter matches nothing because `null = null` is null. A mock would
 *   answer whatever it was told, and the failure — every unreadable invoice
 *   pairing with every other — only appears against real rows.
 * - **`vendor_normalised_name` is the database's function.** Its agreement with
 *   `normaliseVendorName` in TypeScript is a property of two implementations,
 *   and only one of them can be run here.
 * - **`numeric(14,2)` renders exactly.** The detector compares decimal strings,
 *   so what Postgres actually puts in them is the thing under test.
 */

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createInvoiceReader } from './invoice-reader-postgres'
import { setPoolTimeZone } from './pool-time-zone'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const adminUrl = process.env.DATABASE_URL
const configured = Boolean(writerUrl && adminUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  invoice reader tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and DATABASE_URL must both be set.\n',
  )
}

const RUN_PREFIX = `inv-${randomBytes(4).toString('hex')}`

/**
 * Scoped to this run, because vitest runs files in parallel.
 *
 * Both suites here and in `duplicate-detection.test.ts` seed the same vendor
 * with the same amounts, so a concurrent run's rows can come back as prior
 * candidates — adding pairs to one suite's expectations or breaking another's
 * zero-match assertion. The vendor is the column the query narrows on, so
 * scoping it is what isolates the runs. Raised by CodeRabbit.
 */
const VENDOR = `Acme ${RUN_PREFIX} Plumbing`

let writer: Client
let owner: Client
let memberId: string

/** Documents in upload order, so "earlier" means something. */
const documents = new Map<string, string>()

async function seedDocument(label: string, uploadedAt: string): Promise<string> {
  const { rows } = await writer.query<{ id: string }>(
    `insert into document
       (content_hash, storage_key, filename, content_type, byte_size, uploaded_by, uploaded_at)
     values ($1, $2, $3, 'application/pdf', 1024, $4, $5)
     returning id`,
    [
      // A 64-character lowercase hex string, because `document_content_hash_is_sha256`
      // checks the shape rather than trusting the caller.
      randomBytes(32).toString('hex'),
      `${RUN_PREFIX}/${label}`,
      `${RUN_PREFIX}-${label}.pdf`,
      memberId,
      uploadedAt,
    ],
  )
  const id = rows[0]!.id
  documents.set(label, id)

  return id
}

interface InvoiceFixture {
  readonly vendor?: string | null
  readonly number?: string | null
  readonly issuedOn?: string | null
  readonly amount?: string | null
}

async function seedInvoice(documentLabel: string, fixture: InvoiceFixture = {}): Promise<string> {
  const { rows } = await writer.query<{ id: string }>(
    `insert into extraction
       (document_id, document_kind, vendor_name, document_number, issued_on, total_amount, currency)
     values ($1, 'invoice', $2, $3, $4::date, $5::numeric, 'USD')
     returning id`,
    [
      documents.get(documentLabel),
      fixture.vendor === undefined ? VENDOR : fixture.vendor,
      fixture.number === undefined ? 'INV-1001' : fixture.number,
      fixture.issuedOn === undefined ? '2026-03-14' : fixture.issuedOn,
      fixture.amount === undefined ? '250.00' : fixture.amount,
    ],
  )

  return rows[0]!.id
}

describeWithDatabase('reading invoices', () => {
  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    owner = new Client({ connectionString: adminUrl })
    await owner.connect()

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash)
       values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA') returning id`,
      [`invoice-reader-${RUN_PREFIX}@example.test`],
    )
    memberId = rows[0]!.id

    await seedDocument('first', '2026-03-01T09:00:00Z')
    await seedDocument('second', '2026-04-01T09:00:00Z')
    await seedDocument('third', '2026-05-01T09:00:00Z')
  })

  afterAll(async () => {
    try {
      // Extractions cascade with their document, which is migration 006's rule.
      await owner.query(`delete from document where storage_key like $1`, [`${RUN_PREFIX}/%`])
      await owner.query(`delete from board_member where email like $1`, [`invoice-reader-${RUN_PREFIX}%`])
    } finally {
      await Promise.allSettled([owner.end(), writer.end()])
    }
  })

  it('can select at all, which is the grant this detector depends on', async () => {
    // If the writer had no SELECT on `extraction` this rejects with 42501 at
    // runtime, during an upload, and nothing else in the suite would notice.
    await expect(createInvoiceReader().invoicesOn(documents.get('first')!)).resolves.toBeDefined()
  })

  it('returns every invoice a document carries, not the first', async () => {
    // Migration 006 allows many extraction rows per document by design, and a
    // real document in this database has three. A reader that returned one
    // would check the first invoice of an upload and ignore the rest.
    const document = await seedDocument('multi', '2026-03-02T09:00:00Z')
    await seedInvoice('multi', { number: 'INV-A' })
    await seedInvoice('multi', { number: 'INV-B' })
    await seedInvoice('multi', { number: 'INV-C' })

    const found = await createInvoiceReader().invoicesOn(document)

    expect(found.map((invoice) => invoice.documentNumber).sort()).toEqual([
      'INV-A',
      'INV-B',
      'INV-C',
    ])
  })

  it('renders the date as a calendar day and the amount as an exact decimal', async () => {
    // The two conversions the detector's correctness rests on. A `Date` here
    // would shift the day west of Greenwich, and a float would not be exact.
    await seedInvoice('first', { issuedOn: '2026-03-14', amount: '250.00' })

    const [invoice] = await createInvoiceReader().invoicesOn(documents.get('first')!)

    expect(invoice!.issuedOn).toBe('2026-03-14')
    expect(invoice!.amount).toBe('250.00')
  })

  it('reports the upload day the same way whatever timezone the session is set to', async () => {
    // **Story 4.4's finding, applied back here.** `to_char` on a `timestamptz`
    // renders it in the *session's* timezone, so this column answered a
    // different calendar day on a connection set west of Greenwich — and
    // `documentUploadedAt` is what `monthOf` falls back to, so a duplicate
    // finding would have been keyed on the wrong month.
    //
    // Uploaded at 02:00 UTC, which is the previous day in Los Angeles. The
    // timezone is set on every pooled connection rather than one, because the
    // reader checks out its own; see `pool-time-zone.ts`.
    const document = await seedDocument('tz-boundary', '2026-04-01T02:00:00Z')
    await seedInvoice('tz-boundary', { issuedOn: '2026-03-14', amount: '99.00' })

    try {
      await setPoolTimeZone('America/Los_Angeles')

      const [invoice] = await createInvoiceReader().invoicesOn(document)

      expect(invoice!.documentUploadedAt).toBe('2026-04-01')
      // The `issued_on` column needs no cast — it is already a `date`, and this
      // pins that the fix did not quietly change it.
      expect(invoice!.issuedOn).toBe('2026-03-14')
    } finally {
      await setPoolTimeZone('UTC')
    }
  })

  it('keeps a null as a null rather than inventing a value', async () => {
    const document = await seedDocument('unreadable', '2026-03-03T09:00:00Z')
    await seedInvoice('unreadable', { vendor: null, number: null, issuedOn: null, amount: null })

    const [invoice] = await createInvoiceReader().invoicesOn(document)

    expect(invoice).toMatchObject({
      vendorName: null,
      documentNumber: null,
      issuedOn: null,
      amount: null,
    })
  })
})

describeWithDatabase('finding earlier invoices to compare against', () => {
  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    owner = new Client({ connectionString: adminUrl })
    await owner.connect()

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash)
       values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA') returning id`,
      [`invoice-prior-${RUN_PREFIX}@example.test`],
    )
    memberId = rows[0]!.id

    await seedDocument('older', '2026-02-01T09:00:00Z')
    await seedDocument('newer', '2026-06-01T09:00:00Z')
    await seedDocument('newest', '2026-07-01T09:00:00Z')
  })

  afterAll(async () => {
    try {
      await owner.query(`delete from document where storage_key like $1`, [`${RUN_PREFIX}/%`])
      await owner.query(`delete from board_member where email like $1`, [`invoice-prior-${RUN_PREFIX}%`])
    } finally {
      await Promise.allSettled([owner.end(), writer.end()])
    }
  })

  const subject = (overrides: Partial<Record<string, string | null>> = {}) => ({
    extractionId: 'unused',
    documentId: documents.get('newer')!,
    vendorName: VENDOR,
    documentNumber: 'INV-1001',
    issuedOn: '2026-03-14',
    amount: '250.00',
    documentUploadedAt: '2026-06-01',
    ...overrides,
  })

  it('finds an earlier invoice with the same vendor and amount', async () => {
    await seedInvoice('older', { amount: '250.00' })

    const found = await createInvoiceReader().priorCandidates(subject())

    expect(found.map((invoice) => invoice.documentId)).toContain(documents.get('older'))
  })

  it('folds the vendor name with the database function the rest of the system uses', async () => {
    // `vendor_normalised_name` is what `vendor` and `quarantine_item` generate
    // their keys from. This asserts the detector agrees with them.
    await seedInvoice('older', { vendor: `  ACME   ${RUN_PREFIX}   PLUMBING  `, amount: '311.00' })

    const found = await createInvoiceReader().priorCandidates(subject({ amount: '311.00' }))

    expect(found).toHaveLength(1)
  })

  it('does not reach forward to a document uploaded later', async () => {
    // If two uploads duplicate each other only the second can be said to
    // duplicate anything. Reaching forward makes both raise a finding and the
    // register reports one event twice.
    await seedInvoice('newest', { amount: '412.00' })

    const found = await createInvoiceReader().priorCandidates(subject({ amount: '412.00' }))

    expect(found).toHaveLength(0)
  })

  it('does not return the subject document itself', async () => {
    // Excluded by the same comparison that excludes later documents: a tuple is
    // never less than itself. There was a separate `document_id <> $1` clause
    // here until a sensitivity check removed it and no test failed — it was
    // redundant, and a guard nothing can break is a guard worth deleting.
    await seedInvoice('newer', { amount: '513.00' })

    const found = await createInvoiceReader().priorCandidates(subject({ amount: '513.00' }))

    expect(found).toHaveLength(0)
  })

  it('matches nothing when the amount could not be read', async () => {
    // **The null case, and it is SQL doing the work.** `total_amount = null` is
    // null rather than true, so an unreadable invoice pairs with nothing —
    // including the other unreadable invoice seeded here.
    await seedInvoice('older', { amount: null })

    const found = await createInvoiceReader().priorCandidates(subject({ amount: null }))

    expect(found).toHaveLength(0)
  })

  it('matches nothing when the vendor could not be read', async () => {
    // `vendor_normalised_name` is `strict`: a null in gives a null out, and null
    // does not equal null.
    await seedInvoice('older', { vendor: null, amount: '614.00' })

    const found = await createInvoiceReader().priorCandidates(subject({ vendor: null, amount: '614.00' }))

    expect(found).toHaveLength(0)
  })

  it('ignores documents of another kind entirely', async () => {
    // A deposit line carrying the same amount is not an invoice, and pairing
    // one with an invoice would report the association's own income as a bill
    // it had already paid.
    await writer.query(
      `insert into extraction (document_id, document_kind, vendor_name, total_amount, currency)
       values ($1, 'deposit', $2, 715.00, 'USD')`,
      [documents.get('older'), VENDOR],
    )

    const found = await createInvoiceReader().priorCandidates(subject({ amount: '715.00' }))

    expect(found).toHaveLength(0)
  })

  it('does not let an extracted vendor name become SQL', async () => {
    // AD-8. A vendor name is an extracted string and the field an injection
    // payload arrives in; if this were interpolated it would end the literal.
    const found = await createInvoiceReader().priorCandidates(
      subject({ vendorName: `${VENDOR}' or '1'='1` }),
    )

    expect(found).toHaveLength(0)
  })
})
