/**
 * A stored finding as a board member reads it.
 *
 * Three rules are asserted here rather than trusted, because all three are the
 * kind that survive a code review and fail in front of a director:
 *
 * - **UX-DR2** — severity always arrives with words. A row rendered with no
 *   colour at all still says which it is.
 * - **UX-DR23** — the line states what was compared, never what it means. The
 *   detector is exact; "you paid twice" is a conclusion the system is not
 *   entitled to.
 * - **UX-DR24** — the count comes from the evidence the detector stored. Where
 *   the evidence has no count, the line says less rather than inventing one.
 *
 * And one rule that is really an availability requirement: **nothing in here
 * may throw.** `evidence` is `jsonb` written by whichever version of a detector
 * ran, and a row that dies takes the whole queue down with it.
 */

import { describe, expect, it } from 'vitest'

import type { UnreviewedFinding } from '../ports/finding-reader'
import { toFindingRow } from './finding-view'

function finding(overrides: Partial<UnreviewedFinding> = {}): UnreviewedFinding {
  return {
    id: 'finding-1',
    findingType: 'possible_duplicate_invoice',
    subjectId: 'doc-1',
    period: { from: '2026-04-01', until: '2026-05-01' },
    evidence: {},
    raisedOn: '2026-04-14',
    ...overrides,
  }
}

const duplicate = (evidence: unknown) => finding({ findingType: 'possible_duplicate_invoice', evidence })
const spike = (evidence: unknown) => finding({ findingType: 'invoice_above_vendor_average', evidence })
const shortfall = (evidence: unknown) => finding({ findingType: 'unit_dues_shortfall', evidence })

/** The shape `detect-duplicates.ts` actually writes. */
const duplicateEvidence = {
  invoicesChecked: 3,
  matchRule: 'normalised-exact',
  pairs: [
    {
      reason: 'same-amount-and-date',
      vendorName: 'Coastal Landscaping',
      amount: '1450.00',
      invoiceNumber: 'INV-2201',
      issuedOn: '2026-04-02',
      priorDocumentId: 'doc-0',
      priorInvoiceNumber: 'INV-2198',
      priorIssuedOn: '2026-04-02',
    },
  ],
}

/** The shape `detect-vendor-spikes.ts` actually writes. */
const spikeEvidence = {
  invoicesChecked: 2,
  thresholdPercent: 20,
  windowMonths: 6,
  spikes: [
    {
      percentOverAverage: '31.4',
      average: '980.00',
      invoicesAveraged: 4,
      vendorName: 'Harbour Plumbing',
      amount: '1287.72',
      invoiceNumber: 'HP-77',
      issuedOn: '2026-04-09',
    },
  ],
}

/** The shape `detect-dues-shortfalls.ts` actually writes. */
const shortfallEvidence = {
  kind: 'below-expected',
  expected: '400.00',
  received: '300.00',
  shortfall: '100.00',
  instalmentsDue: 4,
  billingCycle: 'monthly',
  evaluatedOn: '2026-04-01',
  unitNumber: '12B',
  holderName: 'Dana Whitfield',
}

describe('severity, and the words that carry it', () => {
  it.each([
    { type: 'possible_duplicate_invoice', severity: 'needs-review', label: 'Needs review' },
    { type: 'invoice_above_vendor_average', severity: 'worth-checking', label: 'Worth checking' },
    { type: 'unit_dues_shortfall', severity: 'worth-checking', label: 'Worth checking' },
  ])('reads $type as $label', ({ type, severity, label }) => {
    const row = toFindingRow(finding({ findingType: type }))

    expect(row.severity).toBe(severity)
    expect(row.severityLabel).toBe(label)
  })

  it('never returns a severity without its label', () => {
    // **UX-DR2, as a property rather than three examples.** The rule is that
    // colour is never the sole carrier of meaning, and the way that breaks is
    // a level being added to the map with no words beside it — which no
    // per-type example above would catch, because the new type would not be in
    // any of them.
    const types = [
      'possible_duplicate_invoice',
      'invoice_above_vendor_average',
      'unit_dues_shortfall',
      'something_nobody_has_written_yet',
    ]

    for (const type of types) {
      expect(toFindingRow(finding({ findingType: type })).severityLabel).not.toBe('')
    }
  })

  it('shows a type it has never met rather than dropping it', () => {
    // **AC3, and the worst defect this surface can have.** A finding that
    // vanishes because a later story added a detector is indistinguishable,
    // from the board's side, from having nothing to report.
    const row = toFindingRow(finding({ findingType: 'vendor_paid_before_approval' }))

    expect(row.severityLabel).toBe('Worth checking')
    expect(row.title).toBe('Vendor paid before approval')
  })

  it('does not escalate a type it cannot name', () => {
    // The other half of AC3, and the half that is a judgement: an unknown
    // finding is shown, but the system does not shout about something it
    // cannot describe. Pinned so the fallback is not "quietly made urgent"
    // later by someone reasoning that unknown means dangerous.
    expect(toFindingRow(finding({ findingType: 'anything_at_all' })).severity).toBe('worth-checking')
  })
})

