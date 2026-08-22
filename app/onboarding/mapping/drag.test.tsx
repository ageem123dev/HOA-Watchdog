// @vitest-environment jsdom

/**
 * Dragging, as an accelerator over the pairing operation (story 5.4, AC6).
 *
 * **The claim is that both paths call one function, and the proof is not a grep.**
 * "Both call the same function" is a claim a structural check appears to prove
 * and does not — story 5.3 learned that when a check written to prove two
 * modules shared a folding passed against an import the module never used. So
 * this builds the same mapping twice, once through the buttons and once through
 * drag events, and compares what the surface says. Two implementations that
 * disagree cannot both pass.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readHeadings } from '@/core/extraction/headings'
import { ColumnPairing } from './column-pairing'

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

/**
 * A `DataTransfer` jsdom does not provide.
 *
 * jsdom fires drag events but supplies no `dataTransfer`, so one is passed in —
 * which is also what makes the payload assertable: a handler that stashed the
 * position in a module variable instead of on the event would not touch this.
 */
function transfer() {
  const store = new Map<string, string>()
  return {
    setData: (format: string, value: string) => void store.set(format, value),
    getData: (format: string) => store.get(format) ?? '',
    dropEffect: 'move',
    effectAllowed: 'move',
  }
}

/** Drag a column onto a field, the way a browser would. */
function drag(position: number, label: string, dataTransfer = transfer()) {
  fireEvent.dragStart(column(position), { dataTransfer })
  fireEvent.dragOver(field(label), { dataTransfer })
  fireEvent.drop(field(label), { dataTransfer })
}

/** What the surface says, as a reader would read it. */
const surfaceText = () => [
  ...screen.getAllByRole('button', { name: / — (required|optional)/ }).map((b) => b.textContent),
  screen.getByRole('status').textContent,
  screen.queryByRole('alert')?.textContent ?? null,
  screen.getByText(/Still needed|Every required field/).textContent,
]

describe('the pointer path and the keyboard path agree', () => {
  it('builds the same mapping either way', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)
    fireEvent.click(column(2))
    fireEvent.click(field('Amount'))
    fireEvent.click(column(4))
    fireEvent.click(field('Reference'))
    const byKeyboard = surfaceText()

    cleanup()

    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)
    drag(2, 'Amount')
    drag(4, 'Reference')
    const byDrag = surfaceText()

    expect(byDrag).toEqual(byKeyboard)
    // Non-vacuous: the comparison above would hold just as well between two
    // surfaces on which nothing happened.
    expect(byDrag.join(' ')).toContain('Column 2')
    expect(byDrag.join(' ')).toContain('Column 4')
  })

  it('refuses a claimed column the same way either way', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)
    fireEvent.click(column(2))
    fireEvent.click(field('Amount'))
    fireEvent.click(column(2))
    fireEvent.click(field('Reference'))
    const byKeyboard = screen.getByRole('alert').textContent

    cleanup()

    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)
    drag(2, 'Amount')
    drag(2, 'Reference')

    // A drop handler that set state itself would most likely just move the
    // column, and nothing else on screen would say so.
    expect(screen.getByRole('alert').textContent).toBe(byKeyboard)
    expect(byKeyboard).toContain('Amount')
  })
})

describe('the drag mechanics a browser actually needs', () => {
  it('marks the columns draggable', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    expect(column(2).getAttribute('draggable')).toBe('true')
  })

  it('prevents the default on drag-over, or the browser never fires a drop', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)
    const dataTransfer = transfer()
    fireEvent.dragStart(column(2), { dataTransfer })

    const event = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
    const preventDefault = vi.spyOn(event, 'preventDefault')

    field('Amount').dispatchEvent(event)

    // Without this the drop never arrives and dragging silently does nothing —
    // green in jsdom, dead in a browser.
    expect(preventDefault).toHaveBeenCalled()
  })

  it('leaves the drop target enabled, or the browser suppresses the drop', () => {
    // **A drag begins without a click, so nothing is selected when it starts.**
    // A `disabled` button receives no pointer or drag events in Chromium,
    // Firefox or Safari, so `preventDefault` never runs and `drop` never fires:
    // the accelerator is dead in a browser and passing here, because jsdom
    // dispatches synthetic events to disabled elements regardless.
    //
    // Structural rather than behavioural on purpose — jsdom cannot reproduce
    // the suppression, so a test that dragged and asserted success would pass
    // either way. Found by Argus on this task's diff.
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    const target = field('Amount')

    expect(target.hasAttribute('disabled')).toBe(false)
    // Still announced as unavailable, and still reachable — which is the other
    // half of what `disabled` was costing.
    expect(target.getAttribute('aria-disabled')).toBe('true')
  })

  it('still refuses to pair when nothing is selected', () => {
    // The guard `disabled` was providing has to survive its removal.
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    fireEvent.click(field('Amount'))

    expect(field('Amount').textContent).toContain('no column yet')
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('carries the position, not the heading text', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    // Columns 2 and 4 are both `amount`. Carrying the text would pair whichever
    // one a lookup found first — by keyboard it works, by drag it does not.
    drag(4, 'Amount')

    expect(field('Amount').textContent).toContain('Column 4')
    expect(field('Amount').textContent).not.toContain('Column 2')
  })
})

describe('a drop carrying nothing usable', () => {
  it('changes nothing and says nothing new', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)
    const before = surfaceText()

    const dataTransfer = transfer()
    dataTransfer.setData('text/plain', 'not-a-position')
    fireEvent.drop(field('Amount'), { dataTransfer })

    // `Number('not-a-position')` is `NaN`, and an unguarded handler pairs the
    // field to it — the field then reads "column NaN" and the mapping is broken
    // in a way nothing refuses.
    expect(surfaceText()).toEqual(before)
  })

  it('changes nothing when the drop carries an empty payload', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)
    const before = surfaceText()

    fireEvent.drop(field('Amount'), { dataTransfer: transfer() })

    expect(surfaceText()).toEqual(before)
  })
})
