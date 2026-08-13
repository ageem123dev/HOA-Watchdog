// @vitest-environment jsdom

/**
 * The figure block (UX-DR3).
 *
 * Two properties, and the first one is the whole reason this is a component
 * rather than a `<p>`: **a figure is a statement, not a link.** EXPERIENCE.md
 * puts it plainly — clicking a balance must do nothing rather than navigate
 * somewhere unexpected on a screen about money. That is asserted here, because
 * it is exactly the kind of thing a later story adds "for convenience".
 *
 * The second is the "as of" date, which must appear when the documents behind
 * the figure predate the current period and must not appear when they do not.
 * A block that always shows it is noise; one that never shows it states an old
 * number as though it were current.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { FigureBlock } from './figure-block'

// Explicit, because `globals: true` is off in vitest.config.ts — see
// `app/quarantine/queue-list.test.tsx` for what that costs when it is missed.
afterEach(cleanup)

describe('a figure block', () => {
  it('shows its label and its figure', () => {
    render(<FigureBlock label="Documents checked" figure="14" asOf={null} />)

    expect(screen.getByText('Documents checked')).toBeDefined()
    expect(screen.getByText('14')).toBeDefined()
  })

  it('is not interactive in any way', () => {
    // UX-DR3: non-interactive. Three separate ways this could stop being true,
    // so three queries — a link, a button, and anything the accessibility tree
    // exposes as clickable.
    render(<FigureBlock label="Needs review" figure="3" asOf={null} />)

    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(document.querySelector('a, button, [onclick], [role="button"]')).toBeNull()
  })

  it('states the date it is as of when it is given one', () => {
    render(<FigureBlock label="Documents checked" figure="14" asOf="2026-03-31" />)

    expect(screen.getByText(/as of 2026-03-31/)).toBeDefined()
  })

  it('says nothing about dates when the figure is current', () => {
    // The absence is the assertion. A block that renders "as of" unconditionally
    // passes every test above and puts a date on every figure on the page all
    // month, which is how a staleness warning stops being read.
    render(<FigureBlock label="Documents checked" figure="14" asOf={null} />)

    expect(screen.queryByText(/as of/)).toBeNull()
  })

  it('sets its figures in tabular numerals so columns of them line up', () => {
    // DESIGN.md, Components: "amount in serif at scale-figure, tabular". Not
    // decoration — a column of figures whose digits are different widths cannot
    // be compared down the page, which is the only reason to show them together.
    render(<FigureBlock label="Documents checked" figure="14" asOf={null} />)

    expect(screen.getByText('14').getAttribute('style')).toContain('tabular-nums')
  })
})
