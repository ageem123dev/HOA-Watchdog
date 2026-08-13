/**
 * The finding detail view (AC2).
 *
 * Two properties carry most of the weight here, and they pull in opposite
 * directions:
 *
 * - **It must not disagree with the row.** The same finding is described on the
 *   dashboard, on this page, and in story 4.8's email. The header assertions
 *   below are cross-checks against `toFindingRow` rather than against literals
 *   an author of this file chose — a literal would pass while the two surfaces
 *   drifted apart, which is the whole defect.
 * - **It must lay out what the row could not.** Every stored pair, every spike
 *   with its own percentage and average, the dues figures with their instalment
 *   count.
 *
 * And the standing rule underneath both: nothing throws, and nothing is
 * invented. A missing field costs its own cell and no other.
 */

import { describe, expect, it } from 'vitest'

import type { FindingDetail } from '@/core/ports/finding-reader'
import { toFindingDetail } from './detail-view'
import { reviewMessage } from './review'
import { toFindingRow } from './finding-view'

function detail(overrides: Partial<FindingDetail> = {}): FindingDetail {
  return {
    id: 'finding-1',
    findingType: 'possible_duplicate_invoice',
    subjectId: 'document-1',
    period: { from: '2026-04-01', until: '2026-05-01' },
    evidence: {},
    raisedOn: '2026-04-14',
    reviewed: null,
    ...overrides,
  }
}

const PAIR = {
  reason: 'same-amount-and-date',
  vendorName: 'Coastal Landscaping',
  amount: '1450.00',
  invoiceNumber: 'INV-2201',
  issuedOn: '2026-04-02',
  priorDocumentId: 'document-0',
  priorInvoiceNumber: 'INV-2118',
  priorIssuedOn: '2026-03-02',
}

const SPIKE = {
  percentOverAverage: '31.4',
  average: '900.00',
  invoicesAveraged: 6,
  vendorName: 'Harbour Plumbing',
  amount: '1183.00',
  invoiceNumber: 'INV-77',
  issuedOn: '2026-04-09',
}

const SHORTFALL = {
  kind: 'below-expected',
  expected: '1200.00',
  received: '400.00',
  shortfall: '800.00',
  instalmentsDue: 3,
  evaluatedOn: '2026-04-30',
  unitNumber: '12B',
  holderName: 'A. Okafor',
}

function duplicate(evidence: Record<string, unknown> = {}): FindingDetail {
  return detail({
    findingType: 'possible_duplicate_invoice',
    evidence: { invoicesChecked: 3, matchRule: 'normalised-exact', pairs: [PAIR], ...evidence },
  })
}

function spike(evidence: Record<string, unknown> = {}): FindingDetail {
  return detail({
    findingType: 'invoice_above_vendor_average',
    evidence: {
      invoicesChecked: 4,
      thresholdPercent: 20,
      windowMonths: 6,
      spikes: [SPIKE],
      ...evidence,
    },
  })
}

function shortfall(evidence: Record<string, unknown> = {}): FindingDetail {
  return detail({
    findingType: 'unit_dues_shortfall',
    subjectId: 'unit-12b',
    evidence: { ...SHORTFALL, ...evidence },
  })
}

/** The value of a named figure, or `undefined` when the view does not offer it. */
function figure(view: ReturnType<typeof toFindingDetail>, label: string): string | undefined {
  return view.figures.find((entry) => entry.label === label)?.value
}

/** The cell under a named column, on the row at `index`. */
function cell(
  view: ReturnType<typeof toFindingDetail>,
  column: string,
  index = 0,
): string | null | undefined {
  const table = view.comparisons
  if (table === null) return undefined
  const at = table.columns.findIndex((entry) => entry.label === column)
  if (at === -1) return undefined
  return table.rows[index]?.[at]
}

