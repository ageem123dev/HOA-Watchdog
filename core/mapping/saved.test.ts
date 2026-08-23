/**
 * What a remembered mapping is, and how it is found again (story 5.7, Task 2).
 *
 * ## The key is the whole design
 *
 * A treasurer maps their export once. The next export of the same shape has to
 * find that mapping — so "the same shape" needs a definition that agrees with
 * what the importer already thinks a heading is. `normaliseHeading` is imported
 * for that, never re-derived: story 5.3 spent a review round on a duplicated
 * copy of exactly that folding, story 5.6 Task 1 re-proved that a fork passes
 * every behavioural assertion, and 5.6b's residue needed the same pair of
 * checks. This is the fifth time, so it gets both halves from the start.
 *
 * ## What is deliberately not here
 *
 * Nothing writes a derived row. AD-13's "exactly one component owns creation of
 * each derived entity" is Task 4's constraint, and it is the one most likely to
 * be got wrong — but a mapping is not a derived entity, and pretending this task
 * engages that rule would blur where the real risk sits.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { normaliseHeading } from '../extraction/headings'
import type { Heading } from '../extraction/headings'
import { neutralise } from '../ports/declared-members'
import { applyMapping } from './apply'
import type { DraftMapping } from './draft'
import { shapeKey, type SavedMapping } from './saved'

const headingsOf = (...texts: readonly string[]): readonly Heading[] =>
  texts.map((text, index) => ({
    position: index + 1,
    text,
    normalised: normaliseHeading(text),
  }))

const DEPOSIT: DraftMapping = {
  kind: 'deposit',
  columns: 3,
  pairings: [
    { target: 'date', position: 1 },
    { target: 'description', position: 2 },
    { target: 'amount', position: 3 },
  ],
}

describe('the same export finds the same mapping', () => {
  it('gives one key to headings the importer considers identical', () => {
    // Case and surrounding space are what `normaliseHeading` already folds, so
    // two exports differing only in those are one shape to the importer — and
    // must be one shape here, or the treasurer maps the same file twice.
    expect(shapeKey('deposit', headingsOf('Date', 'Description', 'Amount'))).toBe(
      shapeKey('deposit', headingsOf('  date  ', 'DESCRIPTION', 'Amount')),
    )
  })

  it('gives different keys to different headings', () => {
    expect(shapeKey('deposit', headingsOf('Date', 'Description', 'Amount'))).not.toBe(
      shapeKey('deposit', headingsOf('Date', 'Memo', 'Amount')),
    )
  })

  it('treats a reordered export as a different shape', () => {
    /**
     * 2b, and it is the one that would corrupt data rather than annoy anyone. A
     * mapping stores *positions*. Reuse it against a file whose columns moved
     * and every pairing points at the wrong column — dates read as amounts,
     * silently. Order is part of the key precisely so that cannot happen.
     */
    expect(shapeKey('deposit', headingsOf('Date', 'Description', 'Amount'))).not.toBe(
      shapeKey('deposit', headingsOf('Description', 'Date', 'Amount')),
    )
  })

  it('treats a different column count as a different shape', () => {
    expect(shapeKey('deposit', headingsOf('Date', 'Description', 'Amount'))).not.toBe(
      shapeKey('deposit', headingsOf('Date', 'Description', 'Amount', 'Balance')),
    )
  })

  it('does not collapse a repeated heading into one', () => {
    /**
     * Story 5.3 reports duplicate headings rather than refusing the file, so an
     * export with two `Amount` columns is a real input. Deduplicating them here
     * would make it key identically to the same export with one — two shapes
     * with different column counts sharing a mapping, whose `columns` is then
     * wrong and whose positions point past the end.
     *
     * Every other "different shape" case here uses distinct headings, so none of
     * them can see this; a `new Set` in the key passes all of them.
     */
    expect(shapeKey('deposit', headingsOf('Amount', 'Description', 'Amount'))).not.toBe(
      shapeKey('deposit', headingsOf('Amount', 'Description')),
    )
  })

  it('treats the same headings under a different kind as a different shape', () => {
    // 2d. A deposit export must not import under a roll's column meanings.
    expect(shapeKey('deposit', headingsOf('Date', 'Description', 'Amount'))).not.toBe(
      shapeKey('assessment_roll', headingsOf('Date', 'Description', 'Amount')),
    )
  })

  it.each([
    ['a blank heading', ['Date', '', 'Amount']],
    ['a duplicate heading', ['Amount', 'Description', 'Amount']],
  ])('is stable across two uploads of an export with %s', (_label, texts) => {
    // Story 5.3 reports blanks and duplicates rather than refusing the file, so
    // both reach here. The same file uploaded twice must key the same way.
    const key = shapeKey('deposit', headingsOf(...texts))

    expect(shapeKey('deposit', headingsOf(...texts))).toBe(key)
    expect(key.length).toBeGreaterThan(0)
  })
})

