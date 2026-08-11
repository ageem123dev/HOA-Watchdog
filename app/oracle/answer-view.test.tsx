// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AnswerView } from './answer-view'

/**
 * UX-DR11's three layers, and the argument they make.
 *
 * "Every Oracle answer renders in three layers, top to bottom: the answer, the
 * evidence table — always present, never collapsed — and the query disclosure,
 * collapsed, labelled with catalog entry and version."
 *
 * **The table is not optional**, and that is the product in miniature. A
 * treasurer never has to know to ask for evidence; it is already on screen. Only
 * the query, which most people will never open, is behind a disclosure.
 *
 * The spec is blunt about what this is for: "In a dispute, the table is what
 * gets read aloud — not the prose."
 */

const TURN = {
  question: 'What does 4B owe for 2026?',
  answer: 'Unit 4B owes $240.00 for 2026, having paid $1,000.00 of $1,240.00 assessed.',
  rows: [
    {
      unitNumber: '4B',
      assessmentYear: 2026,
      assessed: '1240.00',
      paid: '1000.00',
      balanceOutstanding: '240.00',
    },
  ],
  entryId: 'dues_status',
  version: 1,
  sql: 'select unit.unit_number as "unitNumber" from unit where id = $1',
}

afterEach(cleanup)

describe('the question stays visible', () => {
  it('shows the question the board member asked', () => {
    // UX-DR11: "The question remains visible while the answer resolves." A
    // reader must never be looking at an answer wondering what they asked.
    render(<AnswerView {...TURN} />)

    expect(screen.getByText(/What does 4B owe for 2026\?/)).toBeTruthy()
  })
})

describe('layer one: the answer', () => {
  it('renders the prose', () => {
    render(<AnswerView {...TURN} />)

    expect(screen.getByText(/Unit 4B owes \$240\.00 for 2026/)).toBeTruthy()
  })
})

describe('layer two: the evidence table, which is never collapsed', () => {
  it('is a table, present without any interaction', () => {
    render(<AnswerView {...TURN} />)

    expect(screen.getByRole('table')).toBeTruthy()
  })

  it('shows every column the rows carry', () => {
    render(<AnswerView {...TURN} />)

    for (const heading of ['unitNumber', 'assessmentYear', 'assessed', 'paid', 'balanceOutstanding']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(heading, 'i') })).toBeTruthy()
    }
  })

  it('shows every value, so a figure in the prose can be found beneath it', () => {
    // "Every figure in the answer must be locatable in the table. If a number
    // appears in prose that a reader cannot find in the rows beneath it, that is
    // a defect, not a display choice."
    render(<AnswerView {...TURN} />)

    for (const value of ['4B', '1240.00', '1000.00', '240.00']) {
      expect(screen.getAllByText(value).length).toBeGreaterThan(0)
    }
  })

  it('renders a row for each result', () => {
    const rows = [TURN.rows[0]!, { ...TURN.rows[0]!, assessmentYear: 2025 }]

    render(<AnswerView {...TURN} rows={rows} />)

    // Header row plus two data rows.
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('shows a column that only a later row carries', () => {
    // Taking the first row's keys drops it silently, and a value missing from
    // the table is a figure in the prose a reader cannot find. Raised by
    // CodeRabbit.
    const rows = [{ unitNumber: '4B' }, { unitNumber: '9C', lateFee: '25.00' }]

    render(<AnswerView {...TURN} rows={rows} />)

    expect(screen.getByRole('columnheader', { name: /lateFee/i })).toBeTruthy()
    expect(screen.getByText('25.00')).toBeTruthy()
  })

  it('serializes a nested value rather than showing [object Object]', () => {
    // In a dispute this is the cell somebody reads aloud.
    const rows = [{ unitNumber: '4B', totals: { paid: '15.00' } }]

    render(<AnswerView {...TURN} rows={rows} />)

    expect(screen.queryByText('[object Object]')).toBeNull()
    expect(screen.getByText(/"paid":"15.00"/)).toBeTruthy()
  })

  it('says so plainly when a question has no matching rows', () => {
    // An empty table with headings and nothing under them reads as a loading
    // state. "No records matched" is an answer.
    render(<AnswerView {...TURN} rows={[]} />)

    expect(screen.getByText(/no records matched/i)).toBeTruthy()
  })
})

