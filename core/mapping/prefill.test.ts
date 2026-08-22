/**
 * Pre-filling a draft from a suggestion (story 5.6, Task 3 — AC3 and AC8).
 *
 * ## The one thing this file is really about
 *
 * A suggested pairing must be *the same kind of thing* as one the treasurer
 * made. Not similar — the same. So the test that matters is the equality at the
 * bottom: pre-fill a draft, override every pairing, and assert the result is
 * byte-for-byte the draft you would get by pairing those columns by hand.
 * Anything that made a suggested pairing special would show up there.
 *
 * That is AC8 — *"a confirmed mapping is the treasurer's, whether or not it
 * matches the suggestion"* — stated as an equality rather than as a feeling.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { Heading } from '../extraction/headings'
import { neutralise } from '../ports/declared-members'
import { specifiersIn } from '../ports/module-specifiers'
import { assign, completeness, emptyDraft, unassign, type DraftMapping } from './draft'
import { draftFromSuggestion } from './prefill'
import { suggestColumns } from './suggest'

const headingsOf = (...texts: readonly string[]): readonly Heading[] =>
  texts.map((text, index) => ({
    position: index + 1,
    text,
    normalised: text.trim().toLowerCase(),
  }))

/** A deposit sample whose columns a person would recognise on sight. */
const DEPOSIT = headingsOf('Txn Date', 'Descr', 'Amt', 'Check No')

const positionOf = (draft: DraftMapping, target: string): number | undefined =>
  draft.pairings.find((pairing) => pairing.target === target)?.position

describe('a draft that arrives already filled in', () => {
  it('pairs the columns the suggester named', () => {
    const { draft } = draftFromSuggestion(DEPOSIT, 'deposit', suggestColumns(DEPOSIT, 'deposit'))

    expect(positionOf(draft, 'date')).toBe(1)
    expect(positionOf(draft, 'description')).toBe(2)
    expect(positionOf(draft, 'amount')).toBe(3)
    expect(positionOf(draft, 'reference')).toBe(4)
  })

  it('reports a complete mapping when the suggester covered everything required', () => {
    const { draft } = draftFromSuggestion(DEPOSIT, 'deposit', suggestColumns(DEPOSIT, 'deposit'))

    // The treasurer's actual experience of a good suggestion: nothing left to do
    // but look at it. `completeness` is story 5.4's, not a second opinion.
    expect(completeness(draft).complete).toBe(true)
  })

  it('takes its column count from the sample, not from the suggestion', () => {
    // A draft sized by the suggestion would give a file nobody recognised zero
    // columns, and then nothing could be paired into it by hand either.
    const headings = headingsOf('Col1', 'Col2', 'Col3', 'Col4', 'Col5')
    const { draft } = draftFromSuggestion(headings, 'deposit', suggestColumns(headings, 'deposit'))

    expect(draft.columns).toBe(5)
    expect(draft.pairings).toEqual([])
    // And the treasurer can still pair by hand into every one of them.
    expect(assign(draft, 'amount', 5).ok).toBe(true)
  })

  it('says how many pairings it made', () => {
    // AC2's distinction one layer up: a suggester that proposed nothing usable
    // must not look identical to one that was never asked.
    const { applied } = draftFromSuggestion(DEPOSIT, 'deposit', suggestColumns(DEPOSIT, 'deposit'))

    expect(applied).toBe(4)
  })

  it('makes no pairings, and says so, when nothing was recognised', () => {
    const headings = headingsOf('Col1', 'Col2')
    const { applied, draft } = draftFromSuggestion(
      headings,
      'deposit',
      suggestColumns(headings, 'deposit'),
    )

    expect(applied).toBe(0)
    expect(draft.pairings).toEqual([])
  })

  it('makes no pairings when handed no suggestion at all', () => {
    // AC7's half of the seam: no suggester is a supported state, not an error.
    const { applied, draft } = draftFromSuggestion(DEPOSIT, 'deposit', [])

    expect(applied).toBe(0)
    expect(draft.columns).toBe(4)
    expect(completeness(draft).complete).toBe(false)
  })
})