describe('it folds headings the way the importer does', () => {
  it('agrees with the shared folding wherever the two overlap', () => {
    // The behavioural half. A key built from `normaliseHeading` must change
    // exactly when that folding's answer changes.
    const same = shapeKey('deposit', headingsOf('Amount'))

    expect(shapeKey('deposit', headingsOf(normaliseHeading('  AMOUNT  ')))).toBe(same)
  })

  it('uses the shared folding rather than a copy of it', () => {
    /**
     * The structural half, and it is needed because parity cannot see this one.
     * A fork written as `text.trim().toLowerCase()` behaves identically today —
     * story 5.6 Task 1 verified that a fork passes *every* behavioural
     * assertion, and story 5.3 landed on this same pair: "neither alone is
     * sufficient".
     *
     * Comments blanked, because the doc comment above `shapeKey` necessarily
     * discusses the folding. Story 5.6 tripped over that three times.
     */
    const source = readFileSync(fileURLToPath(new URL('./saved.ts', import.meta.url)), 'utf8')
    const code = neutralise(source).commentsBlanked

    expect(code).toContain('normaliseHeading(')
    expect(code).not.toContain('toLowerCase')
    expect(code).toContain("import { normaliseHeading } from '../extraction/headings'")
    // The blanker must not be what makes this pass.
    expect(code).toContain('export function shapeKey')
  })
})

describe('the round trip, which is what the mapping is for', () => {
  it('reads back as a mapping applyMapping accepts', () => {
    /**
     * The cross-check. Storing the fields is not the point; producing the same
     * records on the next upload is. A stored `columns` that disagreed with the
     * heading row would make `assign`'s bounds check refuse every pairing on
     * reuse — 2e — and this is what would catch it.
     */
    const headings = headingsOf('Date', 'Description', 'Amount')
    const saved: SavedMapping = {
      associationId: 'association-1',
      kind: 'deposit',
      shape: shapeKey('deposit', headings),
      mapping: DEPOSIT,
    }

    const rows = [
      ['Date', 'Description', 'Amount'],
      ['2026-03-01', 'Willow Creek Landscaping', '1240.00'],
    ]

    const [header, first] = applyMapping(rows, saved.mapping)

    // A rectangle, not records: `applyMapping` hands the importer's own header
    // row and the cells beneath it, and `readRows` turns that into records.
    expect(header).toEqual(['date', 'description', 'amount'])
    expect(first).toEqual(['2026-03-01', 'Willow Creek Landscaping', '1240.00'])
  })

  it('carries the column count the mapping was built against', () => {
    const headings = headingsOf('Date', 'Description', 'Amount')
    const saved: SavedMapping = {
      associationId: 'association-1',
      kind: 'deposit',
      shape: shapeKey('deposit', headings),
      mapping: DEPOSIT,
    }

    expect(saved.mapping.columns).toBe(headings.length)
  })
})
