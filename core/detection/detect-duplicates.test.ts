/**
 * Running duplicate detection over a document, and what it puts on the register.
 *
 * The ports are faked here because what is under test is the *shape* of what
 * gets raised — one finding per document per month, keyed so that running again
 * changes nothing. That the key actually behaves that way is the database's
 * property and is proven in `test:db`; this file proves the caller asks for the
 * right key in the first place.
 */

import { describe, expect, it, vi } from 'vitest'

import type { FindingObservation, FindingRegister, RaisedFinding } from '../ports/finding'
import type { InvoiceReader } from '../ports/invoice-reader'
import { POSSIBLE_DUPLICATE_INVOICE, detectDuplicateInvoices } from './detect-duplicates'
import type { InvoiceReading } from './duplicate-invoice'

const DOCUMENT = 'd-subject'

function invoice(overrides: Partial<InvoiceReading> = {}): InvoiceReading {
  return {
    extractionId: 'e-subject',
    documentId: DOCUMENT,
    vendorName: 'Acme Plumbing',
    documentNumber: 'INV-1001',
    issuedOn: '2026-03-14',
    amount: '250.00',
    documentUploadedAt: '2026-05-20',
    ...overrides,
  }
}

function prior(overrides: Partial<InvoiceReading> = {}): InvoiceReading {
  return invoice({ extractionId: 'e-prior', documentId: 'd-prior', ...overrides })
}

const PRIOR = prior()

/** A register that records what it was asked to raise. */
function register(alreadyKnown = false) {
  const raised: FindingObservation[] = []
  const port: FindingRegister = {
    raise: vi.fn(async (observation: FindingObservation): Promise<RaisedFinding> => {
      raised.push(observation)

      return { id: `f-${raised.length}`, wasAlreadyKnown: alreadyKnown }
    }),
  }

  return { port, raised }
}

function reader(invoices: readonly InvoiceReading[], priors: readonly InvoiceReading[]): InvoiceReader {
  return {
    invoicesOn: vi.fn(async () => invoices),
    priorCandidates: vi.fn(async () => priors),
    // The spike detector's half of the port. Throwing rather than returning
    // nothing: the duplicate detector has no business reading a trailing
    // window, and a fake that quietly answered would let it start.
    trailingInvoices: vi.fn(async () => {
      throw new Error('duplicate detection must not read a trailing window')
    }),
  }
}

