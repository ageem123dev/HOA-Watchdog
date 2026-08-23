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
import { suggestColumns } from '@/core/mapping/suggest'
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

/**
 * Asked, and found nothing: every required target present, every position null.
 *
 * Distinct from `undefined`, which means nobody was asked. AC7 turns on the
 * difference and the surface says which.
 */
const SAYS_NOTHING = suggestColumns(headingsOf('x'), 'deposit')

describe('the guess arrives already made', () => {
  it('pairs the columns it recognised', () => {
    render(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggestions={suggestColumns(RECOGNISABLE, 'deposit')} />,
    )

    expect(nameOf(/^Date — required — reads Column 1/)).toBeTruthy()
    expect(nameOf(/^Description — required — reads Column 2/)).toBeTruthy()
    expect(nameOf(/^Amount — required — reads Column 3/)).toBeTruthy()
  })

  it('says a pairing was suggested, in words', () => {
    render(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggestions={suggestColumns(RECOGNISABLE, 'deposit')} />,
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
      <ColumnPairing kind="deposit" headings={withAnExtra} suggestions={suggestColumns(withAnExtra, 'deposit')} />,
    )

    const summary = screen.getByTestId('suggestion-summary').textContent ?? ''

    expect(summary).toContain('3')
    expect(summary).not.toContain('4')
    expect(summary).toMatch(/check|review/i)
  })

  it('says plainly when a required field got no suggestion', () => {
    // AC2 at the surface: a required field nobody could match must not show the
    // same blank as one that was never considered.
    render(<ColumnPairing kind="deposit" headings={OPAQUE} suggestions={suggestColumns(OPAQUE, 'deposit')} />)

    expect(nameOf(/^Date — required — no column yet — no suggestion/)).toBeTruthy()
    expect(nameOf(/^Amount — required — no column yet — no suggestion/)).toBeTruthy()
  })

  it('shows both answers at once when it matched some and not others', () => {
    /**
     * The mixed case, and the one closest to a real export. All-matched and
     * none-matched are each covered above, but neither shows the two states
     * side by side — which is what a treasurer actually sees, and the only
     * arrangement where confusing one for the other is possible. Raised by `ocr`.
     */
    const partly = headingsOf('Txn Date', 'Mystery', 'Whatsit')

    render(<ColumnPairing kind="deposit" headings={partly} suggestions={suggestColumns(partly, 'deposit')} />)

    expect(nameOf(/^Date — required — reads Column 1 .*— suggested/)).toBeTruthy()
    expect(nameOf(/^Description — required — no column yet — no suggestion/)).toBeTruthy()
    expect(nameOf(/^Amount — required — no column yet — no suggestion/)).toBeTruthy()
    expect(screen.getByTestId('suggestion-summary').textContent).toContain('1')
  })

  it('suggests an optional column, and says nothing about the ones it did not', () => {
    // `reference` is optional on a deposit. An unmatched optional field is not
    // news, so it says "no column yet" and nothing more — the "no suggestion"
    // wording is reserved for required fields, where the absence matters.
    const withReference = headingsOf('Txn Date', 'Descr', 'Amt', 'Check No')

    render(
      <ColumnPairing kind="deposit" headings={withReference} suggestions={suggestColumns(withReference, 'deposit')} />,
    )

    expect(nameOf(/^Reference — optional — reads Column 4 .*— suggested/)).toBeTruthy()

    /**
     * `unit` is optional on a deposit — `deposit` is in
     * `KINDS_WITH_UNIT_REFERENCE` — so the control is *always* rendered and
     * nothing here names it.
     *
     * The first version guarded this with `if (unit !== null)`, which is a test
     * that passes when the element is absent: the vacuous-guard shape this
     * project keeps finding, written into a test whose whole job is to check a
     * marker. Raised by CodeRabbit.
     */
    expect(nameOf(/^Unit — optional — no column yet$/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Unit — optional.*no suggestion/ })).toBeNull()
  })

  it('leaves the mapping unfinished when it could suggest nothing', () => {
    render(<ColumnPairing kind="deposit" headings={OPAQUE} suggestions={suggestColumns(OPAQUE, 'deposit')} />)

    expect(document.body.textContent ?? '').toContain('Still needed')
  })
})