describe('the header agrees with the dashboard row', () => {
  // The cross-check. `toFindingRow` is an independent existing implementation of
  // this copy, so comparing against it catches a drift that comparing against a
  // literal in this file cannot.
  it.each([
    ['a duplicate', duplicate()],
    ['a spike', spike()],
    ['a shortfall', shortfall()],
    ['an unrecognised type', detail({ findingType: 'vendor_paid_before_approval' })],
    ['evidence that supports no sentence', detail({ evidence: {} })],
  ])('says the same thing as the row about %s', (_name, finding) => {
    const view = toFindingDetail(finding)
    const row = toFindingRow(finding)

    expect(view.title).toBe(row.title)
    expect(view.severity).toBe(row.severity)
    expect(view.severityLabel).toBe(row.severityLabel)
    expect(view.amount).toBe(row.amount)
    expect(view.raisedOn).toBe(row.raisedOn)
    // The row's one sentence, carried verbatim rather than reworded. The tables
    // are what this page adds; a second phrasing of the same sentence is what
    // `finding-view.ts` exists to prevent.
    expect(view.summary).toBe(row.evidenceLine)
  })

  it('carries the finding id, so the page can act on it', () => {
    expect(toFindingDetail(duplicate()).id).toBe('finding-1')
  })

  it('does not let a finding type reach Object.prototype', () => {
    const view = toFindingDetail(detail({ findingType: 'constructor' }))

    expect(view.severity).toBe('worth-checking')
    expect(view.severityLabel).toBe('Worth checking')
    expect(typeof view.title).toBe('string')
  })
})

describe('the window the finding concerns', () => {
  // **Found by the acceptance-criteria audit, where the Dev Notes said it would
  // be.** `period` was read by the adapter, carried by the port and carried by
  // the view, and rendered by nothing — the same shape 4.5's audit found for the
  // detection date. `core/ports/finding.ts`: "a shortfall that does not say
  // *which year* is unreadable".

  it('states it inclusively, not as the half-open range the database stores', () => {
    // `[2026-04-01, 2026-05-01)` covers April. Printed as stored, it reads as
    // though the first of May were included — a board member checking their own
    // records against it would be looking at the wrong month.
    const view = toFindingDetail(
      detail({ period: { from: '2026-04-01', until: '2026-05-01' } }),
    )

    expect(figure(view, 'Period')).toBe('2026-04-01 to 2026-04-30')
  })

  it('holds up across a year boundary', () => {
    const view = toFindingDetail(
      detail({ period: { from: '2026-01-01', until: '2027-01-01' } }),
    )

    expect(figure(view, 'Period')).toBe('2026-01-01 to 2026-12-31')
  })

  it('holds up across a leap day', () => {
    const view = toFindingDetail(
      detail({ period: { from: '2028-02-01', until: '2028-03-01' } }),
    )

    expect(figure(view, 'Period')).toBe('2028-02-01 to 2028-02-29')
  })

  it('says a single day as one day', () => {
    const view = toFindingDetail(
      detail({ period: { from: '2026-04-14', until: '2026-04-15' } }),
    )

    expect(figure(view, 'Period')).toBe('2026-04-14')
  })

  it('is shown for every kind of finding, because every finding has one', () => {
    for (const finding of [duplicate(), spike(), shortfall()]) {
      expect(figure(toFindingDetail(finding), 'Period')).toBeDefined()
    }
  })

  it.each([
    ['not a date', { from: 'April', until: '2026-05-01' }],
    ['a date that does not exist', { from: '2026-02-30', until: '2026-03-01' }],
    // **The two that actually exercise the round-trip check.** `Date.UTC` rolls
    // an impossible date forward rather than refusing it, so 2026-02-30 becomes
    // 2026-03-02 and 2026-13-01 becomes 2027-01-01. With an `until` far enough
    // ahead, the range check cannot catch either — and the period would render
    // with a start date no calendar has. The sensitivity pass found the first
    // version of these cases passing for the wrong reason.
    ['a February the 30th, with room to roll forward', { from: '2026-02-30', until: '2026-06-01' }],
    ['a thirteenth month', { from: '2026-13-01', until: '2027-06-01' }],
    ['an end that does not exist', { from: '2026-04-01', until: '2026-04-31' }],
    ['ending before it starts', { from: '2026-05-01', until: '2026-04-01' }],
    ['ending where it starts', { from: '2026-04-01', until: '2026-04-01' }],
    ['missing its end', { from: '2026-04-01', until: '' }],
  ])('shows no period at all when the range is %s', (_name, period) => {
    // A window nobody can state is not a window to state badly. Nothing throws.
    const view = toFindingDetail(detail({ period: period as never }))

    expect(figure(view, 'Period')).toBeUndefined()
    expect(JSON.stringify(view)).not.toMatch(/NaN|Invalid Date|undefined/)
  })
})