describe('a suggestion the draft would refuse', () => {
  it('never turns "no suggestion" into a pairing', () => {
    /**
     * "No suggestion" is `position: null`, and only `date` matches here — the
     * other required targets come back null.
     *
     * **The guard against passing that to `assign` is the compiler's**, not this
     * test's: `assign` takes a `number`, so deleting the null check is a type
     * error rather than a surviving mutation. Verified by deleting it — `tsc`
     * refuses. What is observable, and what this asserts, is that a null never
     * becomes a pairing and never inflates the count.
     */
    const headings = headingsOf('Txn Date')
    const { draft, applied } = draftFromSuggestion(
      headings,
      'deposit',
      suggestColumns(headings, 'deposit'),
    )

    expect(applied).toBe(1)
    expect(draft.pairings.every((pairing) => Number.isInteger(pairing.position))).toBe(true)
    expect(draft.pairings.map((p) => p.position)).not.toContain(0)
  })

  it('skips a pairing assign refuses and keeps the rest', () => {
    /**
     * One odd column must not cost the treasurer every other suggestion. The
     * refusal is forced directly rather than through `suggestColumns`, which is
     * built not to produce one — that is Task 2's guarantee, and a test that
     * relied on it would be testing Task 2 again instead of this behaviour.
     */
    const suggestions = [
      { target: 'date' as const, position: 1 },
      // Column 99 does not exist in a four-column sample: `no-such-column`.
      { target: 'description' as const, position: 99 },
      { target: 'amount' as const, position: 3 },
    ]
    const { draft, applied } = draftFromSuggestion(DEPOSIT, 'deposit', suggestions)

    expect(applied).toBe(2)
    expect(positionOf(draft, 'date')).toBe(1)
    expect(positionOf(draft, 'amount')).toBe(3)
    expect(positionOf(draft, 'description')).toBeUndefined()
  })

  it('skips the second claim on a column already paired', () => {
    // Story 5.4 refuses rather than moving. The pre-fill must inherit that
    // rather than deciding for itself which claim wins.
    const suggestions = [
      { target: 'date' as const, position: 1 },
      { target: 'amount' as const, position: 1 },
    ]
    const { draft, applied } = draftFromSuggestion(DEPOSIT, 'deposit', suggestions)

    expect(applied).toBe(1)
    expect(positionOf(draft, 'date')).toBe(1)
    expect(positionOf(draft, 'amount')).toBeUndefined()
  })

  it('skips a target the kind does not publish', () => {
    const suggestions = [
      { target: 'date' as const, position: 1 },
      // `cycle` belongs to a roll. `assign` answers `not-a-target` on a deposit.
      { target: 'cycle' as const, position: 2 },
    ]
    const { draft, applied } = draftFromSuggestion(DEPOSIT, 'deposit', suggestions)

    expect(applied).toBe(1)
    expect(positionOf(draft, 'cycle')).toBeUndefined()
  })
})

