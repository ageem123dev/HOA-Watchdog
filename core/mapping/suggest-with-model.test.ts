/**
 * Deterministic first, the model on the residue (story 5.6b, Task 3).
 *
 * ## The property nearly every test here checks
 *
 * **Falling back is the ordinary path, not the error path.** Every way an asker
 * can fail — throwing, rejecting, hanging up, answering nonsense, answering
 * about columns it was never asked about — returns the deterministic answer
 * *unchanged*. FR-10 requires the wizard to work when the model does not, and
 * story 5.6 built the seam so that requirement costs nothing here.
 *
 * ## AC8, and why shape matters
 *
 * The merged result must be indistinguishable in shape from a purely
 * deterministic one. If the surface could tell which half produced a suggestion,
 * it would eventually say so — and "offered, not applied" would quietly become
 * "offered by a machine, applied by a machine".
 */

import { describe, expect, it, vi } from 'vitest'

import { DOCUMENT_KINDS, type DocumentKind } from '../extraction/record'
import type { Heading } from '../extraction/headings'
import { assign, emptyDraft } from './draft'
import { residueOf } from './residue'
import { suggestColumns, type Suggestion } from './suggest'
import { suggestWithModel, type ResidueAsker } from './suggest-with-model'

const headingsOf = (...texts: readonly string[]): readonly Heading[] =>
  texts.map((text, index) => ({
    position: index + 1,
    text,
    normalised: text.trim().toLowerCase(),
  }))

/** Date matches; the other two required targets do not. */
const PARTLY = headingsOf('Txn Date', 'Booking ref', 'Sum paid')

/** Everything a person would recognise. */
const FULLY = headingsOf('Txn Date', 'Descr', 'Amt')

const silent: ResidueAsker = async () => []

const answering = (...pairings: readonly Suggestion[]): ResidueAsker => async () => pairings

const positionFor = (suggestions: readonly Suggestion[], target: string) =>
  suggestions.find((s) => s.target === target)?.position ?? null

describe('the model adds to the deterministic answer', () => {
  it('fills a target deterministic matching could not', async () => {
    const result = await suggestWithModel(
      PARTLY,
      'deposit',
      answering({ target: 'description', position: 2 }, { target: 'amount', position: 3 }),
    )

    expect(positionFor(result, 'date')).toBe(1)
    expect(positionFor(result, 'description')).toBe(2)
    expect(positionFor(result, 'amount')).toBe(3)
  })

  it('keeps the same shape as a purely deterministic answer', async () => {
    /**
     * AC8. Same targets, same order, same "null means considered and not found".
     * A surface that could tell the two apart would eventually say so.
     */
    const deterministic = suggestColumns(PARTLY, 'deposit')
    const merged = await suggestWithModel(
      PARTLY,
      'deposit',
      answering({ target: 'amount', position: 3 }),
    )

    expect(merged.map((s) => s.target)).toEqual(deterministic.map((s) => s.target))
  })
})

describe('the deterministic answer wins', () => {
  it('ignores a model pairing that contradicts one already matched', async () => {
    // `date` was matched at column 1. An asker claiming otherwise does not get
    // to replace a column a person would have recognised on sight.
    const result = await suggestWithModel(
      PARTLY,
      'deposit',
      answering({ target: 'date', position: 3 }),
    )

    expect(positionFor(result, 'date')).toBe(1)
  })

  it('ignores a model pairing claiming a column already taken', async () => {
    // Column 1 belongs to `date`. `assign` would refuse this, and the treasurer
    // would see nothing happen.
    const result = await suggestWithModel(
      PARTLY,
      'deposit',
      answering({ target: 'amount', position: 1 }),
    )

    expect(positionFor(result, 'amount')).toBeNull()
    expect(positionFor(result, 'date')).toBe(1)
  })

  it('ignores a target the residue never offered', async () => {
    // `reference` is optional, so it is never in `unfilled` and never asked
    // about. An asker volunteering it is answering a question nobody put.
    const result = await suggestWithModel(
      PARTLY,
      'deposit',
      answering({ target: 'reference', position: 2 }),
    )

    expect(positionFor(result, 'reference')).toBeNull()
  })

  it('ignores a target the kind does not publish', async () => {
    const result = await suggestWithModel(
      PARTLY,
      'deposit',
      answering({ target: 'cycle', position: 2 } as Suggestion),
    )

    expect(result.some((s) => s.target === 'cycle')).toBe(false)
  })

  it('takes the first of two model pairings for one target', async () => {
    /**
     * Distinct from the position collision below, and it needs its own fixture:
     * every other test here has the target rejected earlier — for being already
     * matched, or never unfilled — so the "this target is spoken for" guard
     * never fires and survives being deleted. Two answers for the *same*
     * unfilled target is the only shape that reaches it.
     */
    const result = await suggestWithModel(
      PARTLY,
      'deposit',
      answering({ target: 'amount', position: 2 }, { target: 'amount', position: 3 }),
    )

    expect(positionFor(result, 'amount')).toBe(2)
    // And the second answer did not quietly claim column 3 for something else.
    expect(result.filter((s) => s.position === 3)).toEqual([])
  })

  it('ignores an entry whose fields are the wrong type', async () => {
    // The object check above catches `null` and `7`; this catches a
    // well-shaped object carrying rubbish.
    const result = await suggestWithModel(PARTLY, 'deposit', (async () => [
      { target: 'amount', position: '2' },
      { target: 5, position: 3 },
    ]) as unknown as ResidueAsker)

    expect(result).toEqual(suggestColumns(PARTLY, 'deposit'))
  })

  it('refuses two model pairings that claim one position', async () => {
    /**
     * The merge guards independently of the adapter. `ResidueAsker` is a port —
     * story 5.6b's Gemini adapter refuses this before it ever gets here, but it
     * is not the only implementation the type admits, and a guard that relies on
     * a particular caller behaving is not a guard.
     */
    const result = await suggestWithModel(
      PARTLY,
      'deposit',
      answering({ target: 'description', position: 2 }, { target: 'amount', position: 2 }),
    )

    expect(positionFor(result, 'description')).toBe(2)
    expect(positionFor(result, 'amount')).toBeNull()
  })
})

