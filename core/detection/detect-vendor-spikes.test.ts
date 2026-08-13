/**
 * Raising what the spike rule found (story 4.3, AC2/AC5/AC6).
 *
 * `vendor-spike.test.ts` proves the arithmetic. This proves the sentence a
 * board member ends up reading: what key it is filed under, what the evidence
 * says, and — AD-6 — what the evidence deliberately does not contain.
 */

import { describe, expect, it, vi } from 'vitest'

import { detectVendorSpikes, INVOICE_ABOVE_VENDOR_AVERAGE } from './detect-vendor-spikes'
import type { InvoiceReading } from './duplicate-invoice'
import { MINIMUM_HISTORY, SPIKE_THRESHOLD_PERCENT, TRAILING_WINDOW_MONTHS } from './vendor-spike'
import type { FindingRegister, RaisedFinding } from '../ports/finding'
import type { InvoiceReader } from '../ports/invoice-reader'

const DOCUMENT = 'd-under-test'

function invoice(fields: Partial<InvoiceReading> = {}): InvoiceReading {
  return {
    extractionId: 'e-1',
    documentId: DOCUMENT,
    vendorName: 'Acme Plumbing',
    documentNumber: 'INV-77',
    issuedOn: '2026-06-14',
    amount: '130.00',
    documentUploadedAt: '2026-06-20',
    ...fields,
  }
}

/** A prior invoice on some other document, which is where history lives. */
function prior(amount: string, id: string): InvoiceReading {
  return invoice({
    extractionId: id,
    documentId: `d-prior-${id}`,
    documentNumber: `INV-${id}`,
    issuedOn: '2026-03-01',
    amount,
  })
}

const STEADY = [prior('100.00', 'p1'), prior('100.00', 'p2'), prior('100.00', 'p3')]

function register(alreadyKnown = false) {
  const raised: Parameters<FindingRegister['raise']>[0][] = []
  const port: FindingRegister = {
    raise: vi.fn(async (request): Promise<RaisedFinding> => {
      raised.push(request)

      return { id: `f-${raised.length}`, wasAlreadyKnown: alreadyKnown }
    }),
  }

  return { port, raised }
}

/** Histories keyed by the invoice they belong to, so one document can hold several. */
function reader(
  invoices: readonly InvoiceReading[],
  histories: Record<string, readonly InvoiceReading[]> = {},
): InvoiceReader {
  return {
    invoicesOn: vi.fn(async () => invoices),
    // The duplicate detector's half of the port. Throwing rather than
    // returning nothing: spike detection has no business narrowing on an
    // amount, and a fake that quietly answered would let it start.
    priorCandidates: vi.fn(async () => {
      throw new Error('spike detection must not read duplicate candidates')
    }),
    trailingInvoices: vi.fn(async (subject: InvoiceReading) => histories[subject.extractionId] ?? []),
  }
}

