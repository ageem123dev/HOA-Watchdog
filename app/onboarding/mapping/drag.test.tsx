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
import { ColumnPairing, DRAG_FORMAT } from './column-pairing'

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
    // **Under the format the component actually reads.** This said `text/plain`,
    // which the handler never looks at — so `getData` returned `''`, `Number('')`
    // is `0`, and the case exercised the `position < 1` branch while its comment
    // claimed to be testing `NaN`. The `Number.isInteger` guard had no test at
    // all. Raised by CodeRabbit.
    dataTransfer.setData(DRAG_FORMAT, 'not-a-position')
    fireEvent.drop(field('Amount'), { dataTransfer })

    // `Number('not-a-position')` is `NaN`. Unguarded, the field would pair to it
    // and read "column NaN" — a mapping broken in a way nothing refuses.
    expect(surfaceText()).toEqual(before)
  })

  it('refuses a position the file has not got, rather than ignoring it', () => {
    /**
     * The layering, asserted. The drop handler's own guard is only for a payload
     * that is not a position at all; an integer past the last column is a real
     * request that `assign` refuses, so the surface says so rather than silently
     * doing nothing. Written the other way round first, and the failure is what
     * showed the two cases are not the same case.
     */
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    const dataTransfer = transfer()
    dataTransfer.setData(DRAG_FORMAT, String(HEADINGS.length + 1))
    fireEvent.drop(field('Amount'), { dataTransfer })

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(field('Amount').textContent).toContain('no column yet')
  })

  it('changes nothing when the drop carries an empty payload', () => {
    render(<ColumnPairing kind="deposit" headings={HEADINGS} />)
    const before = surfaceText()

    fireEvent.drop(field('Amount'), { dataTransfer: transfer() })

    expect(surfaceText()).toEqual(before)
  })
})

describe('a second sample', () => {
  /**
   * **The mapping must not survive the file it was built against.**
   *
   * `MappingWizard` leaves the form on screen after a read, so a treasurer can
   * submit a different sample — a different kind, a different number of columns.
   * `useState`'s initialiser runs once, so the same `ColumnPairing` instance
   * would keep the old draft: pairings pointing at positions that now mean
   * different columns, and a `columns` bound belonging to the previous file.
   *
   * Silent, and wrong in the worst direction — the mapping looks finished.
   * Raised by CodeRabbit.
   */
  it('starts a new mapping when the sample changes', () => {
    const { rerender } = render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    fireEvent.click(column(2))
    fireEvent.click(field('Amount'))
    expect(field('Amount').textContent).toContain('Column 2')

    const other = readHeadings([
      ['When', 'Total'],
      ['2026-04-01', '10.00'],
    ])

    if (!other.ok) throw new Error('fixture is unreadable')

    rerender(<ColumnPairing kind="deposit" headings={other.headings} />)

    expect(field('Amount').textContent).toContain('no column yet')
    expect(screen.queryByRole('button', { name: /^Unpair / })).toBeNull()
  })

  it('bounds the new mapping by the new file, not the old one', () => {
    /**
     * **Asserted by trying it, not by counting buttons.** This first checked
     * which column buttons rendered — and those come from the `headings` prop,
     * not from `draft.columns`, so a stale bound would have passed it while the
     * comment claimed otherwise. Raised by CodeRabbit, and it is the same
     * vacuity this story keeps finding: the assertion reached for the nearest
     * observable thing rather than the property.
     *
     * The property is that position 5 is no longer a column, so a drop carrying
     * it must be refused.
     */
    const { rerender } = render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    const other = readHeadings([
      ['When', 'Total'],
      ['2026-04-01', '10.00'],
    ])

    if (!other.ok) throw new Error('fixture is unreadable')
    expect(other.headings).toHaveLength(2)

    rerender(<ColumnPairing kind="deposit" headings={other.headings} />)

    const stale = transfer()
    stale.setData(DRAG_FORMAT, '5')
    fireEvent.drop(field('Amount'), { dataTransfer: stale })

    expect(field('Amount').textContent).toContain('no column yet')
    expect(screen.getByRole('alert')).toBeTruthy()

    // The inverse in the same block, or the refusal above would pass against a
    // surface that refuses everything.
    const valid = transfer()
    valid.setData(DRAG_FORMAT, '2')
    fireEvent.drop(field('Amount'), { dataTransfer: valid })

    expect(field('Amount').textContent).toContain('Column 2')
  })

  it('starts a new mapping when the kind changes', () => {
    const { rerender } = render(<ColumnPairing kind="deposit" headings={HEADINGS} />)

    fireEvent.click(column(2))
    fireEvent.click(field('Amount'))

    rerender(<ColumnPairing kind="assessment_roll" headings={HEADINGS} />)

    expect(field('Amount').textContent).toContain('no column yet')
  })
})