describe('a possible duplicate invoice', () => {
  it('names the vendor without claiming a duplicate happened', () => {
    // UX-DR23. "Possible", because two identical payments to one vendor on one
    // day is a thing an association legitimately does.
    const row = toFindingRow(duplicate(duplicateEvidence))

    expect(row.title).toBe('Possible duplicate invoice — Coastal Landscaping')
    expect(row.title).not.toMatch(/paid twice|duplicate payment/i)
  })

  it('states how many matched out of how many were checked', () => {
    // UX-DR24's denominator, and it is the detector's own `invoicesChecked` —
    // not the length of the pairs array, which would make the sentence say
    // "1 of 1" and reassure without checking anything.
    const row = toFindingRow(duplicate(duplicateEvidence))

    expect(row.evidenceLine).toBe(
      '1 of 3 invoices on this upload matches an earlier one on amount and date.',
    )
  })

  it('names both comparison rules when both fired', () => {
    const row = toFindingRow(
      duplicate({
        ...duplicateEvidence,
        pairs: [
          duplicateEvidence.pairs[0],
          { ...duplicateEvidence.pairs[0], reason: 'same-amount-and-number', amount: '1450.00' },
        ],
      }),
    )

    expect(row.evidenceLine).toBe(
      '2 of 3 invoices on this upload match an earlier one on amount and date, and on amount and invoice number.',
    )
  })

  it('carries the amount at stake', () => {
    expect(toFindingRow(duplicate(duplicateEvidence)).amount).toBe('$1,450.00')
  })

  it('shows no amount when the pairs do not agree on one', () => {
    // **The decision AC5 forces.** Two duplicated invoices of different values
    // is one finding with two amounts, and the row has one money column.
    // Summing them would state a figure no record holds; showing the first
    // would state a figure that is only part of it. So it shows none, and the
    // evidence line still carries the count.
    const row = toFindingRow(
      duplicate({
        ...duplicateEvidence,
        pairs: [
          duplicateEvidence.pairs[0],
          { ...duplicateEvidence.pairs[0], amount: '2900.00' },
        ],
      }),
    )

    expect(row.amount).toBeNull()
    expect(row.evidenceLine).toMatch(/^2 of 3 invoices/)
  })

  it('shows no amount when the invoice figure could not be read', () => {
    // `amount` is nullable in the evidence because an invoice whose figure was
    // unreadable still raises a finding — the document is the evidence.
    const row = toFindingRow(
      duplicate({ ...duplicateEvidence, pairs: [{ ...duplicateEvidence.pairs[0], amount: null }] }),
    )

    expect(row.amount).toBeNull()
  })
})

describe('an invoice above the vendor average', () => {
  it('states the percentage, the window and what the average rests on', () => {
    // AD-6: the derived value, not the ingredients. And both of UX-DR24's
    // denominators — the window and how many invoices are in it — because
    // "31.4% above average" over one invoice is not the same claim as over
    // twenty.
    const row = toFindingRow(spike(spikeEvidence))

    expect(row.title).toBe('Invoice above average — Harbour Plumbing')
    expect(row.evidenceLine).toBe(
      '31.4% above a 6-month average of $980.00 across 4 invoices.',
    )
    expect(row.amount).toBe('$1,287.72')
  })

  it('reports the group when one upload carried several spikes', () => {
    // A spike finding is keyed on the document and the month, so an upload of
    // four invoices can raise one finding covering three of them. The detailed
    // sentence describes a single comparison and cannot describe three, so the
    // line states the count and the window instead — and the percentages stay
    // in the evidence for the detail surface (4.6) to lay out properly.
    const row = toFindingRow(
      spike({
        ...spikeEvidence,
        invoicesChecked: 4,
        spikes: [
          spikeEvidence.spikes[0],
          { ...spikeEvidence.spikes[0], percentOverAverage: '52.9', amount: '1499.00' },
        ],
      }),
    )

    expect(row.evidenceLine).toBe('2 of 4 invoices are above a 6-month average for their vendor.')
    expect(row.amount).toBeNull()
  })

  it('does not name one vendor when the finding covers two', () => {
    // The title is the row's claim about what this is. Naming the first
    // vendor found would attribute a second vendor's invoice to them, on a
    // surface whose whole purpose is to be quotable.
    const row = toFindingRow(
      spike({
        ...spikeEvidence,
        spikes: [
          spikeEvidence.spikes[0],
          { ...spikeEvidence.spikes[0], vendorName: 'Bayside Electric' },
        ],
      }),
    )

    expect(row.title).toBe('Invoices above average')
  })

  it('renders the vendor name exactly as the document gave it', () => {
    // **AD-8 and AC10 at the point the string enters the copy.** A name is
    // extracted text; normalising it here would make the board's dashboard
    // disagree with the record they are being asked to recognise.
    const said = 'harbour   PLUMBING  &  Sons <Ltd>'

    const row = toFindingRow(
      spike({ ...spikeEvidence, spikes: [{ ...spikeEvidence.spikes[0], vendorName: said }] }),
    )

    expect(row.title).toBe(`Invoice above average — ${said}`)
  })
})

