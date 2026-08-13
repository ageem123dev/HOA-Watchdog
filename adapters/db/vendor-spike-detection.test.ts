/**
 * The trailing-window reader, against a real database (story 4.3, AC1/AC4/AC9).
 *
 * The window is arithmetic Postgres does and this process does not, so asserting
 * it anywhere but here would assert a guess. Three things are only true in the
 * database: what `date - interval` means at a month end, what a comparison
 * against a null date returns, and whether `numeric(14,2)` survives the trip out
 * as an exact decimal string.
 */

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { detectVendorSpikes, INVOICE_ABOVE_VENDOR_AVERAGE } from '../../core/detection/detect-vendor-spikes'
import type { InvoiceReading } from '../../core/detection/duplicate-invoice'
import { TRAILING_WINDOW_MONTHS } from '../../core/detection/vendor-spike'
import { createFindingRegister } from './finding-postgres'
import { createInvoiceReader } from './invoice-reader-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const adminUrl = process.env.DATABASE_URL
const configured = Boolean(writerUrl && adminUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  vendor spike tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and DATABASE_URL must both be set.\n',
  )
}

const RUN_PREFIX = `spike-${randomBytes(4).toString('hex')}`

let writer: Client
let owner: Client
let memberId: string
const seeded: string[] = []

/**
 * One test's document and the vendor that only it uses.
 *
 * **Scoped per test, not per run.** This query narrows on the vendor and the
 * window and nothing else — that is the point of it — so two tests sharing a
 * vendor share a window, and each one sees the other's invoices. The first
 * version of this file used one vendor for the whole run and eleven of fourteen
 * tests failed on each other's data.
 */
interface Scene {
  readonly id: string
  readonly vendor: string
}

async function seedDocument(label: string, uploadedAt = '2026-06-20T09:00:00Z'): Promise<Scene> {
  const { rows } = await writer.query<{ id: string }>(
    `insert into document
       (content_hash, storage_key, filename, content_type, byte_size, uploaded_by, uploaded_at)
     values ($1, $2, $3, 'application/pdf', 2048, $4, $5)
     returning id`,
    [
      randomBytes(32).toString('hex'),
      `${RUN_PREFIX}/${label}`,
      `${RUN_PREFIX}-${label}.pdf`,
      memberId,
      uploadedAt,
    ],
  )
  const id = rows[0]!.id
  seeded.push(id)

  return { id, vendor: `Acme ${RUN_PREFIX} ${label}` }
}

interface InvoiceFields {
  readonly issuedOn?: string | null
  readonly amount?: string | null
  readonly vendor?: string | null
  readonly kind?: string
}

async function seedInvoice(scene: Scene, fields: InvoiceFields = {}): Promise<void> {
  await writer.query(
    `insert into extraction
       (document_id, document_kind, vendor_name, document_number, issued_on, total_amount, currency)
     values ($1, $2, $3, 'INV-1', $4::date, $5::numeric, 'USD')`,
    [
      scene.id,
      fields.kind ?? 'invoice',
      fields.vendor === undefined ? scene.vendor : fields.vendor,
      fields.issuedOn === undefined ? '2026-01-14' : fields.issuedOn,
      fields.amount === undefined ? '100.00' : fields.amount,
    ],
  )
}

/**
 * A subject to read history for. Only the vendor and the issue date are read by
 * the window query — the rest is here because `InvoiceReading` is one shape
 * shared with the duplicate detector.
 */
function subject(issuedOn: string | null, vendor: string | null): InvoiceReading {
  return {
    extractionId: '00000000-0000-0000-0000-000000000000',
    documentId: '00000000-0000-0000-0000-000000000000',
    vendorName: vendor,
    documentNumber: 'INV-SUBJECT',
    issuedOn,
    amount: '500.00',
    documentUploadedAt: '2026-06-20',
  }
}

const trailing = (invoice: InvoiceReading) => createInvoiceReader().trailingInvoices(invoice)

/**
 * The connection lifecycle belongs to the file, not to one suite.
 *
 * Both suites below seed through `writer`, and when these hooks sat inside the
 * first of them the second ran against a client the first had already closed.
 * Registered conditionally so a checkout without a database still skips rather
 * than fails.
 */