describe('AC6: the finding that somebody has already reviewed', () => {
  it('offers no review message at all while the finding is unreviewed', () => {
    expect(toFindingDetail(duplicate()).reviewed).toBeNull()
  })

  it('says who reviewed it and when', () => {
    const view = toFindingDetail(detail({ reviewed: { by: 'R. Mbeki', on: '2026-04-20' } }))

    expect(view.reviewed?.text).toBe('Already reviewed by R. Mbeki on 2026-04-20.')
  })

  it('says what is known when the reviewer never had a display name', () => {
    const view = toFindingDetail(detail({ reviewed: { by: null, on: '2026-04-20' } }))

    expect(view.reviewed?.text).toBe('Already reviewed on 2026-04-20.')
    expect(view.reviewed?.text).not.toMatch(/null|undefined/i)
  })

  it('offers no action, because the register has already answered', () => {
    const view = toFindingDetail(detail({ reviewed: { by: 'R. Mbeki', on: '2026-04-20' } }))

    // Not an error and not a retry — an ordinary outcome that someone got
    // there first.
    expect(view.reviewed?.canRetry).toBe(false)
  })

  it('words it exactly as the refusal words it', () => {
    // **The cross-check AC6 and AC7 need.** A board member who arrives late and
    // one who presses the control a moment too late are told the same fact, and
    // two wordings of it is the drift this story exists to prevent. Compared
    // against the refusal's own message rather than against a literal here.
    const by = 'R. Mbeki'
    const on = '2026-04-20'

    expect(toFindingDetail(detail({ reviewed: { by, on } })).reviewed).toEqual(
      reviewMessage({ outcome: 'already-reviewed', by, on }),
    )
  })

  it('still lays out the evidence, because the finding is what the page is about', () => {
    const view = toFindingDetail({
      ...duplicate(),
      reviewed: { by: 'R. Mbeki', on: '2026-04-20' },
    })

    expect(view.comparisons?.rows).toHaveLength(1)
    expect(figure(view, 'Invoices checked')).toBe('3')
  })
})

describe('a duplicate lays out every pair', () => {
  it('gives each stored pair its own row', () => {
    const second = { ...PAIR, invoiceNumber: 'INV-2202', amount: '99.00' }
    const view = toFindingDetail(duplicate({ pairs: [PAIR, second] }))

    expect(view.comparisons?.rows).toHaveLength(2)
    expect(cell(view, 'Invoice', 0)).toBe('INV-2201')
    expect(cell(view, 'Invoice', 1)).toBe('INV-2202')
  })

  it('keeps the order the detector stored them in', () => {
    const pairs = ['a', 'b', 'c'].map((suffix) => ({ ...PAIR, invoiceNumber: `INV-${suffix}` }))
    const view = toFindingDetail(duplicate({ pairs }))

    expect([0, 1, 2].map((index) => cell(view, 'Invoice', index))).toEqual(['INV-a', 'INV-b', 'INV-c'])
  })

  it('shows what each pair was compared on, and the invoice it matched', () => {
    const view = toFindingDetail(duplicate())

    expect(cell(view, 'Vendor')).toBe('Coastal Landscaping')
    expect(cell(view, 'Issued')).toBe('2026-04-02')
    expect(cell(view, 'Amount')).toBe('$1,450.00')
    expect(cell(view, 'Matched on')).toBe('amount and date')
    expect(cell(view, 'Earlier invoice')).toBe('INV-2118')
    expect(cell(view, 'Earlier issued')).toBe('2026-03-02')
  })

  it('counts what was checked', () => {
    expect(figure(toFindingDetail(duplicate()), 'Invoices checked')).toBe('3')
  })

  it('marks the money column as numeric, so it can be set tabular and right-aligned', () => {
    const view = toFindingDetail(duplicate())
    const columns = view.comparisons?.columns ?? []

    expect(columns.find((column) => column.label === 'Amount')?.numeric).toBe(true)
    expect(columns.find((column) => column.label === 'Vendor')?.numeric).toBe(false)
  })

  it('says a match rule it does not recognise, rather than dropping it', () => {
    const view = toFindingDetail(duplicate({ pairs: [{ ...PAIR, reason: 'same-amount-and-vat' }] }))

    expect(cell(view, 'Matched on')).toBe('same amount and vat')
  })

  it('does not let a match reason reach Object.prototype', () => {
    const view = toFindingDetail(duplicate({ pairs: [{ ...PAIR, reason: 'constructor' }] }))

    expect(cell(view, 'Matched on')).toBe('constructor')
  })
})