describe('raising a spike', () => {
  it('keys the finding on the document and the invoice month', async () => {
    // The same key 4.2 arrived at, and for the same reasons: `extraction.id` is
    // not stable across re-ingest, and a document can carry many invoices.
    const findings = register()

    await detectVendorSpikes(DOCUMENT, {
      invoices: reader([invoice()], { 'e-1': STEADY }),
      findings: findings.port,
    })

    expect(findings.raised).toHaveLength(1)
    expect(findings.raised[0]).toMatchObject({
      findingType: INVOICE_ABOVE_VENDOR_AVERAGE,
      subjectId: DOCUMENT,
      period: { from: '2026-06-01', until: '2026-07-01' },
    })
  })

  it('names what it found without claiming more than a comparison', async () => {
    // AC6, decided before the code was written because 4.2's audit caught the
    // same overclaim after it: `duplicate_invoice` shipped as
    // `possible_duplicate_invoice`. An invoice above a vendor's average is a
    // comparison, not an accusation — the association may have approved the
    // work. UX-DR23 forbids implying certainty the system lacks, and 4.5
    // renders this type as a heading while 4.8 puts it in a subject line.
    expect(INVOICE_ABOVE_VENDOR_AVERAGE).toBe('invoice_above_vendor_average')
    // Migration 021's `finding_type_is_verb_noun`.
    expect(INVOICE_ABOVE_VENDOR_AVERAGE).toMatch(/^[a-z][a-z0-9_]*$/)
  })

  it('carries the percentage, the average, and both constants', async () => {
    // AC2 and the epic's second consequence: a board member must be able to see
    // *20%* and *six months* without reading the source.
    const findings = register()

    await detectVendorSpikes(DOCUMENT, {
      invoices: reader([invoice()], { 'e-1': STEADY }),
      findings: findings.port,
    })

    expect(findings.raised[0]!.evidence).toMatchObject({
      invoicesChecked: 1,
      thresholdPercent: SPIKE_THRESHOLD_PERCENT,
      windowMonths: TRAILING_WINDOW_MONTHS,
      spikes: [
        {
          vendorName: 'Acme Plumbing',
          amount: '130.00',
          invoiceNumber: 'INV-77',
          issuedOn: '2026-06-14',
          percentOverAverage: '30.0',
          average: '100.00',
          invoicesAveraged: 3,
        },
      ],
    })
  })

  it('records the percentage and not the invoices it averaged', async () => {
    // **AD-6, and the sentence migration 021 already quotes**: "a vendor-spike
    // finding stores the computed percentage over the trailing average, not the
    // invoices it averaged." Asserted by looking for the priors' own
    // identifiers in the serialised evidence, because that is the shape the
    // violation would actually take.
    const findings = register()

    await detectVendorSpikes(DOCUMENT, {
      invoices: reader([invoice()], { 'e-1': STEADY }),
      findings: findings.port,
    })

    const evidence = JSON.stringify(findings.raised[0]!.evidence)

    for (const averaged of STEADY) {
      expect(evidence).not.toContain(averaged.extractionId)
      expect(evidence).not.toContain(averaged.documentId)
    }
  })

  it('collapses several spikes in one month into one finding', async () => {
    // Grouping before raising, exactly as 4.2 arrived at it: raising per
    // invoice would hit the same key twice and only the last evidence would
    // survive.
    const findings = register()
    const first = invoice({ extractionId: 'e-1', amount: '130.00' })
    const second = invoice({ extractionId: 'e-2', amount: '200.00', documentNumber: 'INV-78' })

    await detectVendorSpikes(DOCUMENT, {
      invoices: reader([first, second], { 'e-1': STEADY, 'e-2': STEADY }),
      findings: findings.port,
    })

    expect(findings.raised).toHaveLength(1)
    expect(findings.raised[0]!.evidence).toMatchObject({
      spikes: [{ amount: '130.00' }, { amount: '200.00' }],
    })
  })

  it('files spikes in different months as different findings', async () => {
    const findings = register()
    const june = invoice({ extractionId: 'e-1', issuedOn: '2026-06-14' })
    const july = invoice({ extractionId: 'e-2', issuedOn: '2026-07-02' })

    await detectVendorSpikes(DOCUMENT, {
      invoices: reader([june, july], { 'e-1': STEADY, 'e-2': STEADY }),
      findings: findings.port,
    })

    expect(findings.raised.map((request) => request.period.from)).toEqual([
      '2026-06-01',
      '2026-07-01',
    ])
  })

  it('reports an amended finding as amended rather than raised', async () => {
    // AC5's counting half. `wasAlreadyKnown` is what story 4.8 needs to avoid
    // mailing a second alert for a finding already raised.
    const findings = register(true)

    const outcome = await detectVendorSpikes(DOCUMENT, {
      invoices: reader([invoice()], { 'e-1': STEADY }),
      findings: findings.port,
    })

    expect(outcome).toEqual({ raised: 0, amended: 1, invoicesChecked: 1 })
  })
})

describe('when there is nothing to raise', () => {
  it('raises nothing for an invoice in line with the average', async () => {
    const findings = register()

    const outcome = await detectVendorSpikes(DOCUMENT, {
      invoices: reader([invoice({ amount: '105.00' })], { 'e-1': STEADY }),
      findings: findings.port,
    })

    expect(findings.port.raise).not.toHaveBeenCalled()
    expect(outcome).toEqual({ raised: 0, amended: 0, invoicesChecked: 1 })
  })

  it('raises nothing for a vendor with too little history', async () => {
    const findings = register()

    await detectVendorSpikes(DOCUMENT, {
      invoices: reader([invoice({ amount: '999.00' })], {
        'e-1': STEADY.slice(0, MINIMUM_HISTORY - 1),
      }),
      findings: findings.port,
    })

    expect(findings.port.raise).not.toHaveBeenCalled()
  })

  it('counts every invoice it checked, not just the ones it flagged', async () => {
    // UX-DR24's denominator. "We checked 3 invoices and one stood out" is the
    // sentence; "one stood out" on its own is the reassurance that rule forbids.
    const findings = register()
    const flagged = invoice({ extractionId: 'e-1', amount: '130.00' })
    const quiet = invoice({ extractionId: 'e-2', amount: '100.00' })
    const unknown = invoice({ extractionId: 'e-3', amount: null })

    const outcome = await detectVendorSpikes(DOCUMENT, {
      invoices: reader([flagged, quiet, unknown], {
        'e-1': STEADY,
        'e-2': STEADY,
        'e-3': STEADY,
      }),
      findings: findings.port,
    })

    expect(outcome.invoicesChecked).toBe(3)
    expect(findings.raised[0]!.evidence).toMatchObject({ invoicesChecked: 3 })
  })
})
