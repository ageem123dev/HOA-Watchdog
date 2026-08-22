/**
 * What this mapping would produce (story 5.5, AC1, AC3, AC4, AC5, AC8).
 *
 * **The assertion this file exists for is the exclusivity one.** `readRows`
 * refuses the whole document if any row is bad — one bad row fails it — so a
 * preview must never show records *and* problems together. A screen reading
 * "17 imported, 3 refused" would misstate the outcome in the direction that
 * costs most: the treasurer concludes the bulk of the data is fine.
 *
 * The cross-check is `duplicate-unit`. It is a reason only `readRows`' own rules
 * produce, so a preview that quietly grew its own parser could not invent it.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { previewMapping } from './preview'
import { assign, completeness, emptyDraft, type DraftMapping } from './draft'
import type { TargetField } from './targets'

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

const DEPOSIT = () =>
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

describe('a sample the importer would accept', () => {
  it('reports what each row becomes', () => {
    const preview = previewMapping(CLEAN, DEPOSIT(), 2)

    expect(preview.status).toBe('would-import')
    if (preview.status !== 'would-import') return

    // Field by field. "2 rows are fine" would not tell a treasurer whether
    // their date column is the right date column, which is the whole point.
    expect(preview.records).toHaveLength(2)
    expect(preview.records[0]).toMatchObject({
      documentKind: 'deposit',
      issuedOn: '2026-03-01',
      vendorName: 'Willow Creek Landscaping',
      totalAmount: '1240.00',
      unitReference: '12B',
    })
    expect(preview.records[1]).toMatchObject({ issuedOn: '2026-03-02', totalAmount: '85.50' })
  })

  it('counts the rows read and the rows the file holds', () => {
    const preview = previewMapping(CLEAN, DEPOSIT(), 143)

    expect(preview.status === 'would-import' && preview.counts).toEqual({ read: 2, total: 143 })
  })
})

describe('a sample the importer would refuse', () => {
  // Row 2's amount is not an amount. One bad row fails the document.
  const ONE_BAD: readonly (readonly string[])[] = [
    ['Date', 'Who', 'How much', 'Unit'],
    ['2026-03-01', 'Willow Creek Landscaping', '1240.00', '12B'],
    ['2026-03-02', 'Metro Water', 'not-an-amount', '4A'],
  ]

  it('says the file would be refused, and carries no records', () => {
    const preview = previewMapping(ONE_BAD, DEPOSIT(), 2)

    expect(preview.status).toBe('would-refuse')
    // The exclusivity that matters: no `records` field exists on this branch,
    // so a screen cannot show one good row beside one bad one.
    expect(preview).not.toHaveProperty('records')
  })

  it('names every offending row, not the first', () => {
    const TWO_BAD: readonly (readonly string[])[] = [
      ['Date', 'Who', 'How much', 'Unit'],
      ['2026-03-01', 'Willow Creek Landscaping', 'not-an-amount', '12B'],
      ['2026-03-02', 'Metro Water', 'also-not-an-amount', '4A'],
    ]

    const preview = previewMapping(TWO_BAD, DEPOSIT(), 2)

    expect(preview.status).toBe('would-refuse')
    if (preview.status !== 'would-refuse') return

    const rows = preview.problems.flatMap((p) => ('row' in p ? [p.row] : []))

    expect(rows).toEqual([1, 2])
  })

  it('still reports how many rows were read', () => {
    // Taken from the records length this reads 0, and the treasurer is told
    // nothing was read when in fact two rows were read and found wanting.
    const preview = previewMapping(ONE_BAD, DEPOSIT(), 143)

    expect(preview.status === 'would-refuse' && preview.counts).toEqual({ read: 2, total: 143 })
  })
})

describe('the cross-check: it is the importer doing the parsing', () => {
  it('surfaces `duplicate-unit`, a refusal only readRows produces', () => {
    const roll = draftOf('assessment_roll', 6, [
      ['unit', 1],
      ['description', 2],
      ['date', 3],
      ['amount', 4],
      ['cycle', 5],
      ['year', 6],
    ])
    const sameUnitTwice: readonly (readonly string[])[] = [
      ['Unit', 'Owner', 'From', 'Annual', 'Cycle', 'Year'],
      ['12B', 'A Holder', '2026-01-01', '1200.00', 'monthly', '2026'],
      ['12B', 'A Holder', '2026-01-01', '1200.00', 'monthly', '2026'],
    ]

    const preview = previewMapping(sameUnitTwice, roll, 2)

    expect(preview.status).toBe('would-refuse')
    if (preview.status !== 'would-refuse') return
    // A second parser written here would have no notion of this rule.
    expect(preview.problems.map((p) => p.reason)).toContain('duplicate-unit')
  })

  it('reads a roll as a roll, producing roll rows', () => {
    const roll = draftOf('assessment_roll', 6, [
      ['unit', 1],
      ['description', 2],
      ['date', 3],
      ['amount', 4],
      ['cycle', 5],
      ['year', 6],
    ])
    const rollSample: readonly (readonly string[])[] = [
      ['Unit', 'Owner', 'From', 'Annual', 'Cycle', 'Year'],
      ['12B', 'A Holder', '2026-01-01', '1200.00', 'monthly', '2026'],
    ]

    const preview = previewMapping(rollSample, roll, 1)

    expect(preview.status).toBe('would-import')
    // The kind comes from the draft. Previewed as a deposit, the roll rows
    // vanish and the treasurer is shown an import that creates no units.
    expect(preview.status === 'would-import' && preview.rollRows).toHaveLength(1)
    // And the records too: `readRows` populates BOTH for a roll. Argus read
    // this the other way round when it flagged the preview table, so it is
    // pinned here rather than left to be re-derived.
    expect(preview.status === 'would-import' && preview.records).toHaveLength(1)
  })

  it('ignores the unmapped columns rather than colliding with them', () => {
    // The collision Task 1 exists for, reaching this layer.
    const withCollision: readonly (readonly string[])[] = [
      ['Date', 'Who', 'How much', 'Unit', 'amount'],
      ['2026-03-01', 'Willow Creek Landscaping', '1240.00', '12B', 'IGNORE-ME'],
    ]

    const preview = previewMapping(withCollision, DEPOSIT(), 1)

    expect(preview.status).toBe('would-import')
  })
})

describe('an incomplete mapping', () => {
  it('previews nothing and names every required target still missing', () => {
    // Only `date` paired. Previewed anyway, `readRows` refuses with
    // `missing-headers` and the treasurer is shown a parse error instead of
    // "you still need to map Amount and Description".
    const partial = draftOf('deposit', 4, [['date', 1]])

    const preview = previewMapping(CLEAN, partial, 2)

    expect(preview.status).toBe('incomplete')
    if (preview.status !== 'incomplete') return
    expect([...preview.missing].sort()).toEqual(['amount', 'description'])
  })

  it('agrees with `completeness` rather than deciding again', () => {
    // The cross-check against 5.4's owner of this question. A second opinion
    // here is the two-lists defect one layer out.
    const partial = draftOf('deposit', 4, [
      ['date', 1],
      ['description', 2],
    ])

    const preview = previewMapping(CLEAN, partial, 2)
    const { missing } = completeness(partial)

    expect(preview.status === 'incomplete' && [...preview.missing].sort()).toEqual(
      [...missing].sort(),
    )
  })

  it('previews a draft that has every required target but no optional ones', () => {
    // The inverse: optional targets left unpaired must not read as incomplete,
    // or a deposit mapping could never be finished.
    const requiredOnly = draftOf('deposit', 4, [
      ['date', 1],
      ['description', 2],
      ['amount', 3],
    ])

    expect(previewMapping(CLEAN, requiredOnly, 2).status).toBe('would-import')
  })

  it('previews nothing for a draft with no pairings at all', () => {
    expect(previewMapping(CLEAN, emptyDraft('deposit', 4), 2).status).toBe('incomplete')
  })
})

describe('nothing is stored', () => {
  it('imports no repository, no store and no ingestion', () => {
    const source = readFileSync(fileURLToPath(new URL('./preview.ts', import.meta.url)), 'utf8')
    const imported = [
      ...source.matchAll(/(?:^|\n)\s*(?:import|export)\b[\s\S]*?from\s*['"]([^'"]+)['"]/g),
      ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((match) => match[1] ?? '')

    expect(imported.length).toBeGreaterThan(0)
    expect(
      imported.filter((s) => /repository|-postgres|document-store|storage\/|\/ingest$/.test(s)),
    ).toEqual([])
  })

  it('previews given rows, a draft and a count, and nothing else', () => {
    expect(previewMapping(CLEAN, DEPOSIT(), 2).status).toBe('would-import')
  })
})