describe('a spike lays out each comparison with its own figures', () => {
  it('shows every spike with the average it was measured against', () => {
    const second = { ...SPIKE, percentOverAverage: '54.0', average: '100.00', invoicesAveraged: 4 }
    const view = toFindingDetail(spike({ spikes: [SPIKE, second] }))

    expect(view.comparisons?.rows).toHaveLength(2)
    expect(cell(view, 'Above average', 0)).toBe('31.4%')
    expect(cell(view, 'Average', 0)).toBe('$900.00')
    expect(cell(view, 'Invoices averaged', 0)).toBe('6')
    expect(cell(view, 'Above average', 1)).toBe('54.0%')
    expect(cell(view, 'Average', 1)).toBe('$100.00')
    expect(cell(view, 'Invoices averaged', 1)).toBe('4')
  })

  it('names the vendor and the invoice on each row', () => {
    const view = toFindingDetail(spike())

    expect(cell(view, 'Vendor')).toBe('Harbour Plumbing')
    expect(cell(view, 'Invoice')).toBe('INV-77')
    expect(cell(view, 'Issued')).toBe('2026-04-09')
    expect(cell(view, 'Amount')).toBe('$1,183.00')
  })

  it('states the threshold and the window a board member would otherwise have to read the source for', () => {
    const view = toFindingDetail(spike())

    expect(figure(view, 'Threshold')).toBe('20%')
    expect(figure(view, 'Trailing window')).toBe('6 months')
    expect(figure(view, 'Invoices checked')).toBe('4')
  })

  it('uses the singular for a one-month window', () => {
    expect(figure(toFindingDetail(spike({ windowMonths: 1 })), 'Trailing window')).toBe('1 month')
  })

  it.each([
    ['not a number at all', 'abc'],
    ['a number rather than a decimal string', 31.4],
    ['absent', undefined],
    ['blank', '   '],
  ])('shows no percentage when it is %s', (_name, percentOverAverage) => {
    const view = toFindingDetail(spike({ spikes: [{ ...SPIKE, percentOverAverage }] }))

    expect(cell(view, 'Above average')).toBeNull()
  })

  it('keeps the rest of a spike when one of its figures is missing', () => {
    const view = toFindingDetail(spike({ spikes: [{ ...SPIKE, average: null }] }))

    expect(cell(view, 'Average')).toBeNull()
    expect(cell(view, 'Above average')).toBe('31.4%')
    expect(cell(view, 'Invoices averaged')).toBe('6')
    expect(cell(view, 'Amount')).toBe('$1,183.00')
  })
})

describe('a dues shortfall lays out its figures', () => {
  it('shows what was expected, what arrived, and the gap', () => {
    const view = toFindingDetail(shortfall())

    expect(figure(view, 'Expected')).toBe('$1,200.00')
    expect(figure(view, 'Received')).toBe('$400.00')
    expect(figure(view, 'Shortfall')).toBe('$800.00')
  })

  it('carries the instalment count the schedule was measured by', () => {
    expect(figure(toFindingDetail(shortfall()), 'Instalments due')).toBe('3')
  })

  it('names the unit, who holds it, and the date it was evaluated', () => {
    const view = toFindingDetail(shortfall())

    expect(figure(view, 'Unit')).toBe('12B')
    expect(figure(view, 'Held by')).toBe('A. Okafor')
    expect(figure(view, 'Evaluated on')).toBe('2026-04-30')
  })

  it('says nothing was recorded rather than showing a manufactured zero', () => {
    // The one figure on this surface a board member would most readily act on,
    // and the commonest cause is a deposit nobody has uploaded yet. `$0.00`
    // received reads as a payment of nothing; the row already refused it.
    const view = toFindingDetail(shortfall({ kind: 'not-recorded', received: '0.00' }))

    expect(figure(view, 'Received')).toBe('Nothing recorded')
  })

  it('compares nothing, because one unit against its own schedule is not a comparison of several', () => {
    expect(toFindingDetail(shortfall()).comparisons).toBeNull()
  })

  it.each(['expected', 'received', 'shortfall', 'instalmentsDue', 'evaluatedOn', 'unitNumber', 'holderName'])(
    'omits the %s figure when the record does not hold it, and keeps the others',
    (missing) => {
      const view = toFindingDetail(shortfall({ [missing]: undefined }))
      const labels = view.figures.map((entry) => entry.label)

      expect(labels.length).toBeGreaterThan(0)
      expect(view.figures.every((entry) => entry.value.trim() !== '')).toBe(true)
    },
  )

  it('never renders an absent unit number as text', () => {
    const view = toFindingDetail(shortfall({ unitNumber: undefined }))

    expect(figure(view, 'Unit')).toBeUndefined()
    expect(JSON.stringify(view)).not.toContain('undefined')
  })
})

