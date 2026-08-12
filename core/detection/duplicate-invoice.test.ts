/**
 * Which invoices are duplicates of which.
 *
 * FR-6: *"Exact duplicates (matching amount and date) and fuzzy duplicates
 * (similar invoice number, identical amount) are flagged."* Two rules, and
 * **both require the amount to be identical** — which is what keeps this from
 * firing on a vendor's ordinary monthly billing.
 *
 * The half that matters most is what it declines to flag. A detector that
 * over-reports teaches a board member to ignore it, and an ignored watchdog is
 * worse than none because it was trusted once.
 */

import { describe, expect, it } from 'vitest'

import { duplicatesAmong, type InvoiceReading } from './duplicate-invoice'

const BASE: InvoiceReading = {
  extractionId: 'e-subject',
  documentId: 'd-subject',
  vendorName: 'Acme Plumbing',
  documentNumber: 'INV-1001',
  issuedOn: '2026-03-14',
  amount: '250.00',
}

function reading(overrides: Partial<InvoiceReading> = {}): InvoiceReading {
  return { ...BASE, ...overrides }
}

const PRIOR: InvoiceReading = reading({ extractionId: 'e-prior', documentId: 'd-prior' })

describe('an exact duplicate', () => {
  it('is the same vendor, amount and date', () => {
    // AC1, and the case SM-2's 100% is measured against.
    const found = duplicatesAmong(reading(), [PRIOR])

    expect(found).toEqual([
      { priorExtractionId: 'e-prior', priorDocumentId: 'd-prior', reason: 'same-amount-and-date' },
    ])
  })

  it('does not need the invoice numbers to agree', () => {
    // The same bill entered twice under two references is still the same bill.
    const found = duplicatesAmong(reading(), [{ ...PRIOR, documentNumber: 'INV-2002' }])

    expect(found.map((m) => m.reason)).toEqual(['same-amount-and-date'])
  })

  it('folds the vendor name the way the rest of the system does', () => {
    // `vendor_normalised_name` is what `vendor` and `quarantine_item` key on. A
    // second rule here would let one vendor be two vendors to the detector only.
    const found = duplicatesAmong(reading(), [{ ...PRIOR, vendorName: '  acme   PLUMBING ' }])

    expect(found).toHaveLength(1)
  })
})

describe('a fuzzy duplicate', () => {
  it('is the same vendor and amount, with the same number written differently', () => {
    // AC2. Different dates — a re-entered invoice usually carries a new one.
    const found = duplicatesAmong(reading(), [
      { ...PRIOR, issuedOn: '2026-04-02', documentNumber: 'inv 0001001' },
    ])

    expect(found).toEqual([
      { priorExtractionId: 'e-prior', priorDocumentId: 'd-prior', reason: 'same-amount-and-number' },
    ])
  })

  it('reports the date match when both rules fire, because it is the stronger claim', () => {
    // Same amount, same date *and* the same number. One finding, and the reason
    // a board member is shown should be the one that needs least explaining.
    const found = duplicatesAmong(reading(), [PRIOR])

    expect(found.map((m) => m.reason)).toEqual(['same-amount-and-date'])
  })
})

describe('what must not be flagged', () => {
  it('refuses adjacent invoice numbers on different dates', () => {
    // The false positive this detector is most likely to ship: one vendor
    // billing twice for the same amount, with sequential references.
    const found = duplicatesAmong(reading(), [
      { ...PRIOR, issuedOn: '2026-04-14', documentNumber: 'INV-1002' },
    ])

    expect(found).toEqual([])
  })

  it('refuses a different vendor', () => {
    const found = duplicatesAmong(reading(), [{ ...PRIOR, vendorName: 'Beta Plumbing' }])

    expect(found).toEqual([])
  })

  it('refuses a different amount', () => {
    const found = duplicatesAmong(reading(), [{ ...PRIOR, amount: '250.01' }])

    expect(found).toEqual([])
  })

  it('compares amounts as decimal strings, not as numbers', () => {
    // `250.1` and `250.10` are the same money and do **not** match here. That is
    // a deliberate false negative: story 2.2's decision is exact decimal end to
    // end, and `Number('0.10')` is where that ends. Both sides of a real
    // comparison come from one `numeric(14,2)` column, so Postgres renders them
    // identically and this case cannot arise — the assertion exists so that a
    // later "fix" using `Number()` has to argue with a test rather than pass.
    const found = duplicatesAmong(reading({ amount: '250.1' }), [{ ...PRIOR, amount: '250.10' }])

    expect(found).toEqual([])
  })

  it('refuses an invoice against itself', () => {
    // One row is not a pair. Without this the detector reports every invoice as
    // a duplicate of itself the moment the caller passes an unfiltered set.
    const subject = reading()

    expect(duplicatesAmong(subject, [subject])).toEqual([])
  })

  it('refuses another reading of the same document', () => {
    // A document can carry several invoice rows, and re-ingest rewrites them
    // all. Two readings of one upload are not two payments.
    const found = duplicatesAmong(reading(), [{ ...PRIOR, documentId: 'd-subject' }])

    expect(found).toEqual([])
  })
})

describe('what could not be read', () => {
  it('never matches two invoices whose amount is missing', () => {
    // **The trap the story named first.** Every invoice the extractor could not
    // read an amount from would otherwise match every other one, and the board
    // would be shown a duplicate that is really two failures to read.
    const found = duplicatesAmong(reading({ amount: null }), [{ ...PRIOR, amount: null }])

    expect(found).toEqual([])
  })

  it('never matches two invoices whose date is missing', () => {
    const found = duplicatesAmong(reading({ issuedOn: null, documentNumber: null }), [
      { ...PRIOR, issuedOn: null, documentNumber: null },
    ])

    expect(found).toEqual([])
  })

  it('never matches two invoices whose vendor is missing', () => {
    const found = duplicatesAmong(reading({ vendorName: null }), [{ ...PRIOR, vendorName: null }])

    expect(found).toEqual([])
  })

  it('still catches a duplicate when only the number is missing', () => {
    // The positive control for the three refusals above: a missing field must
    // disable the rule that needs it and no more. Amount and date are both
    // present here, so the exact rule still applies.
    const found = duplicatesAmong(reading({ documentNumber: null }), [
      { ...PRIOR, documentNumber: null },
    ])

    expect(found.map((m) => m.reason)).toEqual(['same-amount-and-date'])
  })
})

describe('more than one prior', () => {
  it('reports every match, because the evidence lists pairs', () => {
    // One finding per document per month, whose evidence carries every pair —
    // so the matcher must not stop at the first.
    const found = duplicatesAmong(reading(), [
      PRIOR,
      { ...PRIOR, extractionId: 'e-prior-2', documentId: 'd-prior-2' },
    ])

    expect(found.map((m) => m.priorDocumentId)).toEqual(['d-prior', 'd-prior-2'])
  })

  it('returns nothing when there is nothing to compare against', () => {
    expect(duplicatesAmong(reading(), [])).toEqual([])
  })
})
