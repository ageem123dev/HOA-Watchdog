/**
 * Whether a deposit line becomes a payment or waits for a human.
 *
 * AC2 is the whole content of this file: *nothing is attributed to a unit on a
 * guess*. The decision is deliberately dull — an exact match on the folded
 * reference, or hold — and the tests exist to keep it that way. Every "helpful"
 * variant a future reader might reach for (nearest match, only-one-candidate,
 * prefix match) is a way of attributing money to the wrong person, and an
 * arrears finding against the wrong person is the failure this product cannot
 * have.
 *
 * Pure: the lookup is a parameter, not a database. No I/O, no clock.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveLine, type DepositLine } from './resolve-line'

const line = (over: Partial<DepositLine> = {}): DepositLine => ({
  unitReference: '4B',
  paidOn: '2024-03-01',
  amount: '120.00',
  ...over,
})

/** A directory that knows exactly the folded references it was given. */
const knowing = (known: Record<string, string>) => (folded: string) => known[folded] ?? null

describe('resolveLine', () => {
  it('attributes a line whose reference is known', () => {
    const resolved = resolveLine(line({ unitReference: '4B' }), knowing({ '4b': 'unit-1' }))

    expect(resolved).toEqual({
      kind: 'attributed',
      unitId: 'unit-1',
      paidOn: '2024-03-01',
      amount: '120.00',
    })
  })

  it('attributes a line spelled differently from the roll', () => {
    // The folding migration 011 defines: case and whitespace, nothing else.
    // `4b  ` off a bank export is the same property as `4B` on the roll.
    const resolved = resolveLine(line({ unitReference: '  4b  ' }), knowing({ '4b': 'unit-1' }))

    expect(resolved).toMatchObject({ kind: 'attributed', unitId: 'unit-1' })
  })

  it('holds a line whose reference is not known', () => {
    const resolved = resolveLine(line({ unitReference: '9Z' }), knowing({ '4b': 'unit-1' }))

    expect(resolved).toEqual({
      kind: 'held',
      unitReference: '9Z',
      paidOn: '2024-03-01',
      amount: '120.00',
      reason: 'unknown-unit',
    })
  })

  it('holds rather than guessing when only one unit exists', () => {
    // The most tempting wrong answer, and the reason this test is here rather
    // than the logic being "obvious". A single-unit association makes
    // "there is only one candidate, so it must be that one" look reasonable.
    // It is a guess, and AC2 forbids it.
    const resolved = resolveLine(line({ unitReference: 'whatever' }), knowing({ '4b': 'unit-1' }))

    expect(resolved).toMatchObject({ kind: 'held' })
  })

  it('holds rather than matching a reference that merely starts the same', () => {
    // `4` is not `4B`, and `4B` is not `4B-2`. Prefix matching would attribute a
    // payment to a neighbour.
    const known = knowing({ '4b': 'unit-1' })

    expect(resolveLine(line({ unitReference: '4' }), known)).toMatchObject({ kind: 'held' })
    expect(resolveLine(line({ unitReference: '4B-2' }), known)).toMatchObject({ kind: 'held' })
  })

  it('holds a reference differing only by a leading zero', () => {
    // Migration 011 records this as an explicit out-of-scope decision: `04B` and
    // `4B` are two units, because zero-padding is a real convention and deciding
    // it means nothing is a data decision rather than a schema one. Folding them
    // here would quietly overturn that.
    const resolved = resolveLine(line({ unitReference: '04B' }), knowing({ '4b': 'unit-1' }))

    expect(resolved).toMatchObject({ kind: 'held' })
  })

  it.each([
    ['no reference at all', { unitReference: '' }, 'missing-reference'],
    ['a reference of only whitespace', { unitReference: '   ' }, 'missing-reference'],
    ['no amount', { amount: '' }, 'missing-amount'],
    ['no date', { paidOn: '' }, 'missing-date'],
  ])('holds a line with %s rather than dropping it', (_label, over, reason) => {
    // A payment the system silently forgot is worse than one waiting for a
    // human: the money is in the bank either way, and only one of those states
    // is visible to a treasurer.
    const resolved = resolveLine(line(over), knowing({ '4b': 'unit-1' }))

    expect(resolved).toMatchObject({ kind: 'held', reason })
  })

  it('never consults the directory for a line it cannot fold', () => {
    // A blank reference folds to nothing, and asking the directory about nothing
    // invites a lookup that returns the wrong thing for an empty key.
    let asked = 0
    const counting = (folded: string) => {
      asked += 1
      return folded === '4b' ? 'unit-1' : null
    }

    resolveLine(line({ unitReference: '   ' }), counting)

    expect(asked).toBe(0)
  })

  it.each(['__proto__', 'constructor'])(
    'holds a reference of %s rather than resolving it to an inherited property',
    (reference) => {
      // Story 1.6d shipped this: `suggestions[key] ?? []` returned
      // Object.prototype members for a name that folded to `constructor`. A
      // directory implemented as a plain object answers these with a function or
      // an object, and `?? null` does not catch either.
      //
      // `toString` was in this list and has been removed: folding lower-cases
      // the reference, so it arrives as `tostring`, which is not a prototype key
      // and resolves to null through the ordinary path. The case could not fail
      // whatever the code did. Caught by the sensitivity check on this very
      // guard, which failed two of the three cases rather than all three.
      //
      // These two survive folding because they are already lower-case, which is
      // exactly what makes them the reachable ones.
      const resolved = resolveLine(line({ unitReference: reference }), knowing({ '4b': 'unit-1' }))

      expect(resolved).toMatchObject({ kind: 'held' })
    },
  )

  it('returns the same answer for the same input, every time', () => {
    const known = knowing({ '4b': 'unit-1' })

    expect(resolveLine(line(), known)).toEqual(resolveLine(line(), known))
  })
})

describe('the module reads nothing ambient', () => {
  const source = () =>
    readFileSync(join(process.cwd(), 'core', 'payment', 'resolve-line.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')

  it('reads a source file that still has its statements', () => {
    // The control, on a phrase genuinely present before stripping and gone
    // after — on a single line, because docblocks wrap and two stories lost time
    // to a phrase that spanned two.
    // Verified to sit on ONE line before asserting it, rather than after: a
    // wrapped phrase never matches, and this is the third time in three
    // stories that a control failed for that reason instead of a real one.
    const COMMENT_ONLY = /keeping it dull is the point/

    expect(readFileSync(join(process.cwd(), 'core', 'payment', 'resolve-line.ts'), 'utf8')).toMatch(
      COMMENT_ONLY,
    )
    expect(source()).not.toMatch(COMMENT_ONLY)
    expect(source()).toMatch(/export function resolveLine/)
  })

  it.each(['new Date(', 'Date.now(', 'process.env', 'require(', 'import('])(
    'does not reach for %s',
    (forbidden) => {
      expect(source()).not.toContain(forbidden)
    },
  )
})
