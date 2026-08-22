/**
 * Applying a mapping to a rectangle (story 5.5, AC1 and AC2).
 *
 * **Every fixture cell names the column it came from.** An off-by-one on the
 * 1-based position is the failure that matters here and it is *silent* — shift
 * every column one to the left and the values still look like values, so a
 * fixture of realistic-but-anonymous data would let it through. `date-col`,
 * `desc-col` and so on make the shift visible in the assertion.
 *
 * The load-bearing test is the cross-check: hand the result to `readRows` and
 * assert the records. A rectangle that merely looks right is exactly what a
 * wrong index produces.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { readRows } from '../extraction/tabular'
import { applyMapping, mappedTargets } from './apply'
import { assign, emptyDraft, type DraftMapping } from './draft'
import { targetsForKind, type TargetField } from './targets'

/**
 * A deposit export with five columns, one of which is **an unmapped column
 * headed `amount`** — the collision the whole design exists to avoid.
 *
 *   1 Date   2 Amount   3 Description   4 amount (unmapped)   5 Unit
 */
const SAMPLE: readonly (readonly string[])[] = [
  ['Date', 'Amount', 'Description', 'amount', 'Unit'],
  ['2026-03-01', '1240.00', 'Willow Creek Landscaping', 'IGNORE-ME', '12B'],
  ['2026-03-02', '85.50', 'Metro Water', 'IGNORE-ME-TOO', '4A'],
]

/** Pairs the four real columns, deliberately *not* in target order. */
function depositDraft(): DraftMapping {
  const pairs: readonly (readonly [TargetField, number])[] = [
    ['unit', 5],
    ['amount', 2],
    ['date', 1],
    ['description', 3],
  ]

  return pairs.reduce((draft, [target, position]) => {
    const result = assign(draft, target, position)
    if (!result.ok) throw new Error(`fixture pairing failed: ${result.reason}`)
    return result.draft
  }, emptyDraft('deposit', 5))
}

describe('the fixture is the file it claims to be', () => {
  it('carries an unmapped column that would collide with a mapped target', () => {
    // Position 4 is headed `amount`, and position 2 is mapped to the `amount`
    // target. Without this the collision tests below prove nothing.
    expect(SAMPLE[0]?.[3]).toBe('amount')
    expect(depositDraft().pairings.some((p) => p.target === 'amount' && p.position === 2)).toBe(true)
    expect(depositDraft().pairings.some((p) => p.position === 4)).toBe(false)
  })

  it('pairs its columns out of target order', () => {
    // The ordering test below only bites while this holds: paired *in* target
    // order, an implementation that returned `draft.pairings` order would give
    // the same answer and the test would prove nothing. Nothing else asserts
    // this, so tidying the fixture would silently disarm that test — which is
    // how story 5.4's collision fixture rotted into a comment.
    const { required, optional } = targetsForKind('deposit')
    const inTargetOrder = [...required, ...optional].filter((t) =>
      depositDraft().pairings.some((p) => p.target === t),
    )

    expect(depositDraft().pairings.map((p) => p.target)).not.toEqual(inTargetOrder)
  })
})

describe('the rectangle it produces', () => {
  it('is headed with target names, mapped columns only', () => {
    const [header] = applyMapping(SAMPLE, depositDraft())

    expect(header).toEqual(['date', 'description', 'amount', 'unit'])
  })

  it('orders columns by the importer, not by the order they were paired', () => {
    // The draft pairs unit, amount, date, description — in that order. The
    // output must not follow it, or the preview rearranges itself every time a
    // pairing is redone.
    const { required, optional } = targetsForKind('deposit')
    const expected = [...required, ...optional].filter((t) =>
      depositDraft().pairings.some((p) => p.target === t),
    )

    expect(applyMapping(SAMPLE, depositDraft())[0]).toEqual(expected)
    expect(mappedTargets(depositDraft())).toEqual(expected)
  })

  it('carries each cell from the column it was paired to', () => {
    const [, first] = applyMapping(SAMPLE, depositDraft())

    // date=1, description=3, amount=2, unit=5. A one-to-the-left shift would
    // put the description in `date` and the header text in the first data row.
    expect(first).toEqual(['2026-03-01', 'Willow Creek Landscaping', '1240.00', '12B'])
  })

  it('keeps every data row and drops only the header', () => {
    const applied = applyMapping(SAMPLE, depositDraft())

    expect(applied).toHaveLength(SAMPLE.length)
    expect(applied[2]).toEqual(['2026-03-02', 'Metro Water', '85.50', '4A'])
  })

  it('leaves the unmapped column out entirely', () => {
    const applied = applyMapping(SAMPLE, depositDraft())

    expect(applied.flat()).not.toContain('IGNORE-ME')
    expect(applied[0]).toHaveLength(4)
  })
})

