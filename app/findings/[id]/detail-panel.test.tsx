// @vitest-environment jsdom

/**
 * The finding, laid out (AC2, AC6).
 *
 * The copy was decided in `core/findings/detail-view.ts` and is asserted there.
 * What can only be checked by rendering is the markup UX-DR5 asks for: a real
 * `<table>` with `<th scope="col">`, numerics tabular and right-aligned. In a
 * dispute this table is the part that gets read aloud, and a grid of divs that
 * looks like a table is not one to anything that reads the page rather than
 * looking at it.
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { toFindingDetail } from '@/core/findings/detail-view'
import type { FindingDetail } from '@/core/ports/finding-reader'
import { FindingDetailPanel } from './detail-panel'

afterEach(cleanup)

// The `mark` spy below is module-scoped, so without this a call made by one
// test is still on it in the next. Nothing asserts on it today; that is exactly
// when this is cheap to add. Raised by CodeRabbit.
afterEach(() => {
  vi.clearAllMocks()
})

const mark = vi.fn(async () => ({ outcome: 'recorded' }) as const)

function finding(overrides: Partial<FindingDetail> = {}): FindingDetail {
  return {
    id: '018f3a2b-4c5d-7e8f-9a0b-1c2d3e4f5a6b',
    findingType: 'invoice_above_vendor_average',
    subjectId: 'document-1',
    period: { from: '2026-04-01', until: '2026-05-01' },
    evidence: {
      invoicesChecked: 4,
      thresholdPercent: 20,
      windowMonths: 6,
      spikes: [
        {
          percentOverAverage: '31.4',
          average: '900.00',
          invoicesAveraged: 6,
          vendorName: 'Harbour Plumbing',
          amount: '1183.00',
          invoiceNumber: 'INV-77',
          issuedOn: '2026-04-09',
        },
      ],
    },
    raisedOn: '2026-04-14',
    reviewed: null,
    ...overrides,
  }
}

function draw(record: FindingDetail = finding()) {
  return render(<FindingDetailPanel view={toFindingDetail(record)} markReviewed={mark} />)
}

describe('AC2: what was compared, laid out', () => {
  it('marks the evidence up as a real table', () => {
    draw()

    expect(screen.getByRole('table')).not.toBeNull()
  })

  it('gives every column a scoped header, so a cell can be read with its heading', () => {
    draw()

    const headers = screen.getAllByRole('columnheader')

    expect(headers.length).toBeGreaterThan(0)
    for (const header of headers) {
      expect(header.getAttribute('scope')).toBe('col')
    }
  })

  it('names what the table is of', () => {
    draw()

    expect(screen.getByRole('table').querySelector('caption')?.textContent).toMatch(/average/i)
  })

  it('shows the comparison with its own figures', () => {
    draw()

    const row = screen.getAllByRole('row')[1]!

    expect(row.textContent).toContain('Harbour Plumbing')
    expect(row.textContent).toContain('31.4%')
    expect(row.textContent).toContain('$900.00')
  })

  it('sets money and counts tabular and right-aligned', () => {
    draw()

    const cells = within(screen.getAllByRole('row')[1]!).getAllByRole('cell')
    const amount = cells.find((cell) => cell.textContent === '$1,183.00')

    expect(amount?.getAttribute('style')).toContain('right')
    expect(amount?.getAttribute('style')).toContain('tabular-nums')
  })

  it('leaves a cell empty rather than filling it with a dash or a zero', () => {
    // Both are marks a board member could read as a figure, manufactured from a
    // record that holds none.
    draw(
      finding({
        evidence: {
          windowMonths: 6,
          spikes: [{ vendorName: 'Harbour Plumbing', percentOverAverage: '31.4' }],
        },
      }),
    )

    const row = screen.getAllByRole('row')[1]!

    expect(row.textContent).not.toMatch(/—|--|\$0\.00|NaN|null|undefined/)
  })

  it('states the threshold and the window as figures of the check as a whole', () => {
    draw()

    expect(screen.getByText('Threshold')).not.toBeNull()
    expect(screen.getByText('20%')).not.toBeNull()
    expect(screen.getByText('6 months')).not.toBeNull()
  })

  it('draws no table at all when the evidence holds no comparisons', () => {
    // Headers over no rows say a comparison ran and matched nothing, which is
    // the opposite of what an absent `spikes` means.
    draw(finding({ evidence: { windowMonths: 6 } }))

    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows the row’s sentence and the date it was noticed', () => {
    draw()

    expect(screen.getByText(/31\.4% above a 6-month average/)).not.toBeNull()
    expect(screen.getByRole('main').querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-04-14',
    )
  })
})

describe('AC6: a finding somebody has already reviewed offers no action', () => {
  it('says who reviewed it and when', () => {
    draw(finding({ reviewed: { by: 'R. Mbeki', on: '2026-04-20' } }))

    expect(screen.getByRole('status').textContent).toBe('Already reviewed by R. Mbeki on 2026-04-20.')
  })

  it('offers nothing to press', () => {
    // Not an error — an ordinary outcome that someone got there first. A
    // control here would call `markReviewed` a second time, which is the call
    // migration 021's trigger refuses.
    draw(finding({ reviewed: { by: 'R. Mbeki', on: '2026-04-20' } }))

    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('still lays out the evidence, because the finding is what the page is about', () => {
    draw(finding({ reviewed: { by: 'R. Mbeki', on: '2026-04-20' } }))

    expect(screen.getByRole('table')).not.toBeNull()
  })

  it('offers the action while the finding is unreviewed', () => {
    draw()

    expect(screen.queryByRole('button', { name: /mark reviewed/i })).not.toBeNull()
  })
})
