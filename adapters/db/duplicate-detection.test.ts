/**
 * Duplicate detection end to end, against a real database.
 *
 * This is AC4, and the criterion the epic ordered story 4.1 before this one for:
 *
 * > Ship a detector before that key exists and the second ingestion run raises
 * > the same finding twice — a *duplicate-detection product manufacturing
 * > duplicates*.
 *
 * Everything below runs through the real adapters, because the guarantee is the
 * database's. `detect-duplicates.test.ts` proves the caller asks for the right
 * key; this proves the key behaves.
 */

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { detectDuplicateInvoices } from '../../core/detection/detect-duplicates'
import { createFindingRegister, createFindingReviewer } from './finding-postgres'
import { createInvoiceReader } from './invoice-reader-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const adminUrl = process.env.DATABASE_URL
const configured = Boolean(writerUrl && adminUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  duplicate detection tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and DATABASE_URL must both be set.\n',
  )
}

const RUN_PREFIX = `dup-${randomBytes(4).toString('hex')}`

let writer: Client
let owner: Client
let memberId: string
const seeded: string[] = []

async function seedDocument(label: string, uploadedAt: string): Promise<string> {
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

  return id
}

async function seedInvoice(
  documentId: string,
  fields: { number?: string | null; issuedOn?: string | null; amount?: string } = {},
): Promise<void> {
  await writer.query(
    `insert into extraction
       (document_id, document_kind, vendor_name, document_number, issued_on, total_amount, currency)
     values ($1, 'invoice', 'Acme Plumbing', $2, $3::date, $4::numeric, 'USD')`,
    [
      documentId,
      fields.number === undefined ? 'INV-1001' : fields.number,
      fields.issuedOn === undefined ? '2026-03-14' : fields.issuedOn,
      fields.amount ?? '250.00',
    ],
  )
}

const detect = (documentId: string) =>
  detectDuplicateInvoices(documentId, {
    invoices: createInvoiceReader(),
    findings: createFindingRegister(),
  })

async function findingsFor(documentId: string) {
  const { rows } = await writer.query<{
    id: string
    finding_type: string
    period: string
    state: string
    reviewed_by: string | null
    evidence: { pairs: unknown[]; invoicesChecked: number }
  }>(
    `select id, finding_type, period::text, state, reviewed_by, evidence
       from finding where subject_id = $1 order by period`,
    [documentId],
  )

  return rows
}