describe('the mapping is the treasurer’s (AC8)', () => {
  it('lets every suggested pairing be moved', () => {
    const { draft } = draftFromSuggestion(DEPOSIT, 'deposit', suggestColumns(DEPOSIT, 'deposit'))

    // `date` was suggested at column 1. Move it to 4, which means first freeing
    // 4 — exactly the sequence a treasurer performs, using only story 5.4's API.
    const freed = unassign(draft, 'reference')
    const moved = assign(freed, 'date', 4)

    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(positionOf(moved.draft, 'date')).toBe(4)
  })

  it('lets every suggested pairing be cleared, and it stays cleared', () => {
    const { draft } = draftFromSuggestion(DEPOSIT, 'deposit', suggestColumns(DEPOSIT, 'deposit'))
    const cleared = unassign(draft, 'amount')

    expect(positionOf(cleared, 'amount')).toBeUndefined()
    // Nothing re-applies the suggestion behind the treasurer's back.
    expect(completeness(cleared).missing).toContain('amount')
  })

  it('ends identical to the draft built by hand from the same choices', () => {
    /**
     * **The equality AC8 comes down to.** Take the pre-filled draft, override
     * every single pairing, and compare against the same choices made from an
     * empty draft. If a suggested pairing carried any privileged status — a
     * flag, an origin, a different shape, an ordering — this is where it shows.
     *
     * Compared on sorted pairings because `assign` appends, so the two arrive at
     * the same set by different routes. Order is not part of the contract; the
     * set of pairings is.
     */
    const byHand = [
      ['date', 4],
      ['description', 3],
      ['amount', 2],
      ['reference', 1],
    ] as const

    const suggested = draftFromSuggestion(DEPOSIT, 'deposit', suggestColumns(DEPOSIT, 'deposit'))

    // Every one of these overrides a suggestion — asserted for all four, not
    // just the first. The comment claimed "nothing here is a no-op" while only
    // `date` was checked, which is a claim resting on the reader's goodwill.
    // Raised by `ocr`.
    for (const [target, position] of byHand) {
      expect(positionOf(suggested.draft, target), `${target} was not a real override`).not.toBe(
        position,
      )
    }

    const override = (start: DraftMapping): DraftMapping => {
      // Clear first: the suggestion holds all four columns, and story 5.4
      // refuses a column already paired rather than moving it.
      let draft = start
      for (const [target] of byHand) draft = unassign(draft, target)
      for (const [target, position] of byHand) {
        const result = assign(draft, target, position)
        expect(result.ok, `assign refused ${target}@${position}`).toBe(true)
        if (result.ok) draft = result.draft
      }
      return draft
    }

    const fromSuggestion = override(suggested.draft)
    const fromScratch = override(emptyDraft('deposit', DEPOSIT.length))

    const sorted = (draft: DraftMapping) =>
      [...draft.pairings].sort((a, b) => a.target.localeCompare(b.target))

    expect(sorted(fromSuggestion)).toEqual(sorted(fromScratch))
    expect(fromSuggestion.kind).toBe(fromScratch.kind)
    expect(fromSuggestion.columns).toBe(fromScratch.columns)
    // Non-empty, so the equality above is not two empty lists agreeing.
    expect(sorted(fromScratch)).toHaveLength(4)
  })
})

describe('nothing is stored, and nothing can be', () => {
  const SOURCE = readFileSync(fileURLToPath(new URL('./prefill.ts', import.meta.url)), 'utf8')

  it('imports only the domain modules it folds over', () => {
    // **5.7 is where a mapping is remembered.** A pre-fill that wrote anything
    // would answer 5.7's idempotency question early, and wrongly.
    const allowed = ['../extraction/headings', '../extraction/record', './draft', './suggest']

    expect(specifiersIn(SOURCE).length).toBeGreaterThan(0)
    expect(specifiersIn(SOURCE).filter((s) => !allowed.includes(s))).toEqual([])
  })

  it('builds the draft through assign rather than writing pairings itself', () => {
    /**
     * Structural, and it is the point of the whole task. Writing `pairings`
     * directly would be a second way to build a draft — correct today, and
     * divergent the day story 5.4's rules change. This project has found that
     * shape twice already (`targetsForKind` versus a hand list, `TARGET_LABELS`
     * twice), which is why it is asserted rather than trusted.
     *
     * The behavioural half is above: the refusal tests only pass because 5.4's
     * rules are the ones being applied. Neither half alone is sufficient —
     * story 5.3's finding, and Task 1 proved it again when a forked folding
     * passed every behavioural assertion.
     */
    /**
     * **Scanned with the comments blanked**, like `suggest.test.ts`. Both
     * assertions ran against the raw file, and this module's own doc comment
     * discusses `assign` and `pairings` at length — so the positive check could
     * be satisfied by prose and the negative one broken by it. That is the same
     * defect twice over, and it is the third time this story has hit it: once on
     * `matchKey`'s structural check, once on the AD-8 scan. Raised by CodeRabbit.
     */
    const code = neutralise(SOURCE).commentsBlanked

    expect(code).toContain('assign(')
    expect(code).not.toContain('pairings:')
    // The blanker must not be what makes this pass — if it ate the code, both
    // assertions above are about an empty string.
    expect(code).toContain('export function draftFromSuggestion')
  })
})
