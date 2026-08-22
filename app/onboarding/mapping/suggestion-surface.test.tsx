// @vitest-environment jsdom

/**
 * What the treasurer is told about the guess (story 5.6, Task 4 — AC2 and AC7).
 *
 * ## Everything here is read through an accessible name
 *
 * Not a style, not a `data-` attribute, not a class. A marker carried by tint or
 * weight alone is invisible to exactly the treasurer this project keeps in mind,
 * and story 5.4 already made that call for selection state — *"carried in the
 * accessible name and in `aria-pressed`, never by tint alone"*.
 *
 * ## The one that would ship broken
 *
 * `ColumnPairing` resets its draft when a new sample arrives, because story 5.4
 * found that a mapping outliving its file is *"wrong in the worst direction,
 * because the mapping still looks finished"*. A pre-fill added only to the
 * `useState` initialiser is therefore silently absent on the **second** sample —
 * correct on the path anyone demonstrates, missing on the one they do not, which
 * is the exact shape story 5.2 shipped. `re-reads a second sample` below is that
 * test.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { Heading } from '@/core/extraction/headings'
import { deterministicSuggester, type ColumnSuggester } from '@/core/mapping/suggest'
import { ColumnPairing } from './column-pairing'

afterEach(cleanup)

const headingsOf = (...texts: readonly string[]): readonly Heading[] =>
  texts.map((text, index) => ({
    position: index + 1,
    text,
    normalised: text.trim().toLowerCase(),
  }))

/** A deposit export whose columns a person would recognise on sight. */
const RECOGNISABLE = headingsOf('Txn Date', 'Descr', 'Amt')

/** One nobody could match — the "we have no idea" case. */
const OPAQUE = headingsOf('Col1', 'Col2', 'Col3')

const nameOf = (pattern: RegExp) => screen.getByRole('button', { name: pattern })

/** A suggester that answers, but never with a column. */
const SAYS_NOTHING: ColumnSuggester = {
  suggest: (_headings, kind) => deterministicSuggester.suggest(headingsOf('x'), kind),
}

describe('the guess arrives already made', () => {
  it('pairs the columns it recognised', () => {
    render(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggester={deterministicSuggester} />,
    )

    expect(nameOf(/^Date — required — reads Column 1/)).toBeTruthy()
    expect(nameOf(/^Description — required — reads Column 2/)).toBeTruthy()
    expect(nameOf(/^Amount — required — reads Column 3/)).toBeTruthy()
  })

  it('says a pairing was suggested, in words', () => {
    render(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggester={deterministicSuggester} />,
    )

    // AC3's "offered, not applied" at the surface. Without this the treasurer
    // submits a machine-made mapping believing they made it.
    expect(nameOf(/^Date — required — reads Column 1 .*— suggested/)).toBeTruthy()
  })

  it('says how many it filled in, so the screen is not silently pre-decided', () => {
    // **Four columns, three matchable.** With a three-column sample "how many
    // were suggested" and "how many columns are there" are the same number, and
    // reporting `headings.length` instead of the count survives — a coincidence
    // rather than a test. `Balance` is the column that makes them differ.
    const withAnExtra = headingsOf('Txn Date', 'Descr', 'Amt', 'Balance')

    render(
      <ColumnPairing kind="deposit" headings={withAnExtra} suggester={deterministicSuggester} />,
    )

    const summary = screen.getByTestId('suggestion-summary').textContent ?? ''

    expect(summary).toContain('3')
    expect(summary).not.toContain('4')
    expect(summary).toMatch(/check|review/i)
  })

  it('says plainly when a required field got no suggestion', () => {
    // AC2 at the surface: a required field nobody could match must not show the
    // same blank as one that was never considered.
    render(<ColumnPairing kind="deposit" headings={OPAQUE} suggester={deterministicSuggester} />)

    expect(nameOf(/^Date — required — no column yet — no suggestion/)).toBeTruthy()
    expect(nameOf(/^Amount — required — no column yet — no suggestion/)).toBeTruthy()
  })

  it('leaves the mapping unfinished when it could suggest nothing', () => {
    render(<ColumnPairing kind="deposit" headings={OPAQUE} suggester={deterministicSuggester} />)

    expect(document.body.textContent ?? '').toContain('Still needed')
  })
})

describe('the treasurer overrides it', () => {
  it('stops calling a pairing suggested once it has been changed', () => {
    /**
     * **AC8 on screen.** The marker is about the *current* pairing, not about
     * history. A screen that kept crediting the suggestion after the treasurer
     * moved the column would be saying the machine chose what the human chose.
     */
    render(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggester={deterministicSuggester} />,
    )

    // Free column 3, then give Date column 3 instead of the suggested column 1.
    fireEvent.click(nameOf(/^Unpair Amount/))
    fireEvent.click(nameOf(/^Column 3/))
    fireEvent.click(nameOf(/^Date — required/))

    expect(nameOf(/^Date — required — reads Column 3/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Date — .* — suggested/ })).toBeNull()
  })

  it('stops calling a pairing suggested once it has been cleared', () => {
    render(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggester={deterministicSuggester} />,
    )

    fireEvent.click(nameOf(/^Unpair Date/))

    expect(nameOf(/^Date — required — no column yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Date — .* — suggested/ })).toBeNull()
  })

  it('lets a suggested column be unpaired by the means story 5.4 built', () => {
    render(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggester={deterministicSuggester} />,
    )

    // The unpair control exists for a suggested pairing exactly as it does for a
    // hand-made one — overriding is no harder than accepting (AC3).
    expect(nameOf(/^Unpair Amount/)).toBeTruthy()
  })
})

