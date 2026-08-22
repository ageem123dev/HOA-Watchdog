// @vitest-environment jsdom

/**
 * What this mapping would produce, on screen (story 5.5, AC3, AC4, AC5, AC6, AC7).
 *
 * **The counts are asserted as rendered text**, not as state. A count that
 * exists in a props object and never reaches the screen satisfies nothing, and
 * UX-DR24 is a rule about what a treasurer is told.
 *
 * The refusal assertions are the other half: `readRows` refuses the whole
 * document if any row is bad, so a refused sample must render **no** parsed
 * values. A screen showing one good row beside one bad one would re-create
 * exactly the misreading the `Preview` union was shaped to prevent.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { assign, emptyDraft, type DraftMapping } from '@/core/mapping/draft'
import type { TargetField } from '@/core/mapping/targets'
import { MappingPreview } from './mapping-preview'

afterEach(cleanup)

function draftOf(
  kind: 'deposit' | 'assessment_roll',
  columns: number,
  pairs: readonly (readonly [TargetField, number])[],
): DraftMapping {
  return pairs.reduce((draft, [target, position]) => {
    const result = assign(draft, target, position)
    if (!result.ok) throw new Error(`fixture pairing failed: ${result.reason}`)
    return result.draft
  }, emptyDraft(kind, columns))
}

const COMPLETE = () =>
  draftOf('deposit', 4, [
    ['date', 1],
    ['description', 2],
    ['amount', 3],
    ['unit', 4],
  ])

const CLEAN: readonly (readonly string[])[] = [
  ['Date', 'Who', 'How much', 'Unit'],
  ['2026-03-01', 'Willow Creek Landscaping', '1240.00', '12B'],
  ['2026-03-02', 'Metro Water', '85.50', '4A'],
]

const ONE_BAD: readonly (readonly string[])[] = [
  ['Date', 'Who', 'How much', 'Unit'],
  ['2026-03-01', 'Willow Creek Landscaping', '1240.00', '12B'],
  ['2026-03-02', 'Metro Water', 'not-an-amount', '4A'],
]

const text = () => document.body.textContent ?? ''

describe('a mapping the importer would accept', () => {
  it('shows what each row becomes, value by value', () => {
    render(<MappingPreview draft={COMPLETE()} rows={CLEAN} totalDataRows={2} />)

    // Not a tick and not a count. "Is my date column the right date column" is
    // only answerable from the values themselves.
    expect(text()).toContain('2026-03-01')
    expect(text()).toContain('Willow Creek Landscaping')
    expect(text()).toContain('1240.00')
    expect(text()).toContain('12B')
    expect(text()).toContain('85.50')
  })

  it('labels the columns as the importer’s fields, not as the file’s headings', () => {
    render(<MappingPreview draft={COMPLETE()} rows={CLEAN} totalDataRows={2} />)

    // The file's heading is "How much"; what it feeds is Amount.
    expect(text()).toContain('Amount')
    expect(text()).not.toContain('How much')
  })
})

describe('the counts UX-DR24 requires', () => {
  it('says how many rows were read and how many the file holds', () => {
    render(<MappingPreview draft={COMPLETE()} rows={CLEAN} totalDataRows={143} />)

    // Both numbers. "2 rows read" alone is a claim about the sample dressed as
    // a claim about the file.
    expect(text()).toContain('2')
    expect(text()).toMatch(/143/)
    expect(text()).toMatch(/\b2\b[\s\S]*\b143\b/)
  })

  it('does not reassure without them', () => {
    render(<MappingPreview draft={COMPLETE()} rows={CLEAN} totalDataRows={143} />)

    const body = text()
    const claimsSuccess = /would import|will import|looks right/i.test(body)

    // If it makes a claim at all, the counts must be beside it.
    expect(claimsSuccess && /143/.test(body)).toBe(claimsSuccess)
  })

  it('reports the counts on a refusal too', () => {
    render(<MappingPreview draft={COMPLETE()} rows={ONE_BAD} totalDataRows={143} />)

    // Taken from the records, this would read 0 and tell the treasurer nothing
    // was read when two rows were read and found wanting.
    expect(text()).toMatch(/\b2\b[\s\S]*\b143\b/)
  })
})

describe('a mapping the importer would refuse', () => {
  it('says the file would be refused, in its own voice', () => {
    render(<MappingPreview draft={COMPLETE()} rows={ONE_BAD} totalDataRows={2} />)

    expect(screen.getByRole('alert').textContent ?? '').toMatch(/refuse/i)
  })

  it('names the offending row by number', () => {
    render(<MappingPreview draft={COMPLETE()} rows={ONE_BAD} totalDataRows={2} />)

    // Row 2 of the data rows. Without the number there is nothing to act on.
    expect(text()).toMatch(/row 2/i)
  })

  it('shows no parsed values beside the refusal', () => {
    render(<MappingPreview draft={COMPLETE()} rows={ONE_BAD} totalDataRows={2} />)

    // The whole point of the union. One bad row fails the document, so there is
    // no "17 imported" to show — and showing the good row would tell the
    // treasurer the bulk of their data is fine.
    expect(text()).not.toContain('Willow Creek Landscaping')
    expect(text()).not.toContain('1240.00')
  })
})

describe('a mapping that is not finished', () => {
  it('previews nothing and names every required field still missing', () => {
    const partial = draftOf('deposit', 4, [['date', 1]])

    render(<MappingPreview draft={partial} rows={CLEAN} totalDataRows={2} />)

    expect(text()).toContain('Amount')
    expect(text()).toContain('Description')
    // And no rows, because there is nothing to show yet.
    expect(text()).not.toContain('Willow Creek Landscaping')
  })
})

describe('the preview follows the mapping', () => {
  it('describes the mapping it is given, not the one it was given first', () => {
    const { rerender } = render(
      <MappingPreview draft={COMPLETE()} rows={CLEAN} totalDataRows={2} />,
    )

    expect(text()).toContain('Willow Creek Landscaping')

    // Amount now reads the unit column — a mapping a treasurer might well try.
    const moved = draftOf('deposit', 4, [
      ['date', 1],
      ['description', 2],
      ['amount', 4],
    ])

    rerender(<MappingPreview draft={moved} rows={CLEAN} totalDataRows={2} />)

    // `12B` is not an amount, so this mapping would be refused. A stale preview
    // would still be showing the previous success.
    expect(screen.getByRole('alert').textContent ?? '').toMatch(/refuse/i)
  })
})
