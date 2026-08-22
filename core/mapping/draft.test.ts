/**
 * The draft mapping (story 5.4, AC2, AC3, AC4, AC9).
 *
 * The assertions that carry this file are the ones about *position*: a fixture
 * with two columns both called `amount` and one with no heading at all, which a
 * text-keyed mapping cannot express. Every other test here would pass against a
 * mapping keyed on heading text.
 */

import { describe, expect, it } from 'vitest'

import { readHeadings } from '../extraction/headings'
import { readRows } from '../extraction/tabular'
import { assign, completeness, emptyDraft, unassign } from './draft'
import { SAMPLE_CELLS } from './sample-cells'
import { targetsForKind, type TargetField } from './targets'

/**
 * A deposit export whose headings collide, which is the case story 5.3 exists
 * to report rather than refuse.
 *
 *   1 Date   2 Amount   3 (blank)   4 amount   5 Unit
 *
 * **Real headings, read by `readHeadings`, not a count and a comment.** The
 * first draft of this file declared `COLLIDING_COLUMNS = 5` and described the
 * layout in prose — and a fixture mutation from 5 to 10 left all 29 tests green,
 * because every boundary case was derived from the constant and no test ever
 * saw a heading. The tests named for duplicate and blank headings were pairing
 * bare positions; the collision was imaginary.
 */
const SAMPLE: readonly (readonly string[])[] = [
  ['Date', 'Amount', '  ', 'amount', 'Unit'],
  ['2026-03-01', '1240.00', 'Willow Creek Landscaping', '99.00', '12B'],
]

const HEADINGS = readHeadings(SAMPLE)

if (!HEADINGS.ok) throw new Error(`fixture is unreadable: ${HEADINGS.reason}`)

const COLLIDING_COLUMNS = HEADINGS.headings.length

describe('the fixture is the file it claims to be', () => {
  // Asserted, because everything below leans on it. Without this block the
  // suite passes just as well against five distinct, well-named columns — and
  // then proves nothing about the case the story is for.
  it('has two columns the importer would read as the same heading', () => {
    const at = (position: number) =>
      HEADINGS.headings.find((heading) => heading.position === position)

    expect(at(2)?.normalised).toBe(at(4)?.normalised)
    expect(at(2)?.text).not.toBe(at(4)?.text)
    expect(HEADINGS.problems).toContainEqual({
      reason: 'duplicate-heading',
      heading: 'amount',
      positions: [2, 4],
    })
  })

  it('has a column with no heading at all', () => {
    expect(HEADINGS.problems).toContainEqual({ reason: 'blank-heading', positions: [3] })
  })

  it('has exactly five columns', () => {
    // The number the boundary cases below are measured against. Derived from the
    // rectangle rather than declared beside it, so the two cannot drift.
    expect(COLLIDING_COLUMNS).toBe(5)
  })
})

const deposit = () => emptyDraft('deposit', COLLIDING_COLUMNS)

/** Asserts an assign succeeded and hands back the new draft. */
const assigned = (draft: ReturnType<typeof deposit>, target: TargetField, position: number) => {
  const result = assign(draft, target, position)

  if (!result.ok) throw new Error(`expected assign to succeed, got ${result.reason}`)
  return result.draft
}

const positionOf = (draft: { pairings: readonly { target: string; position: number }[] }, target: string) =>
  draft.pairings.find((pairing) => pairing.target === target)?.position

describe('a pairing names a position, not a heading', () => {
  it('keeps two identically-named columns apart', () => {
    // The load-bearing test. Positions 2 and 4 are both `amount` in the file;
    // a mapping keyed on the heading text cannot say which one was chosen.
    const draft = assigned(assigned(deposit(), 'amount', 2), 'reference', 4)

    expect(positionOf(draft, 'amount')).toBe(2)
    expect(positionOf(draft, 'reference')).toBe(4)
  })

  it('maps a column whose heading is blank', () => {
    // Position 3 has no name at all. It is a column a treasurer can see and
    // must be able to use; a text-keyed mapping has nothing to key on.
    expect(positionOf(assigned(deposit(), 'description', 3), 'description')).toBe(3)
  })
})

describe('a column belongs to one target', () => {
  it('refuses a column another target already holds, and names that target', () => {
    const draft = assigned(deposit(), 'amount', 2)

    const result = assign(draft, 'reference', 2)

    expect(result).toEqual({ ok: false, reason: 'source-already-paired', heldBy: 'amount', position: 2 })
  })

  it('leaves the existing pairing alone when it refuses', () => {
    // Refusing and *also* moving it would be the worst of both.
    const draft = assigned(deposit(), 'amount', 2)

    assign(draft, 'reference', 2)

    expect(positionOf(draft, 'amount')).toBe(2)
    expect(draft.pairings).toHaveLength(1)
  })

  it('re-pairing a target replaces its column rather than adding a second', () => {
    const draft = assigned(assigned(deposit(), 'amount', 2), 'amount', 4)

    expect(draft.pairings.filter((pairing) => pairing.target === 'amount')).toHaveLength(1)
    expect(positionOf(draft, 'amount')).toBe(4)
  })

  it('frees the column a re-paired target used to hold', () => {
    const draft = assigned(assigned(deposit(), 'amount', 2), 'amount', 4)

    // Position 2 is nobody's now. If re-pairing left it claimed, it could never
    // be used again and nothing on screen would say why.
    expect(assign(draft, 'reference', 2).ok).toBe(true)
  })
})

describe('a position the file does not have', () => {
  it.each([0, -1, COLLIDING_COLUMNS + 1, 1.5])('is refused (%s)', (position) => {
    expect(assign(deposit(), 'amount', position)).toEqual({
      ok: false,
      reason: 'no-such-column',
      position,
    })
  })

  it.each([1, COLLIDING_COLUMNS])('accepts the first and last real column (%s)', (position) => {
    // The inverse, in the same block: without it the refusals above would pass
    // against an implementation that refuses everything.
    expect(assign(deposit(), 'amount', position).ok).toBe(true)
  })
})