describe('nothing throws, whatever the evidence holds', () => {
  it.each([
    ['null', null],
    ['a string', 'nonsense'],
    ['a number', 7],
    ['an array', [{ pairs: [] }]],
    ['an empty object', {}],
  ])('degrades rather than failing when evidence is %s', (_name, evidence) => {
    const view = toFindingDetail(duplicate({}))
    expect(view).toBeDefined()

    const degraded = toFindingDetail(detail({ evidence }))

    expect(degraded.comparisons).toBeNull()
    // The period survives, because it is a column on the row rather than a
    // field of the evidence blob. What must contribute nothing is the blob.
    expect(degraded.figures.map((entry) => entry.label)).toEqual(['Period'])
  })

  it.each([
    ['absent', undefined],
    ['not an array', { count: 2 }],
    ['empty', []],
  ])('offers no comparisons table when pairs are %s', (_name, pairs) => {
    // Not an empty table. A table with headers and no rows says a comparison
    // was made and matched nothing, which is the opposite of what an absent
    // `pairs` means.
    expect(toFindingDetail(duplicate({ pairs })).comparisons).toBeNull()
  })

  it('drops entries that are not objects and keeps the ones that are', () => {
    const view = toFindingDetail(duplicate({ pairs: ['nope', null, PAIR, ['also nope']] }))

    expect(view.comparisons?.rows).toHaveLength(1)
    expect(cell(view, 'Invoice')).toBe('INV-2201')
  })

  it('leaves a cell absent rather than inventing one, when a pair is missing every field', () => {
    const view = toFindingDetail(duplicate({ pairs: [{}] }))

    expect(view.comparisons?.rows).toHaveLength(1)
    expect(view.comparisons?.rows[0]?.every((value) => value === null)).toBe(true)
  })

  it('omits the checked count rather than reporting zero when it was not stored', () => {
    // UX-DR24 cuts both ways: a denominator that was not stored may not be
    // manufactured, and "of 0" is a claim about a comparison that did not run.
    expect(figure(toFindingDetail(duplicate({ invoicesChecked: undefined })), 'Invoices checked')).toBeUndefined()
  })

  it.each([
    ['thresholdPercent', 'Threshold'],
    ['windowMonths', 'Trailing window'],
  ])('omits the figure for %s when it is absent', (field, label) => {
    expect(figure(toFindingDetail(spike({ [field]: undefined })), label)).toBeUndefined()
  })

  it.each([
    ['Vendor', 'vendorName'],
    ['Invoice', 'invoiceNumber'],
    ['Earlier invoice', 'priorInvoiceNumber'],
  ])('treats a blank %s as absent rather than as a value', (column, field) => {
    // A cell holding three spaces looks empty and is not. It reads as nothing
    // to a sighted board member, announces nothing to a screen reader, and
    // still counts as a value everywhere upstream — so a title built from it
    // gains a separator with nothing after it. Found by the test-value pass:
    // the blank guard in `text()` had no test behind it in either caller.
    const view = toFindingDetail(duplicate({ pairs: [{ ...PAIR, [field]: '   ' }] }))

    expect(cell(view, column)).toBeNull()
  })

  it('carries a hostile string through unaltered, because escaping belongs to the renderer', () => {
    const hostile = '<script>alert(1)</script>'
    const view = toFindingDetail(duplicate({ pairs: [{ ...PAIR, vendorName: hostile }] }))

    // Escaped here as well as by React, it would reach the page double-escaped
    // and a board member would read the markup rather than the vendor's name.
    expect(cell(view, 'Vendor')).toBe(hostile)
  })

  it('offers no figures and no table for a finding type it has never seen', () => {
    const view = toFindingDetail(
      detail({ findingType: 'vendor_paid_before_approval', evidence: { anything: 'at all' } }),
    )

    expect(view.figures.map((entry) => entry.label)).toEqual(['Period'])
    expect(view.comparisons).toBeNull()
    expect(view.title).toBe('Vendor paid before approval')
  })
})