describe('the cross-check: the importer reads it', () => {
  it('parses into the records the sample implies', () => {
    const result = readRows(applyMapping(SAMPLE, depositDraft()), 'deposit')

    expect(result.ok ? [] : result.problems).toEqual([])
    expect(result.ok && result.records).toHaveLength(2)
    expect(result.ok && result.records[0]).toMatchObject({
      documentKind: 'deposit',
      issuedOn: '2026-03-01',
      vendorName: 'Willow Creek Landscaping',
      totalAmount: '1240.00',
      unitReference: '12B',
    })
  })

  it('is not refused for a duplicate heading the treasurer never mapped', () => {
    // The whole point. Renaming in place would leave two `amount` columns and
    // `readRows` would refuse the file.
    const result = readRows(applyMapping(SAMPLE, depositDraft()), 'deposit')

    expect(result.ok ? [] : result.problems.map((p) => p.reason)).not.toContain('duplicate-headers')
  })
})

describe('rectangles that are not the tidy case', () => {
  it('fills an absent cell with an empty string, never undefined', () => {
    // A ragged row: exporters drop trailing empties. `undefined` here reaches
    // the validator stringified as "undefined", which is a non-empty value and
    // parses as a vendor name.
    const ragged: readonly (readonly string[])[] = [
      ['Date', 'Amount', 'Description', 'amount', 'Unit'],
      ['2026-03-01', '1240.00', 'Willow Creek Landscaping'],
    ]

    const [, row] = applyMapping(ragged, depositDraft())

    expect(row).toEqual(['2026-03-01', 'Willow Creek Landscaping', '1240.00', ''])
    expect(row?.every((cell) => typeof cell === 'string')).toBe(true)
  })

  it('fills a cell whose column the rectangle does not have', () => {
    // The draft was built against a five-column sample; these rows have three.
    const narrow: readonly (readonly string[])[] = [
      ['Date', 'Amount', 'Description'],
      ['2026-03-01', '1240.00', 'Willow Creek Landscaping'],
    ]

    const [, row] = applyMapping(narrow, depositDraft())

    expect(row).toEqual(['2026-03-01', 'Willow Creek Landscaping', '1240.00', ''])
  })

  it('returns a header-only rectangle when there are no data rows', () => {
    const headerOnly: readonly (readonly string[])[] = [
      ['Date', 'Amount', 'Description', 'amount', 'Unit'],
    ]

    expect(applyMapping(headerOnly, depositDraft())).toEqual([
      ['date', 'description', 'amount', 'unit'],
    ])
  })

  it('returns nothing at all for an empty rectangle', () => {
    expect(applyMapping([], depositDraft())).toEqual([])
  })

  it('returns a header of nothing for a draft with no pairings', () => {
    const applied = applyMapping(SAMPLE, emptyDraft('deposit', 5))

    expect(applied[0]).toEqual([])
    // Still one entry per input row — dropping rows here would silently shrink
    // the count the preview reports.
    expect(applied).toHaveLength(SAMPLE.length)
  })
})

describe('a roll, which has more required columns', () => {
  it('carries the roll-only targets too', () => {
    const rollSample: readonly (readonly string[])[] = [
      ['Unit', 'Owner', 'From', 'Annual', 'Cycle', 'Year'],
      ['12B', 'A Holder', '2026-01-01', '1200.00', 'monthly', '2026'],
    ]
    const pairs: readonly (readonly [TargetField, number])[] = [
      ['unit', 1],
      ['description', 2],
      ['date', 3],
      ['amount', 4],
      ['cycle', 5],
      ['year', 6],
    ]
    const draft = pairs.reduce((d, [target, position]) => {
      const r = assign(d, target, position)
      if (!r.ok) throw new Error(`fixture pairing failed: ${r.reason}`)
      return r.draft
    }, emptyDraft('assessment_roll', 6))

    const result = readRows(applyMapping(rollSample, draft), 'assessment_roll')

    expect(result.ok ? [] : result.problems).toEqual([])
    expect(result.ok && result.rollRows).toHaveLength(1)
  })
})

describe('nothing is stored', () => {
  it('imports no repository, no store and no ingestion', () => {
    // This block asserted a row count, which the cases above already cover -
    // so it passed whether or not `applyMapping` wrote anything, under a name
    // saying it did not. Raised by CodeRabbit. Replaced with the import scan
    // `preview.test.ts` uses, which can actually fail.
    const source = readFileSync(fileURLToPath(new URL('./apply.ts', import.meta.url)), 'utf8')
    const imported = [
      ...source.matchAll(/(?:^|\n)\s*(?:import|export)\b[\s\S]*?from\s*['"]([^'"]+)['"]/g),
      ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((match) => match[1] ?? '')

    expect(imported.length).toBeGreaterThan(0)
    expect(
      imported.filter((s) => /repository|-postgres|document-store|storage\/|\/ingest$/.test(s)),
    ).toEqual([])
  })
})