describe('every way the model can fail (AC2)', () => {
  const deterministic = () => suggestColumns(PARTLY, 'deposit')

  it.each([
    ['no asker at all', undefined],
    ['an asker that answers nothing', silent],
    ['an asker that throws', (() => {
      throw new Error('boom')
    }) as unknown as ResidueAsker],
    ['an asker that rejects', (async () => {
      throw new Error('boom')
    }) as ResidueAsker],
    ['an asker that answers a non-array', (async () => 'nope') as unknown as ResidueAsker],
    ['an asker that answers null', (async () => null) as unknown as ResidueAsker],
    ['an asker answering rubbish entries', (async () => [null, 7, 'x']) as unknown as ResidueAsker],
  ])('returns the deterministic answer unchanged given %s', async (_label, asker) => {
    const result = await suggestWithModel(PARTLY, 'deposit', asker as ResidueAsker | undefined)

    expect(result).toEqual(deterministic())
  })

  it('never rejects, whatever the asker does', async () => {
    const exploding = (() => {
      throw new Error('boom')
    }) as unknown as ResidueAsker

    await expect(suggestWithModel(PARTLY, 'deposit', exploding)).resolves.toBeDefined()
  })
})

describe('the model is not asked when there is nothing to ask', () => {
  it('does not call the asker for a fully matched file', async () => {
    // AC1. A fake that *fails* when called, not one that merely records.
    const never = vi.fn(async () => {
      throw new Error('the asker must not be called when nothing is unmatched')
    }) as unknown as ResidueAsker

    const result = await suggestWithModel(FULLY, 'deposit', never)

    expect(result).toEqual(suggestColumns(FULLY, 'deposit'))
    expect(never).not.toHaveBeenCalled()
    // And the residue really is empty, so this is the condition being tested
    // rather than an accident of the fixture.
    expect(residueOf(FULLY, 'deposit').unfilled).toEqual([])
  })

  it('does call the asker when something is unmatched', async () => {
    // The other side of the boundary: without this, an implementation that
    // never calls the asker passes the test above.
    const asker = vi.fn(async () => []) as unknown as ResidueAsker

    await suggestWithModel(PARTLY, 'deposit', asker)

    expect(asker).toHaveBeenCalledTimes(1)
  })

  it('offers the asker only the residue', async () => {
    const seen: unknown[] = []
    const asker: ResidueAsker = async (residue) => {
      seen.push(residue)
      return []
    }

    await suggestWithModel(PARTLY, 'deposit', asker)

    expect(seen).toEqual([residueOf(PARTLY, 'deposit')])
  })
})

describe('the cross-check: assign accepts everything', () => {
  it.each(DOCUMENT_KINDS)('produces only pairings assign accepts, for a %s', async (kind: DocumentKind) => {
    const headings = headingsOf('Txn Date', 'Booking ref', 'Sum paid', 'Unit #', 'Whatsit')
    // An asker that claims every unfilled target, in order, on the columns it
    // was offered — the most aggressive well-formed answer possible.
    const greedy: ResidueAsker = async (residue) =>
      residue.unfilled.map((target, index) => ({
        target,
        position: residue.headings[index]?.position ?? -1,
      }))

    const result = await suggestWithModel(headings, kind, greedy)
    const proposed = result.filter((s) => s.position !== null)

    expect(proposed.length).toBeGreaterThan(0)

    let draft = emptyDraft(kind, headings.length)
    for (const suggestion of proposed) {
      const outcome = assign(draft, suggestion.target, suggestion.position as number)
      expect(outcome.ok, `assign refused ${suggestion.target}@${suggestion.position}`).toBe(true)
      if (outcome.ok) draft = outcome.draft
    }
  })
})
