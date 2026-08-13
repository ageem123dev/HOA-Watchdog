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

import type { FindingRecord } from '../ports/finding-reader'
import { toFindingRow } from './finding-view'

function finding(overrides: Partial<FindingRecord> = {}): FindingRecord {
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

  it('treats a type that names an inherited property as unknown', () => {
    // **`constructor` passes `finding_type_is_verb_noun`** — the column's check
    // constraint is `^[a-z][a-z0-9_]*$`, and every character qualifies. A plain
    // object literal inherits it, so `SEVERITY['constructor']` returns the
    // `Object` function rather than `undefined`, the `??` fallback never fires,
    // and the row's severity becomes a function: no label, no tick colour, and
    // UX-DR2 broken on the one row that most needed AC3's promise to hold.
    const row = toFindingRow(finding({ findingType: 'constructor' }))

    expect(row.severity).toBe('worth-checking')
    expect(row.severityLabel).toBe('Worth checking')
    expect(row.title).toBe('Constructor')
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

  it('ignores a match reason that names an inherited property', () => {
    // The same defect one layer down, and this one reaches the page. `reason`
    // comes out of `jsonb`, so it is whatever was stored; `MATCH_REASON` is an
    // object literal, so `MATCH_REASON['constructor']` is the `Object` function
    // rather than `undefined` — and the phrase list is joined into the sentence
    // a board member reads. The rendered evidence line would have contained
    // `function Object() { [native code] }`.
    const row = toFindingRow(
      duplicate({
        ...duplicateEvidence,
        pairs: [{ ...duplicateEvidence.pairs[0], reason: 'constructor' }],
      }),
    )

    expect(row.evidenceLine).toBe('1 of 3 invoices on this upload matches an earlier one.')
    expect(row.evidenceLine).not.toMatch(/function|native code|\[object/i)
  })

  it('carries the amount at stake', () => {
    expect(toFindingRow(duplicate(duplicateEvidence)).amount).toBe('$1,450.00')
  })

  it('keeps the amount when the evidence lost only its denominator', () => {
    // **A missing count invalidates the sentence, not the figure.** The guard
    // suppressed both together, so a finding written before `invoicesChecked`
    // existed — or by any detector that stops storing it — rendered with no
    // money column despite the record plainly supporting one. Raised by
    // CodeRabbit on the merge request.
    //
    // The pull is in the opposite direction from AC5, which is why it is worth
    // stating: AC5 forbids inventing a figure the record does not support, and
    // this forbids withholding one it does.
    const row = toFindingRow(duplicate({ pairs: duplicateEvidence.pairs }))

    expect(row.amount).toBe('$1,450.00')
    expect(row.evidenceLine).toBeNull()
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

  it.each([
    ['is not a number at all', 'abc'],
    ['carries a currency mark the sentence would repeat', '$31.4'],
    ['is a number rather than the decimal string the detector stores', 31.4],
  ])('builds no sentence when the percentage %s', (_name, percentOverAverage) => {
    // **`abc%` on a fiduciary surface.** `percentOverAverage` comes out of
    // `jsonb`, and a non-blank-string check is not a number check — the row
    // interpolated it straight into the sentence a board member reads. Raised
    // by Argus against story 4.6's detail view, which guards this; the row is
    // the sibling that did not, and the two describing the same finding
    // differently is what this story exists to prevent.
    const row = toFindingRow(
      spike({ ...spikeEvidence, spikes: [{ ...spikeEvidence.spikes[0], percentOverAverage }] }),
    )

    expect(row.evidenceLine).toBeNull()
  })

  it('does not hang a separator off a vendor name that is only whitespace', () => {
    // A blank name is an absent one, and treating it as present produces
    // `Invoice above average — ` with nothing after the dash: a title that
    // looks like the extractor dropped the vendor mid-render. Found by story
    // 4.6's test-value pass — the blank guard this rests on was carried by both
    // callers and asserted by neither.
    const row = toFindingRow(
      spike({ ...spikeEvidence, spikes: [{ ...spikeEvidence.spikes[0], vendorName: '   ' }] }),
    )

    expect(row.title).toBe('Invoice above average')
  })
})

describe('the copy counts in singulars as well as plurals', () => {
  // Raised by Argus on the whole-story pass. "1 instalments" and "across 1
  // invoices" are what a template with a hard-coded plural produces, and this
  // is copy a board member reads beside a figure they are being asked to act
  // on — the surface's credibility is most of what it has.

  it('says one instalment', () => {
    const row = toFindingRow(shortfall({ ...shortfallEvidence, instalmentsDue: 1 }))

    expect(row.evidenceLine).toMatch(/across 1 instalment;/)
    expect(row.evidenceLine).not.toMatch(/1 instalments/)
  })

  it('still says several instalments', () => {
    const row = toFindingRow(shortfall({ ...shortfallEvidence, instalmentsDue: 3 }))

    expect(row.evidenceLine).toMatch(/across 3 instalments;/)
  })

  it('says one invoice was averaged', () => {
    const row = toFindingRow(
      spike({ ...spikeEvidence, spikes: [{ ...spikeEvidence.spikes[0], invoicesAveraged: 1 }] }),
    )

    expect(row.evidenceLine).toMatch(/across 1 invoice\./)
    expect(row.evidenceLine).not.toMatch(/1 invoices/)
  })

  it('says one invoice was checked', () => {
    const row = toFindingRow(
      duplicate({ ...duplicateEvidence, invoicesChecked: 1, pairs: [duplicateEvidence.pairs[0]] }),
    )

    expect(row.evidenceLine).toMatch(/1 of 1 invoice on this upload/)
    expect(row.evidenceLine).not.toMatch(/1 invoices/)
  })

  it('still says several invoices were checked', () => {
    const row = toFindingRow(duplicate(duplicateEvidence))

    expect(row.evidenceLine).toMatch(/of 3 invoices on this upload/)
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
  // **Each fixture carries the reader whose shape it is hostile to.** The first
  // version routed every one of them through the spike reader for the
  // amount assertion, and all but one were duplicate-shaped: the spike reader
  // found no `spikes` key and returned null trivially, so those cases could not
  // have failed however the spike path behaved. Raised by CodeRabbit, and it is
  // the same defect class as a refusal test where refused and absent look
  // alike.
  const hostile: readonly { label: string; evidence: unknown; through: typeof duplicate }[] = [
    { label: 'an empty object', evidence: {}, through: duplicate },
    { label: 'null', evidence: null, through: duplicate },
    { label: 'a string', evidence: 'invoicesChecked: 3', through: duplicate },
    { label: 'an array', evidence: [1, 2, 3], through: duplicate },
    { label: 'pairs as a string', evidence: { invoicesChecked: 3, pairs: 'one' }, through: duplicate },
    {
      label: 'pairs holding nulls',
      evidence: { invoicesChecked: 3, pairs: [null, null] },
      through: duplicate,
    },
    {
      label: 'a count that is not a number',
      evidence: { invoicesChecked: 'three', pairs: [] },
      through: duplicate,
    },
    {
      label: 'a pair whose amount is an object',
      evidence: { invoicesChecked: 2, pairs: [{ amount: { value: '10.00' } }] },
      through: duplicate,
    },
    {
      label: 'a spike whose vendor is an object',
      evidence: { windowMonths: 6, spikes: [{ vendorName: {} }] },
      through: spike,
    },
    { label: 'spikes as a number', evidence: { windowMonths: 6, spikes: 7 }, through: spike },
    {
      label: 'a spike with a percentage but no average',
      evidence: { invoicesChecked: 2, windowMonths: 6, spikes: [{ percentOverAverage: '31.4' }] },
      through: spike,
    },
    { label: 'a shortfall with no figures', evidence: { kind: 'below-expected' }, through: shortfall },
    {
      label: 'a shortfall whose amounts are numbers',
      evidence: { kind: 'below-expected', expected: 400, received: 300, shortfall: 100 },
      through: shortfall,
    },
  ]

  it.each(hostile)('renders rather than throwing for $label', ({ evidence, through }) => {
    const row = toFindingRow(through(evidence))

    expect(row.id).toBe('finding-1')
    // UX-DR2 survives whatever the evidence is: the words are always there.
    expect(row.severityLabel).not.toBe('')
    expect(row.title).not.toBe('')
  })

  it.each(hostile)('invents no amount for $label', ({ evidence, through }) => {
    // The failure this whole block guards against is not a crash — it is a
    // plausible-looking row assembled out of nothing. Routed through the reader
    // that actually parses each shape, so the assertion can fail.
    expect(toFindingRow(through(evidence)).amount).toBeNull()
  })

  it.each(hostile)('survives every reader, not only its own, for $label', ({ evidence }) => {
    // A finding could be stored with one type and evidence shaped for another —
    // a detector renamed, a row written by hand. Every combination must render.
    for (const reader of [duplicate, spike, shortfall]) {
      expect(() => toFindingRow(reader(evidence))).not.toThrow()
    }
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
    // The row carries what the surface renders and nothing else. `findingType`
    // and `period` were on it until the acceptance-criteria audit found that
    // nothing read either — plumbing with no consumer, which reads like a
    // feature until someone looks for where it is shown. The port still carries
    // both, because they are the record's identity and story 4.6 links on them.
    const row = toFindingRow(duplicate('nonsense'))

    expect(row).toMatchObject({ id: 'finding-1', raisedOn: '2026-04-14' })
  })
})