describe('raising what was found', () => {
  it('keys the finding on the document and the invoice month', async () => {
    const findings = register()

    await detectDuplicateInvoices(DOCUMENT, {
      invoices: reader([invoice()], [PRIOR]),
      findings: findings.port,
    })

    expect(findings.raised).toHaveLength(1)
    expect(findings.raised[0]).toMatchObject({
      findingType: POSSIBLE_DUPLICATE_INVOICE,
      subjectId: DOCUMENT,
      period: { from: '2026-03-01', until: '2026-04-01' },
    })
  })

  it('rolls December into the next year', async () => {
    // The arithmetic is on the string, and this is the case a naive `+ 1` gets
    // wrong — a December finding filed under month 13 of the same year.
    const findings = register()

    await detectDuplicateInvoices(DOCUMENT, {
      invoices: reader(
        [invoice({ issuedOn: '2026-12-14' })],
        [prior({ issuedOn: '2026-12-14' })],
      ),
      findings: findings.port,
    })

    expect(findings.raised[0]).toMatchObject({
      period: { from: '2026-12-01', until: '2027-01-01' },
    })
  })

  it('falls back to the upload month when the invoice carries no date', async () => {
    // A fuzzy match needs no date, so the finding still has to be filed
    // somewhere. "When this was noticed" is the honest answer.
    const findings = register()
    const undated = invoice({ issuedOn: null, documentNumber: 'INV-1001' })

    await detectDuplicateInvoices(DOCUMENT, {
      invoices: reader([undated], [prior({ issuedOn: null, documentNumber: 'inv 1001' })]),
      findings: findings.port,
    })

    expect(findings.raised[0]).toMatchObject({
      period: { from: '2026-05-01', until: '2026-06-01' },
    })
  })

  it('raises one finding for several duplicates in the same month', async () => {
    // The collapse is the design, and this is what makes it lossless: three
    // pairs, one finding, every pair in the evidence. Raising per invoice would
    // hit the same key three times and only the last evidence would survive.
    const findings = register()
    const invoices = [
      invoice({ extractionId: 'e-1', documentNumber: 'INV-1' }),
      invoice({ extractionId: 'e-2', documentNumber: 'INV-2', amount: '99.00' }),
    ]
    const priors = [
      prior({ extractionId: 'p-1', documentId: 'd-p1', documentNumber: 'INV-1' }),
      prior({ extractionId: 'p-2', documentId: 'd-p2', documentNumber: 'INV-2', amount: '99.00' }),
    ]

    await detectDuplicateInvoices(DOCUMENT, {
      invoices: reader(invoices, priors),
      findings: findings.port,
    })

    expect(findings.raised).toHaveLength(1)
    const evidence = findings.raised[0]!.evidence as { pairs: unknown[] }
    expect(evidence.pairs).toHaveLength(2)
  })

  it('raises separately for two different months', async () => {
    const findings = register()
    const march = invoice({ extractionId: 'e-march', issuedOn: '2026-03-14' })
    const april = invoice({ extractionId: 'e-april', issuedOn: '2026-04-14' })

    await detectDuplicateInvoices(DOCUMENT, {
      invoices: reader([march, april], [prior({ issuedOn: '2026-03-14' }), prior({ extractionId: 'p-apr', documentId: 'd-p-apr', issuedOn: '2026-04-14' })]),
      findings: findings.port,
    })

    expect(findings.raised.map((f) => f.period.from).sort()).toEqual(['2026-03-01', '2026-04-01'])
  })

  it('carries the count of what was checked, and what was compared', async () => {
    // UX-DR24 forbids reassurance without a count. AD-6: derived values, and the
    // numbers as written rather than as folded — a board member is being asked
    // to recognise their own paperwork.
    const findings = register()

    await detectDuplicateInvoices(DOCUMENT, {
      invoices: reader([invoice()], [PRIOR]),
      findings: findings.port,
    })

    expect(findings.raised[0]!.evidence).toMatchObject({
      invoicesChecked: 1,
      matchRule: 'normalised-exact',
      pairs: [
        {
          reason: 'same-amount-and-date',
          vendorName: 'Acme Plumbing',
          amount: '250.00',
          invoiceNumber: 'INV-1001',
          issuedOn: '2026-03-14',
          priorDocumentId: 'd-prior',
        },
      ],
    })
  })
})

describe('what it reports back', () => {
  it('counts a new finding as raised', async () => {
    const findings = register(false)

    const outcome = await detectDuplicateInvoices(DOCUMENT, {
      invoices: reader([invoice()], [PRIOR]),
      findings: findings.port,
    })

    expect(outcome).toEqual({ raised: 1, amended: 0, subjectsChecked: 1 })
  })

  it('counts a finding already on the register as amended, not raised', async () => {
    // Story 4.8 mails what is new. Re-running detection over an unchanged
    // document must report nothing new, or the no-op holds in the table and
    // fails in the inbox.
    const findings = register(true)

    const outcome = await detectDuplicateInvoices(DOCUMENT, {
      invoices: reader([invoice()], [PRIOR]),
      findings: findings.port,
    })

    expect(outcome).toEqual({ raised: 0, amended: 1, subjectsChecked: 1 })
  })

  it('raises nothing when there is nothing to find', async () => {
    const findings = register()

    const outcome = await detectDuplicateInvoices(DOCUMENT, {
      invoices: reader([invoice()], []),
      findings: findings.port,
    })

    expect(findings.port.raise).not.toHaveBeenCalled()
    expect(outcome).toEqual({ raised: 0, amended: 0, subjectsChecked: 1 })
  })

  it('still reports how many invoices were checked when none matched', async () => {
    // The count is what UX-DR24 needs for the empty state: "nothing found" is
    // not the same claim as "two invoices were compared and nothing was found".
    const findings = register()

    const outcome = await detectDuplicateInvoices(DOCUMENT, {
      invoices: reader([invoice({ extractionId: 'a' }), invoice({ extractionId: 'b' })], []),
      findings: findings.port,
    })

    expect(outcome.subjectsChecked).toBe(2)
  })

  it('does nothing at all for a document with no invoices', async () => {
    const findings = register()

    const outcome = await detectDuplicateInvoices(DOCUMENT, {
      invoices: reader([], []),
      findings: findings.port,
    })

    expect(outcome).toEqual({ raised: 0, amended: 0, subjectsChecked: 0 })
  })
})