if (configured) {
  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    owner = new Client({ connectionString: adminUrl })
    await owner.connect()

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash)
       values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA') returning id`,
      [`vendor-spike-${RUN_PREFIX}@example.test`],
    )
    memberId = rows[0]!.id
  })

  afterAll(async () => {
    try {
      if (seeded.length > 0) {
        await owner.query(`delete from finding where subject_id = any($1::uuid[])`, [seeded])
      }
      await owner.query(`delete from document where storage_key like $1`, [`${RUN_PREFIX}/%`])
      await owner.query(`delete from board_member where email like $1`, [
        `vendor-spike-${RUN_PREFIX}%`,
      ])
    } finally {
      await Promise.allSettled([owner.end(), writer.end()])
    }
  })
}

describeWithDatabase("reading a vendor's trailing window", () => {
  it("returns the vendor's earlier invoices inside the window", async () => {
    const scene = await seedDocument('inside')
    await seedInvoice(scene, { issuedOn: '2026-05-01', amount: '110.00' })
    await seedInvoice(scene, { issuedOn: '2026-04-01', amount: '120.00' })

    const history = await trailing(subject('2026-06-14', scene.vendor))

    expect(history.map((invoice) => invoice.amount)).toEqual(['120.00', '110.00'])
  })

  it('includes the far edge of the window and excludes the day before it', async () => {
    // Six months before 2026-06-14 is 2025-12-14. Half-open at the far end so
    // the window is exactly six months and not six months and a day.
    const scene = await seedDocument('far-edge')
    await seedInvoice(scene, { issuedOn: '2025-12-14', amount: '111.00' })
    await seedInvoice(scene, { issuedOn: '2025-12-13', amount: '222.00' })

    const history = await trailing(subject('2026-06-14', scene.vendor))

    expect(history.map((invoice) => invoice.amount)).toEqual(['111.00'])
  })

  it('clamps the far edge at a month end rather than falling out of the calendar', async () => {
    // Six months before 2026-08-31 is not "the 31st of February". Postgres
    // clamps to 2026-02-28, which is the treasurer's reading of "six months"
    // and not something this process gets a vote on — hence the probe, and
    // hence this test.
    const scene = await seedDocument('month-end')
    await seedInvoice(scene, { issuedOn: '2026-02-28', amount: '131.00' })
    await seedInvoice(scene, { issuedOn: '2026-02-27', amount: '232.00' })

    const history = await trailing(subject('2026-08-31', scene.vendor))

    expect(history.map((invoice) => invoice.amount)).toEqual(['131.00'])
  })

  it('excludes the invoice being checked, and anything issued the same day', async () => {
    // **The invoice must not be in its own average**, and the date comparison
    // is what does it: its own row is not strictly earlier than itself. A
    // same-day sibling goes too, which is the price of a rule that needs no id
    // to exclude — and an id is exactly what re-ingestion changes.
    const scene = await seedDocument('same-day')
    await seedInvoice(scene, { issuedOn: '2026-06-14', amount: '999.00' })
    await seedInvoice(scene, { issuedOn: '2026-06-13', amount: '141.00' })

    const history = await trailing(subject('2026-06-14', scene.vendor))

    expect(history.map((invoice) => invoice.amount)).toEqual(['141.00'])
  })

  it('excludes invoices issued after the one being checked', async () => {
    // AC4's "history all in the future". The window ends at the invoice's own
    // date, so a later invoice is not history no matter when it was uploaded.
    const scene = await seedDocument('future')
    await seedInvoice(scene, { issuedOn: '2026-07-01', amount: '151.00' })

    expect(await trailing(subject('2026-06-14', scene.vendor))).toHaveLength(0)
  })

  it('folds the vendor name with the same rule the rest of the system uses', async () => {
    // Never a second definition of "same vendor" — migration 009's function is
    // what `vendor.normalised_name` is generated from, and a second rule here
    // would let one vendor be two vendors to this detector alone.
    const scene = await seedDocument('folded')
    await seedInvoice(scene, { issuedOn: '2026-05-02', amount: '161.00' })

    // Case and surrounding whitespace, which is what migration 009 folds. It
    // does *not* strip a legal suffix — probed rather than assumed, because the
    // first version of this test asserted that `, Inc.` folded away.
    const history = await trailing(subject('2026-06-14', `  ${scene.vendor.toUpperCase()}  `))

    expect(history.map((invoice) => invoice.amount)).toEqual(['161.00'])
  })

  it("does not treat another vendor's invoices as history", async () => {
    const scene = await seedDocument('other-vendor')
    await seedInvoice(scene, {
      issuedOn: '2026-05-03',
      amount: '171.00',
      vendor: `Beta ${RUN_PREFIX} Roofing`,
    })

    expect(await trailing(subject('2026-06-14', scene.vendor))).toHaveLength(0)
  })

  it('reads no history at all for an invoice with no issue date', async () => {
    // There is no window without a date to anchor it to, and the upload date is
    // not a substitute: it is when we noticed the invoice, not when the vendor
    // charged. An average anchored to it would move every time the document was
    // re-uploaded. So the honest answer is that this invoice has no history,
    // and it is never flagged.
    const scene = await seedDocument('no-date')
    await seedInvoice(scene, { issuedOn: '2026-05-04', amount: '181.00' })

    expect(await trailing(subject(null, scene.vendor))).toHaveLength(0)
  })

  it('leaves a prior with no issue date out of the window', async () => {
    // Not a guard — `null >= date` is null, not true, so SQL drops it. Asserted
    // because it looks like an omission in the query.
    const scene = await seedDocument('null-date-prior')
    await seedInvoice(scene, { issuedOn: null, amount: '191.00' })

    expect(await trailing(subject('2026-06-14', scene.vendor))).toHaveLength(0)
  })

  it('leaves a prior with no vendor name out of the window', async () => {
    // `vendor_normalised_name` is strict, so a null vendor folds to null and
    // compares as null. An invoice nobody could read a vendor for belongs to no
    // vendor's average.
    const scene = await seedDocument('null-vendor-prior')
    await seedInvoice(scene, { issuedOn: '2026-05-05', amount: '201.00', vendor: null })

    expect(await trailing(subject('2026-06-14', scene.vendor))).toHaveLength(0)
  })

  it('reads no history for an invoice whose vendor could not be read', async () => {
    const scene = await seedDocument('null-vendor-subject')
    await seedInvoice(scene, { issuedOn: '2026-05-06', amount: '211.00' })

    expect(await trailing(subject('2026-06-14', null))).toHaveLength(0)
  })

  it('hands back a credit as an exact negative decimal, and leaves the judgement to the rule', async () => {
    // The reader does not filter credits: `spikeAgainst` drops them, and it can
    // only do that if the sign survives the trip out of `numeric(14,2)`. Story
    // 2.2's rule — exact decimal end to end, never through a float.
    const scene = await seedDocument('credit')
    await seedInvoice(scene, { issuedOn: '2026-05-07', amount: '-100.10' })

    const history = await trailing(subject('2026-06-14', scene.vendor))

    expect(history.map((invoice) => invoice.amount)).toEqual(['-100.10'])
  })

  it('reads invoices only, not every kind of document', async () => {
    const scene = await seedDocument('kinds')
    // `statement`, not an invented kind: `extraction_kind_known` permits
    // invoice, statement, assessment_roll, deposit and other, and nothing else.
    await seedInvoice(scene, { issuedOn: '2026-05-08', amount: '221.00', kind: 'statement' })

    expect(await trailing(subject('2026-06-14', scene.vendor))).toHaveLength(0)
  })

  it('reads the window length from the one named export', async () => {
    // AC7. The number is not written into the SQL, so changing the export is
    // the only way to change the window — and this pins that the export is what
    // the query actually used.
    expect(TRAILING_WINDOW_MONTHS).toBe(6)

    const scene = await seedDocument('window-length')
    await seedInvoice(scene, { issuedOn: '2025-12-14', amount: '231.00' })

    // 2026-06-14 minus exactly TRAILING_WINDOW_MONTHS months is this invoice's
    // date. A window of 5 would miss it; a window of 7 would also catch the
    // control below.
    await seedInvoice(scene, { issuedOn: '2025-11-14', amount: '331.00' })

    const history = await trailing(subject('2026-06-14', scene.vendor))

    expect(history.map((invoice) => invoice.amount)).toEqual(['231.00'])
  })
})