describe('layer three: the query disclosure', () => {
  it('is collapsed by default', () => {
    // UX-DR6. The query is the layer most people never open.
    render(<AnswerView {...TURN} />)

    expect(screen.queryByText(/select unit\.unit_number/)).toBeNull()
  })

  it('is labelled with the catalog entry and version', () => {
    // `dues_status@1` — the pair AD-14 freezes and AD-12 logs. A reader can take
    // that label to the access log and find this turn.
    render(<AnswerView {...TURN} />)

    expect(screen.getByText(/dues_status@1/)).toBeTruthy()
  })

  it('opens to the exact SQL', () => {
    render(<AnswerView {...TURN} />)

    fireEvent.click(screen.getByRole('button', { name: /query/i }))

    expect(screen.getByText(/select unit\.unit_number/)).toBeTruthy()
  })

  it('is operable from the keyboard, by being a real button', () => {
    // UX-DR6: "keyboard-operable with state announced".
    //
    // Asserted as *what it is* rather than by simulating a keypress. jsdom does
    // not translate Enter into a click the way a browser does, so
    // `fireEvent.keyDown` on a `<button>` proves nothing about keyboard
    // operability — it would pass just as well against a `<div onClick>`, which
    // is the thing this test exists to forbid. A native button carries Enter,
    // Space, focus order and the role for free; the only real assertion is that
    // it is one.
    render(<AnswerView {...TURN} />)
    const toggle = screen.getByRole('button', { name: /query/i })

    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle.getAttribute('type')).toBe('button')
  })

  it('points aria-controls at something that exists, or at nothing', () => {
    // A reference to an id absent from the document is a broken one, and a
    // screen reader following it lands nowhere. Raised by Argus.
    render(<AnswerView {...TURN} />)
    const toggle = screen.getByRole('button', { name: /query/i })

    expect(toggle.getAttribute('aria-controls')).toBeNull()

    fireEvent.click(toggle)

    const target = toggle.getAttribute('aria-controls')
    expect(target).toBe('oracle-query')
    expect(document.getElementById(target!)).not.toBeNull()
  })

  it('shows the rows exactly as the records carry them', () => {
    // Argus asked for `valueOf` here, and that would be wrong twice over:
    // `valueOf('1240.00')` is `124000` — it parses to minor units rather than
    // formatting — and `valueOf('4B')` throws, so the unit column would crash
    // the table. Pinned so the suggestion cannot be applied later without a
    // failing test.
    render(<AnswerView {...TURN} />)

    expect(screen.getAllByText('1240.00').length).toBeGreaterThan(0)
    expect(screen.queryByText('124000')).toBeNull()
    expect(screen.getAllByText('4B').length).toBeGreaterThan(0)
  })

  it('announces its state', () => {
    render(<AnswerView {...TURN} />)
    const toggle = screen.getByRole('button', { name: /query/i })

    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })

  it('closes again', () => {
    render(<AnswerView {...TURN} />)
    const toggle = screen.getByRole('button', { name: /query/i })

    fireEvent.click(toggle)
    fireEvent.click(toggle)

    expect(screen.queryByText(/select unit\.unit_number/)).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('the layers are in the order the spec fixes', () => {
  it('puts the answer above the table, and the table above the query', () => {
    // Order carries the argument: the claim, then its evidence, then how the
    // evidence was obtained. Asserted on document position rather than by
    // reading the markup, so a refactor that reorders them fails here.
    const { container } = render(<AnswerView {...TURN} />)

    const prose = screen.getByText(/Unit 4B owes \$240\.00 for 2026/)
    const table = screen.getByRole('table')
    const disclosure = screen.getByRole('button', { name: /query/i })

    const order = (node: Element) =>
      prose.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING

    expect(container.contains(prose)).toBe(true)
    expect(order(table)).toBeTruthy()
    expect(table.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
