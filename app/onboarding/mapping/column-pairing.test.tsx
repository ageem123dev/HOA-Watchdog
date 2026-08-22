// @vitest-environment jsdom

/**
 * The pairing surface (story 5.4, AC5, AC7, and AC1/AC3/AC4 as they reach a screen).
 *
 * ## What "operable by keyboard" is allowed to mean in a jsdom test
 *
 * On a native `<button>`, a keyboard activation *is* a click event — the browser
 * synthesises it, and jsdom does not. So firing `keyDown` here would prove
 * nothing unless the component grew an `onKeyDown` of its own, which is exactly
 * the second implementation AC6 forbids.
 *
 * The evidence is therefore two things together, and neither is sufficient
 * alone:
 *
 *   1. every control that changes the mapping is a real `<button>` in the tab
 *      order — a `<div onClick>` is the actual defect, and it is what fails; and
 *   2. the whole mapping can be built and taken apart through exactly those
 *      controls.
 *
 * Said out loud because a test named "works by keyboard" that fires clicks at
 * `<div>`s is the reassuring-and-empty shape this project keeps finding.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { readHeadings } from '@/core/extraction/headings'
import { targetsForKind } from '@/core/mapping/targets'
import { ColumnPairing } from './column-pairing'

/**
 *   1 Date   2 Amount   3 (blank)   4 amount   5 Unit
 *
 * Read through `readHeadings` rather than hand-built, so the duplicate and the
 * blank are genuinely there — story 5.4's Task 2 shipped a fixture whose
 * collision existed only in a comment, and the whole file stayed green when the
 * column count was changed.
 */
const SAMPLE: readonly (readonly string[])[] = [
  ['Date', 'Amount', '  ', 'amount', 'Unit'],
  ['2026-03-01', '1240.00', 'Willow Creek Landscaping', '99.00', '12B'],
]

const read = readHeadings(SAMPLE)

if (!read.ok) throw new Error(`fixture is unreadable: ${read.reason}`)

const HEADINGS = read.headings

afterEach(cleanup)

const column = (position: number) =>
  screen.getByRole('button', { name: new RegExp(`^Column ${position}\\b`) })

const field = (label: string) =>
  screen.getByRole('button', { name: new RegExp(`^${label} — (required|optional)`) })

const unpairButton = (label: string) => screen.getByRole('button', { name: `Unpair ${label}` })

/** Choose a column, then the field it feeds — the whole interaction. */
const pair = (position: number, label: string) => {
  fireEvent.click(column(position))
  fireEvent.click(field(label))
}

describe('the fixture is the file it claims to be', () => {
  it('has a duplicated heading and a blank one', () => {
    expect(read.problems).toEqual([
      { reason: 'duplicate-heading', heading: 'amount', positions: [2, 4] },
      { reason: 'blank-heading', positions: [3] },
    ])
  })

  it('has exactly the five columns the tests below name', () => {
    // Nothing here is derived from the count, so adding a sixth column broke
    // nothing — which is why it is pinned rather than left to be noticed later.
    expect(HEADINGS).toHaveLength(5)
  })
})

describe('every control is one the keyboard can reach', () => {
  it('renders no clickable element that is not a button', () => {
    const { container } = render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    // The defect this guards is a `<div onClick>`: it works with a mouse and is
    // unreachable by keyboard, and it looks identical on screen. React puts an
    // `onClick` on the DOM node, so anything carrying one and not being a
    // button is the failure.
    const clickable = [...container.querySelectorAll('*')].filter((element) =>
      Object.keys(element).some((key) => key.startsWith('__reactProps')),
    )

    const handlers = clickable.filter((element) => {
      const props = Object.entries(element).find(([key]) => key.startsWith('__reactProps'))?.[1]
      return typeof (props as { onClick?: unknown } | undefined)?.onClick === 'function'
    })

    // Non-empty first — a filter over nothing reports success.
    expect(handlers.length).toBeGreaterThan(0)
    expect(handlers.map((element) => element.tagName)).toEqual(handlers.map(() => 'BUTTON'))
  })

  it('takes no control out of the tab order', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    const buttons = screen.getAllByRole('button')

    expect(buttons.length).toBeGreaterThan(0)
    expect(buttons.filter((button) => button.getAttribute('tabindex') === '-1')).toEqual([])
  })
})