describe('a suggestion alongside story 5.3’s heading problems', () => {
  /**
   * **The interaction no per-task test could see.** Story 5.3 reports duplicate
   * headings rather than refusing the file; story 5.6 suggests a column for each
   * target. Put together, a file with two `Amount` columns gets *told* to "map
   * whichever you mean" while one of them has already been picked for it.
   *
   * That is coherent only if the screen says both things at once — the problem
   * and which column the guess took. If it said only the first, the treasurer
   * would go looking for a decision already made on their behalf.
   */
  const DUPLICATED = headingsOf('Txn Date', 'Descr', 'Amount', 'Amount')
  const problems = [
    { reason: 'duplicate-heading' as const, heading: 'amount', positions: [3, 4] },
  ]

  it('suggests the first of the duplicates and still reports the problem', () => {
    render(
      <ColumnPairing
        kind="deposit"
        headings={DUPLICATED}
        problems={problems}
        suggestions={suggestColumns(DUPLICATED, 'deposit')}
      />,
    )

    // First in file order, matching what `suggestColumns` guarantees.
    expect(nameOf(/^Amount — required — reads Column 3 .*— suggested/)).toBeTruthy()
    // And 5.3's report is still on screen rather than suppressed by the guess.
    expect(screen.getByTestId('heading-problems').textContent).toContain('Column 3')
    expect(screen.getByTestId('heading-problems').textContent).toContain('Column 4')
  })

  it('lets the treasurer take the other duplicate instead', () => {
    render(
      <ColumnPairing
        kind="deposit"
        headings={DUPLICATED}
        problems={problems}
        suggestions={suggestColumns(DUPLICATED, 'deposit')}
      />,
    )

    // The whole point of reporting the problem: the treasurer resolves it, and
    // the guess must not stand in the way of the resolution.
    fireEvent.click(nameOf(/^Unpair Amount/))
    fireEvent.click(nameOf(/^Column 4/))
    fireEvent.click(nameOf(/^Amount — required/))

    expect(nameOf(/^Amount — required — reads Column 4/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Amount — .* — suggested/ })).toBeNull()
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
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggestions={suggestColumns(RECOGNISABLE, 'deposit')} />,
    )

    // Free column 3, then give Date column 3 instead of the suggested column 1.
    fireEvent.click(nameOf(/^Unpair Amount/))
    fireEvent.click(nameOf(/^Column 3/))
    fireEvent.click(nameOf(/^Date — required/))

    expect(nameOf(/^Date — required — reads Column 3/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Date — .* — suggested/ })).toBeNull()
    // The unpair that made room actually took effect. Without this the test
    // passes even if `unassign` silently did nothing and column 3 was free for
    // some other reason. Raised by `ocr`.
    expect(nameOf(/^Amount — required — no column yet/)).toBeTruthy()
  })

  it('stops calling a pairing suggested once it has been cleared', () => {
    render(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggestions={suggestColumns(RECOGNISABLE, 'deposit')} />,
    )

    fireEvent.click(nameOf(/^Unpair Date/))

    expect(nameOf(/^Date — required — no column yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Date — .* — suggested/ })).toBeNull()
  })

  it('lets a suggested column be unpaired by the means story 5.4 built', () => {
    render(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggestions={suggestColumns(RECOGNISABLE, 'deposit')} />,
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
      <ColumnPairing kind="deposit" headings={OPAQUE} suggestions={suggestColumns(OPAQUE, 'deposit')} />,
    )

    expect(nameOf(/^Date — required — no column yet/)).toBeTruthy()

    // **Four columns, three of them matchable.** The first version of this used
    // a three-column sample, where "how many were suggested" and "how many
    // columns are there" are the same number — so setting the count to
    // `headings.length` survived the mutation. A fixture where the two answers
    // differ is the whole difference between a test and a coincidence.
    const withAnExtra = headingsOf('Txn Date', 'Descr', 'Amt', 'Balance')

    rerender(
      <ColumnPairing kind="deposit" headings={withAnExtra} suggestions={suggestColumns(withAnExtra, 'deposit')} />,
    )

    expect(nameOf(/^Date — required — reads Column 1 .*— suggested/)).toBeTruthy()

    const summary = screen.getByTestId('suggestion-summary').textContent ?? ''
    expect(summary).toContain('3')
    expect(summary).not.toContain('4')
  })

  it('re-runs when the suggester itself changes', () => {
    /**
     * Story 5.6b is the change that makes this reachable — turning a model on or
     * off leaves `kind` and `headings` untouched. Without it, suggestions from a
     * suggester that is no longer in use sit on screen as though it produced
     * them. Raised by `ocr`.
     */
    const { rerender } = render(<ColumnPairing kind="deposit" headings={RECOGNISABLE} />)

    expect(screen.queryByRole('button', { name: /— suggested/ })).toBeNull()

    rerender(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggestions={suggestColumns(RECOGNISABLE, 'deposit')} />,
    )

    expect(nameOf(/^Date — required — reads Column 1 .*— suggested/)).toBeTruthy()

    // And back the other way: withdrawing the suggester clears what it filled in.
    rerender(<ColumnPairing kind="deposit" headings={RECOGNISABLE} />)

    expect(screen.queryByRole('button', { name: /— suggested/ })).toBeNull()
    expect(nameOf(/^Date — required — no column yet/)).toBeTruthy()
  })

  it('re-renders without looping when the same suggester is passed again', () => {
    /**
     * The other side of the referential-stability requirement now documented on
     * the prop. Re-rendering with the *same* constant must not re-run the
     * pre-fill, because the reset writes state during render — and a condition
     * that stayed true every pass is how React reaches "Too many re-renders".
     *
     * A caller passing an inline `{{ suggest }}` object is the shape that
     * breaks, and story 5.6b is what makes it reachable. That case is not
     * asserted here: it fails by aborting the React tree, which is not a
     * behaviour worth pinning in a test. The prop's doc comment carries the
     * requirement. Raised by CodeRabbit.
     */
    const { rerender } = render(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggestions={suggestColumns(RECOGNISABLE, 'deposit')} />,
    )

    for (let pass = 0; pass < 3; pass += 1) {
      rerender(
        <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggestions={suggestColumns(RECOGNISABLE, 'deposit')} />,
      )
    }

    expect(nameOf(/^Date — required — reads Column 1 .*— suggested/)).toBeTruthy()
  })

  it('keeps an override across an unrelated re-render', () => {
    // The reason the reset is conditional at all: a render that changes nothing
    // must not throw away what the treasurer did.
    const { rerender } = render(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggestions={suggestColumns(RECOGNISABLE, 'deposit')} />,
    )

    fireEvent.click(nameOf(/^Unpair Date/))
    rerender(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggestions={suggestColumns(RECOGNISABLE, 'deposit')} />,
    )

    expect(nameOf(/^Date — required — no column yet/)).toBeTruthy()
  })

  it('re-runs it for a different kind too', () => {
    const { rerender } = render(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggestions={suggestColumns(RECOGNISABLE, 'deposit')} />,
    )

    const roll = headingsOf('Unit #', 'Amt', 'Billing Cycle', 'Assessment Year')
    rerender(
      <ColumnPairing kind="assessment_roll" headings={roll} suggestions={suggestColumns(roll, 'assessment_roll')} />,
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

    render(<ColumnPairing kind="deposit" headings={OPAQUE} suggestions={SAYS_NOTHING} />)
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
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggestions={suggestColumns(RECOGNISABLE, 'deposit')} />,
    )

    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1)
  })

  it('announces nothing before the treasurer has done anything', () => {
    // The suggestion is pre-filled, not announced: a live region firing on
    // mount is read over whatever the user was doing.
    render(
      <ColumnPairing kind="deposit" headings={RECOGNISABLE} suggestions={suggestColumns(RECOGNISABLE, 'deposit')} />,
    )

    expect(screen.getByRole('status').textContent).toBe('')
  })
})