describeWithDatabase('raising a vendor spike end to end', () => {
  async function findingsFor(documentId: string) {
    const { rows } = await writer.query<{
      finding_type: string
      period: string
      state: string
      evidence: {
        invoicesChecked: number
        thresholdPercent: number
        windowMonths: number
        spikes: { percentOverAverage: string; average: string; invoicesAveraged: number }[]
      }
    }>(
      `select finding_type, period::text, state, evidence
         from finding where subject_id = $1 order by period`,
      [documentId],
    )

    return rows
  }

  const detect = (documentId: string) =>
    detectVendorSpikes(documentId, {
      invoices: createInvoiceReader(),
      findings: createFindingRegister(),
    })

  /** History on its own document, so `invoicesOn` does not check it as a subject too. */
  async function withHistory(label: string, amounts: readonly string[]) {
    // No vendor override: every caller uses the seeded one, and a parameter
    // nobody passes is a parameter nobody maintains. Raised by CodeRabbit.
    const scene = await seedDocument(`${label}-history`, '2026-03-05T09:00:00Z')

    for (const [index, amount] of amounts.entries()) {
      // Padded, not `0${index + 1}`: the tenth entry would otherwise be
      // `2026-03-010`, and `::date` would reject the whole seed rather than the
      // one row. Three amounts today, so nothing reaches it — a trap for
      // whoever writes the fourth kind of test. Raised by CodeRabbit.
      const day = String(index + 1).padStart(2, '0')
      await seedInvoice(scene, { issuedOn: `2026-03-${day}`, amount })
    }

    return scene
  }

  it('raises one finding carrying the percentage and both constants', async () => {
    const history = await withHistory('raise', ['100.00', '100.00', '100.00'])
    const subjectDoc = await seedDocument('raise-subject')
    await seedInvoice(
      { ...subjectDoc, vendor: history.vendor },
      { issuedOn: '2026-06-14', amount: '130.00' },
    )

    const outcome = await detect(subjectDoc.id)

    expect(outcome).toMatchObject({ raised: 1, amended: 0, invoicesChecked: 1 })

    const [finding] = await findingsFor(subjectDoc.id)
    expect(finding).toMatchObject({
      finding_type: INVOICE_ABOVE_VENDOR_AVERAGE,
      period: '[2026-06-01,2026-07-01)',
      state: 'unreviewed',
    })
    expect(finding!.evidence).toMatchObject({
      invoicesChecked: 1,
      thresholdPercent: 20,
      windowMonths: 6,
      spikes: [{ percentOverAverage: '30.0', average: '100.00', invoicesAveraged: 3 }],
    })
  })

  it('running detection again yields one finding, not two', async () => {
    // AC5, and the reason story 4.1 came first. One *row*, guaranteed by
    // `finding_identity` rather than by this code remembering what it did.
    const history = await withHistory('twice', ['100.00', '100.00', '100.00'])
    const subjectDoc = await seedDocument('twice-subject')
    await seedInvoice(
      { ...subjectDoc, vendor: history.vendor },
      { issuedOn: '2026-06-14', amount: '130.00' },
    )

    const first = await detect(subjectDoc.id)
    const second = await detect(subjectDoc.id)

    expect(first).toMatchObject({ raised: 1, amended: 0 })
    expect(second).toMatchObject({ raised: 0, amended: 1 })
    expect(await findingsFor(subjectDoc.id)).toHaveLength(1)
  })

  it('decides on the exact sum even when the average is not a round number', async () => {
    // **AC9's real subject.** These three priors sum to 300.02, so the exact
    // average is 100.00666... and the exact threshold is 120.008 — which 120.01
    // exceeds. Rounding the average to 100.01 first puts the threshold at
    // 120.012 and this invoice falls short. One cent, one finding, decided by
    // where the rounding happened; here it happens after the comparison, and
    // the values make the whole trip through `numeric(14,2)`.
    const history = await withHistory('uneven', ['100.00', '100.00', '100.02'])
    const subjectDoc = await seedDocument('uneven-subject')
    await seedInvoice(
      { ...subjectDoc, vendor: history.vendor },
      { issuedOn: '2026-06-14', amount: '120.01' },
    )

    expect(await detect(subjectDoc.id)).toMatchObject({ raised: 1 })

    const [finding] = await findingsFor(subjectDoc.id)
    expect(finding!.evidence.spikes[0]).toMatchObject({ average: '100.01' })
  })

  it('raises nothing for a vendor with too little history', async () => {
    const history = await withHistory('thin', ['100.00', '100.00'])
    const subjectDoc = await seedDocument('thin-subject')
    await seedInvoice(
      { ...subjectDoc, vendor: history.vendor },
      { issuedOn: '2026-06-14', amount: '999.00' },
    )

    expect(await detect(subjectDoc.id)).toMatchObject({ raised: 0, invoicesChecked: 1 })
    expect(await findingsFor(subjectDoc.id)).toHaveLength(0)
  })

  it('raises nothing for a credit, however large', async () => {
    // `total_amount` is negative for a credit to the association (migration
    // 006), and money coming back is not a spike. Proven through the column
    // rather than through a string, because the sign has to survive the trip.
    const history = await withHistory('credit-e2e', ['100.00', '100.00', '100.00'])
    const subjectDoc = await seedDocument('credit-subject')
    await seedInvoice(
      { ...subjectDoc, vendor: history.vendor },
      { issuedOn: '2026-06-14', amount: '-5000.00' },
    )

    expect(await detect(subjectDoc.id)).toMatchObject({ raised: 0 })
    expect(await findingsFor(subjectDoc.id)).toHaveLength(0)
  })
})