describe('building a mapping', () => {
  it('pairs a column to a field and says so in the row', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    pair(2, 'Amount')

    // In the text, not in a tint: state carried by colour alone is invisible to
    // a screen reader and to anyone who cannot tell the tints apart.
    expect(field('Amount')).toHaveProperty('textContent', expect.stringContaining('Column 2'))
  })

  it('announces the pairing in a live region', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    pair(2, 'Amount')

    const status = screen.getByRole('status')

    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toContain('Amount')
    expect(status.textContent).toContain('Column 2')
  })

  it('announces an unpairing differently from a pairing', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    pair(2, 'Amount')
    const paired = screen.getByRole('status').textContent

    fireEvent.click(unpairButton('Amount'))

    const unpaired = screen.getByRole('status').textContent

    expect(unpaired).not.toBe(paired)
    expect(unpaired).toContain('Amount')
  })

  it('clears the selection after a pairing', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    pair(2, 'Amount')
    // A dangling selection would pair column 2 again here, to a field the
    // treasurer never chose it for.
    fireEvent.click(field('Date'))

    expect(field('Date')).toHaveProperty('textContent', expect.stringContaining('no column yet'))
  })

  it('maps the column whose heading is blank', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    pair(3, 'Description')

    expect(field('Description')).toHaveProperty(
      'textContent',
      expect.stringContaining('Column 3'),
    )
  })

  it('keeps the two identically-named columns apart', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    pair(2, 'Amount')
    pair(4, 'Reference')

    expect(field('Amount')).toHaveProperty('textContent', expect.stringContaining('Column 2'))
    expect(field('Reference')).toHaveProperty('textContent', expect.stringContaining('Column 4'))
  })

  it('takes the whole mapping apart again', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    pair(1, 'Date')
    pair(2, 'Amount')
    pair(3, 'Description')

    for (const label of ['Date', 'Amount', 'Description']) {
      fireEvent.click(unpairButton(label))
    }

    expect(screen.queryByRole('button', { name: /^Unpair / })).toBeNull()
  })
})

describe('the surface does not decide what a valid pairing is', () => {
  it('shows the refusal `assign` gives for a column another field already holds', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    pair(2, 'Amount')
    pair(2, 'Reference')

    // Named, not a generic "that is not allowed": the treasurer has to know
    // which field to unpair.
    const alert = screen.getByRole('alert')

    expect(alert.textContent).toContain('Column 2')
    expect(alert.textContent).toContain('Amount')
    expect(field('Reference')).toHaveProperty('textContent', expect.stringContaining('no column yet'))
  })

  it('offers exactly the fields `targetsForKind` publishes for the kind', () => {
    for (const kind of ['deposit', 'invoice', 'assessment_roll'] as const) {
      cleanup()
      render(<ColumnPairing kind={kind} headings={HEADINGS} />)

      const { required, optional } = targetsForKind(kind)
      const offered = screen
        .getAllByRole('button', { name: / — (required|optional)/ })
        .map((button) => (button.textContent ?? '').split(' — ')[0])

      expect(offered.length).toBe(required.length + optional.length)
      // `unit` on an invoice is the case that matters: the importer ignores it,
      // so a pairing there reads as done and does nothing.
      expect(offered.includes('Unit')).toBe([...required, ...optional].includes('unit'))
    }
  })
})

describe('what is still needed', () => {
  it('names every missing required field, not a count and not the first', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    pair(1, 'Date')

    const remaining = screen.getByText(/Still needed/)

    expect(remaining.textContent).toContain('Description')
    expect(remaining.textContent).toContain('Amount')
  })

  it('says so plainly once every required field has a column', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    pair(1, 'Date')
    pair(2, 'Amount')
    pair(3, 'Description')

    expect(screen.queryByText(/Still needed/)).toBeNull()
    expect(screen.getByText(/Every required field has a column/)).toBeTruthy()
  })

  it('marks which fields are required and which are optional in words', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    const { required } = targetsForKind('deposit')

    for (const target of required) {
      const label = target.charAt(0).toUpperCase() + target.slice(1)
      expect(field(label).textContent).toContain('required')
    }

    expect(within(field('Reference')).queryByText(/required/)).toBeNull()
    expect(field('Reference').textContent).toContain('optional')
  })
})