describeWithDatabase('detecting a duplicate invoice', () => {
  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    owner = new Client({ connectionString: adminUrl })
    await owner.connect()

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash)
       values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA') returning id`,
      [`duplicate-detection-${RUN_PREFIX}@example.test`],
    )
    memberId = rows[0]!.id
  })

  afterAll(async () => {
    try {
      // Findings first and as the owner: the writer cannot delete them, which is
      // migration 021's point. Documents cascade their extractions.
      if (seeded.length > 0) {
        await owner.query(`delete from finding where subject_id = any($1::uuid[])`, [seeded])
      }
      await owner.query(`delete from document where storage_key like $1`, [`${RUN_PREFIX}/%`])
      await owner.query(`delete from board_member where email like $1`, [
        `duplicate-detection-${RUN_PREFIX}%`,
      ])
    } finally {
      await Promise.allSettled([owner.end(), writer.end()])
    }
  })

  it('raises one finding keyed on the document and the invoice month', async () => {
    const older = await seedDocument('exact-older', '2026-03-20T09:00:00Z')
    const newer = await seedDocument('exact-newer', '2026-03-21T09:00:00Z')
    await seedInvoice(older)
    await seedInvoice(newer)

    const outcome = await detect(newer)

    expect(outcome).toMatchObject({ raised: 1, amended: 0, invoicesChecked: 1 })

    const [finding] = await findingsFor(newer)
    expect(finding).toMatchObject({
      // "possible", per UX-DR23: the detector is exact, what it found is not.
      // 4.5 renders this as a heading and 4.8 puts it in a subject line.
      finding_type: 'possible_duplicate_invoice',
      period: '[2026-03-01,2026-04-01)',
      state: 'unreviewed',
    })
    expect(finding!.evidence.pairs).toHaveLength(1)
  })

  it('running detection again yields one finding, not two', async () => {
    // **The whole reason story 4.1 came first.** Not "one visible finding" —
    // one row, guaranteed by `finding_identity` rather than by this code
    // remembering what it did last time.
    const older = await seedDocument('twice-older', '2026-04-20T09:00:00Z')
    const newer = await seedDocument('twice-newer', '2026-04-21T09:00:00Z')
    await seedInvoice(older, { issuedOn: '2026-04-14' })
    await seedInvoice(newer, { issuedOn: '2026-04-14' })

    const first = await detect(newer)
    const second = await detect(newer)

    expect(first).toMatchObject({ raised: 1, amended: 0 })
    expect(second).toMatchObject({ raised: 0, amended: 1 })
    expect(await findingsFor(newer)).toHaveLength(1)
  })

  it('does not resurrect a reviewed finding as unreviewed', async () => {
    // AC3 end to end. A re-upload must not quietly undo a board member's
    // review — dismissal wearing a different hat, arriving by accident.
    const older = await seedDocument('reviewed-older', '2026-05-20T09:00:00Z')
    const newer = await seedDocument('reviewed-newer', '2026-05-21T09:00:00Z')
    await seedInvoice(older, { issuedOn: '2026-05-14' })
    await seedInvoice(newer, { issuedOn: '2026-05-14' })

    await detect(newer)
    const [raised] = await findingsFor(newer)
    await createFindingReviewer().markReviewed(raised!.id, memberId)

    await detect(newer)

    const [after] = await findingsFor(newer)
    expect(after).toMatchObject({ state: 'reviewed', reviewed_by: memberId })
  })

  it('flags a fuzzy duplicate the exact rule would miss', async () => {
    // AC2 through the real database: same vendor and amount, the same invoice
    // number written differently, and dates that do not match.
    const older = await seedDocument('fuzzy-older', '2026-06-20T09:00:00Z')
    const newer = await seedDocument('fuzzy-newer', '2026-06-21T09:00:00Z')
    await seedInvoice(older, { number: 'INV-0002002', issuedOn: '2026-06-01', amount: '410.00' })
    await seedInvoice(newer, { number: 'inv 2002', issuedOn: '2026-06-09', amount: '410.00' })

    await detect(newer)

    const [finding] = await findingsFor(newer)
    expect(finding!.evidence.pairs).toMatchObject([{ reason: 'same-amount-and-number' }])
  })

  it('raises nothing for adjacent invoice numbers on different dates', async () => {
    // AC3 through the real database. The false positive this detector is most
    // likely to ship: one vendor billing twice for the same amount.
    const older = await seedDocument('adjacent-older', '2026-07-20T09:00:00Z')
    const newer = await seedDocument('adjacent-newer', '2026-07-21T09:00:00Z')
    await seedInvoice(older, { number: 'INV-3001', issuedOn: '2026-07-01', amount: '512.00' })
    await seedInvoice(newer, { number: 'INV-3002', issuedOn: '2026-07-15', amount: '512.00' })

    const outcome = await detect(newer)

    expect(outcome).toMatchObject({ raised: 0, amended: 0, invoicesChecked: 1 })
    expect(await findingsFor(newer)).toHaveLength(0)
  })

  it('raises nothing when the amounts could not be read', async () => {
    // The null pair, all the way through: two invoices the extractor failed on
    // must not be reported as a duplicate of each other.
    const older = await seedDocument('null-older', '2026-08-20T09:00:00Z')
    const newer = await seedDocument('null-newer', '2026-08-21T09:00:00Z')
    await writer.query(
      `insert into extraction (document_id, document_kind, vendor_name, currency)
       values ($1, 'invoice', 'Acme Plumbing', 'USD')`,
      [older],
    )
    await writer.query(
      `insert into extraction (document_id, document_kind, vendor_name, currency)
       values ($1, 'invoice', 'Acme Plumbing', 'USD')`,
      [newer],
    )

    const outcome = await detect(newer)

    expect(outcome).toMatchObject({ raised: 0, invoicesChecked: 1 })
    expect(await findingsFor(newer)).toHaveLength(0)
  })

  it('raises one finding for two duplicates in the same month, listing both pairs', async () => {
    // The collapse, proven where it matters: the key permits one row, and the
    // evidence is what keeps it lossless.
    const older = await seedDocument('multi-older', '2026-09-20T09:00:00Z')
    const newer = await seedDocument('multi-newer', '2026-09-21T09:00:00Z')
    await seedInvoice(older, { number: 'INV-4001', issuedOn: '2026-09-03', amount: '611.00' })
    await seedInvoice(older, { number: 'INV-4002', issuedOn: '2026-09-04', amount: '612.00' })
    await seedInvoice(newer, { number: 'INV-4001', issuedOn: '2026-09-03', amount: '611.00' })
    await seedInvoice(newer, { number: 'INV-4002', issuedOn: '2026-09-04', amount: '612.00' })

    const outcome = await detect(newer)

    expect(outcome).toMatchObject({ raised: 1, invoicesChecked: 2 })
    const findings = await findingsFor(newer)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence.pairs).toHaveLength(2)
    expect(findings[0]!.evidence.invoicesChecked).toBe(2)
  })
})