describe('a target this kind does not have', () => {
  it('is refused rather than paired', () => {
    // `cycle` belongs to an assessment roll. Task 1 does not offer it for a
    // deposit, and this is the second lock: offered or not, it cannot be paired.
    expect(assign(deposit(), 'cycle' as TargetField, 1)).toEqual({
      ok: false,
      reason: 'not-a-target',
      target: 'cycle',
    })
  })

  it('refuses the retired `type` column', () => {
    // Through `unknown`: `type` is not a `TargetField` and never was, so a
    // direct cast is one TypeScript would be right to refuse if it tightened.
    expect(assign(deposit(), 'type' as unknown as TargetField, 1)).toEqual({
      ok: false,
      reason: 'not-a-target',
      target: 'type',
    })
  })

  it('refuses `unit` on a kind the importer reads no unit for', () => {
    const invoice = emptyDraft('invoice', COLLIDING_COLUMNS)

    expect(assign(invoice, 'unit', 1)).toEqual({ ok: false, reason: 'not-a-target', target: 'unit' })
  })
})

describe('the draft is a value, not a thing that is edited', () => {
  it('leaves the draft it was given untouched', () => {
    const before = deposit()

    assign(before, 'amount', 2)

    // Mutated in place, React renders the old value and nothing can be undone.
    expect(before.pairings).toEqual([])
  })

  it('leaves the draft untouched when unassigning', () => {
    const before = assigned(deposit(), 'amount', 2)

    unassign(before, 'amount')

    expect(before.pairings).toHaveLength(1)
  })
})

describe('unassign', () => {
  it('removes the named target and leaves its siblings', () => {
    const draft = assigned(assigned(deposit(), 'amount', 2), 'date', 1)

    const after = unassign(draft, 'amount')

    expect(positionOf(after, 'amount')).toBeUndefined()
    expect(positionOf(after, 'date')).toBe(1)
  })

  it('is a no-op for a target that holds nothing', () => {
    // A second key-press should not break the screen.
    const draft = assigned(deposit(), 'amount', 2)

    expect(unassign(draft, 'reference').pairings).toEqual(draft.pairings)
  })

  it('reverses an assign exactly', () => {
    const before = deposit()

    expect(unassign(assigned(before, 'amount', 2), 'amount')).toEqual(before)
  })

  it('frees the column, so it can be paired to something else', () => {
    const draft = unassign(assigned(deposit(), 'amount', 2), 'amount')

    expect(assign(draft, 'reference', 2).ok).toBe(true)
  })
})

describe('what is still missing', () => {
  it('reports every unfilled required target at once, not the first', () => {
    const draft = assigned(deposit(), 'date', 1)

    const { complete, missing } = completeness(draft)

    expect(complete).toBe(false)
    expect([...missing].sort()).toEqual(['amount', 'description'])
  })

  it('does not count optional targets as missing', () => {
    // `reference` and `unit` are optional for a deposit. Counted as missing, a
    // mapping could never be completed.
    const draft = assigned(assigned(assigned(deposit(), 'date', 1), 'description', 3), 'amount', 2)

    expect(completeness(draft)).toEqual({ complete: true, missing: [] })
  })

  it('reports every required target of an empty draft', () => {
    const { required } = targetsForKind('assessment_roll')
    const { missing } = completeness(emptyDraft('assessment_roll', 8))

    // Zero-one-many, and it also asserts `missing` is non-empty — an empty list
    // would satisfy "does not count optional targets" on its own.
    expect([...missing].sort()).toEqual([...required].sort())
  })

  it('is not complete while one required target remains', () => {
    const { required } = targetsForKind('assessment_roll')
    const roll = emptyDraft('assessment_roll', 8)

    // Every required target but the last, each to its own column.
    const draft = required
      .slice(0, -1)
      .reduce((current, target, index) => assigned(current, target, index + 1), roll)

    expect(completeness(draft).complete).toBe(false)
    expect(completeness(draft).missing).toEqual([required[required.length - 1]])
  })
})

describe('a complete mapping is one the importer can read', () => {
  it.each(['deposit', 'assessment_roll', 'invoice'] as const)(
    'lays out a header row readRows accepts (%s)',
    (kind) => {
      const { required } = targetsForKind(kind)
      const draft = required.reduce(
        (current, target, index) => assigned(current, target, index + 1),
        emptyDraft(kind, required.length),
      )

      expect(completeness(draft).complete).toBe(true)

      // The cross-check: place each target's name at the column it was paired
      // to, and the importer must accept the result. This is the property the
      // whole wizard exists to produce, verified independently of both modules.
      const header: string[] = Array.from({ length: draft.columns }, () => '')
      const cells: string[] = Array.from({ length: draft.columns }, () => '')

      for (const pairing of draft.pairings) {
        header[pairing.position - 1] = pairing.target
        cells[pairing.position - 1] = SAMPLE_CELLS[pairing.target]
      }

      expect(readRows([header, cells], kind).ok).toBe(true)
    },
  )
})

describe('nothing is stored', () => {
  it('builds a whole mapping given a kind and a column count and nothing else', () => {
    // AC9. Not `Function.length` — story 5.3 shipped that assertion and it
    // counts parameters before the first default, so it stayed at 1 whatever was
    // added after. The observable property is that the call succeeds with no
    // dependency in sight.
    const draft = assigned(assigned(assigned(emptyDraft('deposit', 3), 'date', 1), 'description', 2), 'amount', 3)

    expect(completeness(draft).complete).toBe(true)
  })
})