describe('a second sample', () => {
  it('re-runs the suggestion rather than showing an empty mapping', () => {
    /**
     * The one that would ship broken. Story 5.4's reset exists so a mapping
     * cannot outlive its file; a pre-fill living only in the `useState`
     * initialiser is silently absent from here on.
     */
    const { rerender } = render(
      <ColumnPairing kind="deposit" headings={OPAQUE} suggester={deterministicSuggester} />,
    )

    expect(nameOf(/^Date — required — no column yet/)).toBeTruthy()

    // **Four columns, three of them matchable.** The first version of this used
    // a three-column sample, where "how many were suggested" and "how many
    // columns are there" are the same number — so setting the count to
    // `headings.length` survived the mutation. A fixture where the two answers
    // differ is the whole difference between a test and a coincidence.
    const withAnExtra = headingsOf('Txn Date', 'Descr', 'Amt', 'Balance')

    rerender(
      <ColumnPairing kind="deposit" headings={withAnExtra} suggester={deterministicSuggester} />,
    )

    expect(nameOf(/^Date — required — reads Column 1 .*— suggested/)).toBeTruthy()

    const summary = screen.getByTestId('suggestion-summary').textContent ?? ''
    expect(summary).toContain('3')
    expect(summary).not.toContain('4')
  })

  it('re-runs it for a different kind too', () => {
    const { rerender } = render(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggester={deterministicSuggester} />,
    )

    const roll = headingsOf('Unit #', 'Amt', 'Billing Cycle', 'Assessment Year')
    rerender(
      <ColumnPairing kind="assessment_roll" headings={roll} suggester={deterministicSuggester} />,
    )

    // `cycle` exists only on a roll — proof the new kind drove the suggestion.
    expect(nameOf(/^Billing cycle — required — reads Column 3 .*— suggested/)).toBeTruthy()
  })
})

describe('with no suggester at all (AC7)', () => {
  it('renders the pairing surface exactly as story 5.4 built it', () => {
    render(<ColumnPairing kind="deposit" headings={RECOGNISABLE} />)

    expect(nameOf(/^Column 1 — Txn Date/)).toBeTruthy()
    expect(nameOf(/^Date — required — no column yet/)).toBeTruthy()
  })

  it('is fully usable — a column can still be paired by hand', () => {
    render(<ColumnPairing kind="deposit" headings={RECOGNISABLE} />)

    fireEvent.click(nameOf(/^Column 1/))
    fireEvent.click(nameOf(/^Date — required/))

    expect(nameOf(/^Date — required — reads Column 1/)).toBeTruthy()
  })

  it('says nothing was suggested, rather than leaving the treasurer to wonder', () => {
    render(<ColumnPairing kind="deposit" headings={RECOGNISABLE} />)

    // "Not a crash, not an empty screen, and not silence."
    expect(screen.getByTestId('suggestion-summary').textContent).toMatch(/nothing was suggested/i)
  })

  it('marks nothing as suggested', () => {
    render(<ColumnPairing kind="deposit" headings={RECOGNISABLE} />)

    expect(screen.queryByRole('button', { name: /— suggested/ })).toBeNull()
  })

  it('reads differently from a suggester that had nothing to say', () => {
    /**
     * The cross-check. Both screens are empty of pairings; they are not the same
     * situation. One was never asked, the other looked and found nothing, and a
     * treasurer deciding whether to trust the tool needs to know which.
     */
    const { unmount } = render(<ColumnPairing kind="deposit" headings={RECOGNISABLE} />)
    const neverAsked = screen.getByTestId('suggestion-summary').textContent
    unmount()

    render(<ColumnPairing kind="deposit" headings={OPAQUE} suggester={SAYS_NOTHING} />)
    const foundNothing = screen.getByTestId('suggestion-summary').textContent

    expect(neverAsked).toBeTruthy()
    expect(foundNothing).toBeTruthy()
    expect(neverAsked).not.toBe(foundNothing)
  })
})

describe('the announcement region', () => {
  it('stays the only live region on the screen', () => {
    // Story 5.4: "the only live region on this screen — nesting one inside
    // another is how an announcement gets read twice or not at all." The
    // suggestion summary is static text for that reason.
    render(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggester={deterministicSuggester} />,
    )

    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1)
  })

  it('announces nothing before the treasurer has done anything', () => {
    // The suggestion is pre-filled, not announced: a live region firing on
    // mount is read over whatever the user was doing.
    render(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggester={deterministicSuggester} />,
    )

    expect(screen.getByRole('status').textContent).toBe('')
  })
})
