/**
 * When a vendor has charged more than usual.
 *
 * Two things are under test and only one of them is the happy path. The other is
 * the arithmetic: `numeric(14,2)` averaged over six months does not divide
 * evenly, and a percentage computed from a rounded average is a different number
 * from one computed off the exact sum. Cases near the boundary are where that
 * difference decides a finding.
 */

import { describe, expect, it } from 'vitest'

import type { InvoiceReading } from './duplicate-invoice'
import {
  MINIMUM_HISTORY,
  SPIKE_THRESHOLD_PERCENT,
  TRAILING_WINDOW_MONTHS,
  spikeAgainst,
} from './vendor-spike'

function invoice(amount: string | null, id = 'e-1'): InvoiceReading {
  return {
    extractionId: id,
    documentId: `d-${id}`,
    vendorName: 'Acme Plumbing',
    documentNumber: 'INV-1',
    issuedOn: '2026-06-14',
    amount,
    documentUploadedAt: '2026-06-20',
  }
}

/** Three prior invoices averaging exactly 100.00. */
const STEADY = [invoice('100.00', 'p1'), invoice('100.00', 'p2'), invoice('100.00', 'p3')]

describe('an invoice above the trailing average', () => {
  it('is flagged when it exceeds the threshold', () => {
    const spike = spikeAgainst(invoice('130.00'), STEADY)

    expect(spike).toMatchObject({
      percentOverAverage: '30.0',
      average: '100.00',
      invoicesAveraged: 3,
      thresholdPercent: SPIKE_THRESHOLD_PERCENT,
    })
  })

  it('carries the count of what was averaged', () => {
    // UX-DR24 forbids reassurance without a count of what was checked, and a
    // percentage with no denominator is exactly that.
    const spike = spikeAgainst(invoice('200.00'), [...STEADY, invoice('100.00', 'p4')])

    expect(spike?.invoicesAveraged).toBe(4)
  })
})

describe('the boundary', () => {
  it('is not flagged exactly at the threshold', () => {
    // Strictly *exceeding*, per FR-6. Pinned because the alternative reading is
    // one character away in the source.
    expect(spikeAgainst(invoice('120.00'), STEADY)).toBeNull()
  })

  it('is flagged one cent above it', () => {
    expect(spikeAgainst(invoice('120.01'), STEADY)).not.toBeNull()
  })

  it('decides on the exact sum, not on a rounded average', () => {
    // **The case the two readings disagree on, and it took a calculation to
    // find — the first version of this test asserted a pair that both readings
    // answer the same way.**
    //
    // 100.00, 100.00 and 100.02 sum to 300.02. The exact average is 100.00666…,
    // so the exact threshold is 120.008 and **120.01 exceeds it**. Rounding the
    // average first gives 100.01, whose threshold is 120.012 — and 120.01 falls
    // short. One cent, one finding, decided entirely by where the rounding
    // happened.
    //
    // This implementation never divides before comparing, so the exact reading
    // is the one that holds.
    const uneven = [invoice('100.00', 'p1'), invoice('100.00', 'p2'), invoice('100.02', 'p3')]

    expect(spikeAgainst(invoice('120.01'), uneven)).not.toBeNull()
    expect(spikeAgainst(invoice('120.00'), uneven)).toBeNull()
  })
})

describe('too little history', () => {
  it.each([0, 1, 2])('is not flagged against %i prior invoices', (count) => {
    // The false positive most likely to ship: a brand-new vendor's second
    // invoice, where the "average" is a single opening bill.
    const history = STEADY.slice(0, count)

    expect(spikeAgainst(invoice('1000.00'), history)).toBeNull()
  })

  it('is flagged at the minimum', () => {
    // The other side of the boundary, so the constant cannot drift unnoticed.
    expect(STEADY).toHaveLength(MINIMUM_HISTORY)
    expect(spikeAgainst(invoice('1000.00'), STEADY)).not.toBeNull()
  })
})

describe('what must not be flagged', () => {
  it('refuses an invoice below the average', () => {
    expect(spikeAgainst(invoice('50.00'), STEADY)).toBeNull()
  })

  it('refuses an invoice whose amount could not be read', () => {
    expect(spikeAgainst(invoice(null), STEADY)).toBeNull()
  })

  it('refuses a credit, which is money coming back', () => {
    // `total_amount` is negative for a credit to the association, and migration
    // 006 says so precisely because this detector reads it.
    expect(spikeAgainst(invoice('-500.00'), STEADY)).toBeNull()
  })

  it('drops unreadable priors rather than counting them as zero', () => {
    // Counting a null as zero drags the average down and manufactures a spike.
    // Here two of five are unreadable, leaving three real ones averaging 100.
    const history = [...STEADY, invoice(null, 'p4'), invoice(null, 'p5')]

    expect(spikeAgainst(invoice('130.00'), history)).toMatchObject({
      invoicesAveraged: 3,
      percentOverAverage: '30.0',
    })
  })

  it('refuses when the unreadable priors leave too few', () => {
    const history = [invoice('100.00', 'p1'), invoice(null, 'p2'), invoice(null, 'p3')]

    expect(spikeAgainst(invoice('1000.00'), history)).toBeNull()
  })

  it('refuses history whose amounts sum to nothing', () => {
    // Every prior a credit, so the sum is refused before it becomes a divisor.
    const history = [invoice('-1.00', 'p1'), invoice('-2.00', 'p2'), invoice('-3.00', 'p3')]

    expect(spikeAgainst(invoice('100.00'), history)).toBeNull()
  })
})

describe('the constants are named, not inlined', () => {
  it('states the threshold and the window as exports', () => {
    // The epic fixed both, and required a single named export so a later epic
    // changes where the value comes from and not what reads it.
    expect(SPIKE_THRESHOLD_PERCENT).toBe(20)
    expect(TRAILING_WINDOW_MONTHS).toBe(6)
  })

  it('reports the threshold it used, so a surface need not import it', () => {
    expect(spikeAgainst(invoice('130.00'), STEADY)?.thresholdPercent).toBe(SPIKE_THRESHOLD_PERCENT)
  })
})
