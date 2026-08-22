// @vitest-environment jsdom

/**
 * What story 5.3 reported, shown where the mapping is built (story 5.4, AC8).
 *
 * Story 5.3's whole design was to *report* duplicates and blanks rather than
 * refuse them, and to carry two forms of every heading: the normalised one,
 * because that is what collides at ingestion, and the written one, because that
 * is what a treasurer can find in their spreadsheet.
 *
 * This is where that pair is spent. A report naming only `amount` sends someone
 * looking for a column their file does not contain — their file says `Amount`.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { readHeadings } from '@/core/extraction/headings'
import { ColumnPairing } from './column-pairing'

const SAMPLE: readonly (readonly string[])[] = [
  ['Date', 'Amount', '  ', 'amount', 'Unit'],
  ['2026-03-01', '1240.00', 'Willow Creek Landscaping', '99.00', '12B'],
]

const read = readHeadings(SAMPLE)

if (!read.ok) throw new Error(`fixture is unreadable: ${read.reason}`)

const { headings: HEADINGS, problems: PROBLEMS } = read

afterEach(cleanup)

const surface = (problems = PROBLEMS) =>
  render(<ColumnPairing kind="deposit" headings={HEADINGS} problems={problems} />)

const column = (position: number) =>
  screen.getByRole('button', { name: new RegExp(`^Column ${position}\\b`) })

const field = (label: string) =>
  screen.getByRole('button', { name: new RegExp(`^${label} — (required|optional)`) })

describe('the fixture is the file it claims to be', () => {
  it('reports one duplicate and one blank', () => {
    expect(PROBLEMS).toEqual([
      { reason: 'duplicate-heading', heading: 'amount', positions: [2, 4] },
      { reason: 'blank-heading', positions: [3] },
    ])
  })
})

describe('a duplicated heading', () => {
  it('names both positions', () => {
    surface()

    const notice = screen.getByTestId('heading-problems').textContent ?? ''

    expect(notice).toContain('Column 2')
    expect(notice).toContain('Column 4')
  })

  it('names each column as the treasurer wrote it, not as the importer folds it', () => {
    surface()

    const notice = screen.getByTestId('heading-problems').textContent ?? ''

    // `Amount` and `amount` — the two written forms. Reporting only the folded
    // `amount` sends them looking for a column their spreadsheet has not got.
    expect(notice).toContain('Amount')
    expect(notice).toMatch(/\bamount\b/)
  })
})

describe('a blank heading', () => {
  it('is named by its position, which is the only thing identifying it', () => {
    surface()

    expect(screen.getByTestId('heading-problems').textContent).toContain('Column 3')
  })
})

describe('reported, not refused', () => {
  it('leaves every column pairable, the duplicated and blank ones included', () => {
    surface()

    fireEvent.click(column(3))
    fireEvent.click(field('Description'))
    fireEvent.click(column(4))
    fireEvent.click(field('Reference'))

    // Story 5.3 refused nothing and neither does this. A treasurer whose export
    // has two `amount` columns still has a file worth mapping.
    expect(field('Description').textContent).toContain('Column 3')
    expect(field('Reference').textContent).toContain('Column 4')
  })

  it('says nothing at all when the file has no problems', () => {
    const clean = readHeadings([
      ['Date', 'Amount', 'Unit'],
      ['2026-03-01', '1240.00', '12B'],
    ])

    if (!clean.ok) throw new Error('fixture is unreadable')
    expect(clean.problems).toEqual([])

    render(<ColumnPairing kind="deposit" headings={clean.headings} problems={clean.problems} />)

    // The inverse, so the assertions above are not passing against a panel that
    // is always on screen saying something.
    expect(screen.queryByTestId('heading-problems')).toBeNull()
  })
})