describe('a unit that is short on its dues', () => {
  it('says what was expected against what arrived, and by when', () => {
    const row = toFindingRow(shortfall(shortfallEvidence))

    expect(row.title).toBe('Dues below the schedule — unit 12B')
    expect(row.evidenceLine).toBe(
      '$400.00 expected by 2026-04-01 across 4 instalments; $300.00 received.',
    )
    expect(row.amount).toBe('$100.00')
  })

  it('distinguishes nothing-recorded from something-short, without calling it unpaid', () => {
    // **The copy decision `dues-shortfall.ts` argues for in its own header.**
    // The commonest cause of nothing being recorded is a deposit nobody has
    // uploaded yet, and UX-DR23 forbids implying a certainty the system lacks
    // — least of all about whether a named person paid.
    const row = toFindingRow(
      shortfall({ ...shortfallEvidence, kind: 'not-recorded', received: '0.00', shortfall: '400.00' }),
    )

    expect(row.title).toBe('No dues recorded — unit 12B')
    expect(row.evidenceLine).toBe(
      '$400.00 expected by 2026-04-01 across 4 instalments; nothing recorded.',
    )
    expect(row.evidenceLine).not.toMatch(/unpaid|has not paid|failed to/i)
  })

  it('raises the finding even when no holder is on the roll', () => {
    // `holderName` is nullable and a null one still gets a finding — the money
    // is still short. The row must not become unreadable because the roll has
    // a gap in it.
    const row = toFindingRow(shortfall({ ...shortfallEvidence, holderName: null }))

    expect(row.title).toBe('Dues below the schedule — unit 12B')
    expect(row.evidenceLine).toContain('$400.00 expected')
  })
})

describe('evidence the code has never met', () => {
  // **AC6.** Each of these is a row the register can legitimately contain: an
  // older detector version, a hand-inserted row, a type from a later story.
  // The requirement is not that they render well — it is that they render, and
  // that the twenty good rows beside them still do.
  const hostile: readonly { label: string; evidence: unknown }[] = [
    { label: 'an empty object', evidence: {} },
    { label: 'null', evidence: null },
    { label: 'a string', evidence: 'invoicesChecked: 3' },
    { label: 'an array', evidence: [1, 2, 3] },
    { label: 'pairs as a string', evidence: { invoicesChecked: 3, pairs: 'one' } },
    { label: 'pairs holding nulls', evidence: { invoicesChecked: 3, pairs: [null, null] } },
    { label: 'a count that is not a number', evidence: { invoicesChecked: 'three', pairs: [] } },
    { label: 'a nested object where a string belongs', evidence: { spikes: [{ vendorName: {} }] } },
  ]

  it.each(hostile)('renders rather than throwing for $label', ({ evidence }) => {
    const row = toFindingRow(duplicate(evidence))

    expect(row.id).toBe('finding-1')
    expect(row.severityLabel).toBe('Needs review')
    expect(row.title).not.toBe('')
  })

  it.each(hostile)('invents no amount for $label', ({ evidence }) => {
    // The failure this whole block guards against is not a crash — it is a
    // plausible-looking row assembled out of nothing.
    expect(toFindingRow(spike(evidence)).amount).toBeNull()
  })

  it('falls back to a legible title when the evidence names no vendor', () => {
    expect(toFindingRow(duplicate({ invoicesChecked: 3, pairs: [] })).title).toBe(
      'Possible duplicate invoice',
    )
  })

  it('says nothing rather than something false when there is no count', () => {
    // UX-DR24 cuts both ways. Where the evidence carries no denominator, the
    // honest line is no line — not "0 of 0 invoices", which is a reassurance
    // about a check that did not happen.
    expect(toFindingRow(duplicate({})).evidenceLine).toBeNull()
  })

  it('keeps the identifying fields whatever the evidence says', () => {
    const row = toFindingRow(duplicate('nonsense'))

    expect(row).toMatchObject({
      id: 'finding-1',
      findingType: 'possible_duplicate_invoice',
      raisedOn: '2026-04-14',
      period: { from: '2026-04-01', until: '2026-05-01' },
    })
  })
})
