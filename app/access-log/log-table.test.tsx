// @vitest-environment jsdom

/**
 * The access log surface, and the clause that is always skipped.
 *
 * UX-DR16: "empty and filtered-to-nothing states distinguished". A surface that
 * renders one "no results" for both tells a treasurer who filtered to a single
 * member that the association has never run a query.
 *
 * So each empty state asserts the *other* one's copy is absent. Story 3.7 made
 * this structural for the same reason: without it, one lump passes both tests.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LogTable } from './log-table'
import type { QueryLogRecord } from '@/core/ports/query-log-reader'

const RECORD: QueryLogRecord = {
  id: '018f-1',
  actorId: 'user-7',
  executedAt: new Date('2026-08-12T01:00:00.000Z'),
  entryId: 'dues_status',
  entryVersion: 1,
  parameters: { unitNumber: '4B', assessmentYear: 2026 },
  sqlText: 'select 1',
}

const NEVER_RUN = /no queries have been run yet/i
const NONE_MATCH = /no queries match this filter/i

afterEach(cleanup)

describe('AC4: the two empty states are different sentences', () => {
  it('says nothing has ever been run when nothing has', () => {
    render(<LogTable records={[]} filtered={false} />)

    expect(screen.getByText(NEVER_RUN)).toBeTruthy()
    expect(screen.queryByText(NONE_MATCH)).toBeNull()
  })

  it('says nothing matches the filter when a filter is in force', () => {
    // The same zero rows, and the opposite meaning. `filtered` is a prop rather
    // than something inferred from the rows, because the rows cannot tell you
    // which of these two facts you are looking at.
    render(<LogTable records={[]} filtered={true} />)

    expect(screen.getByText(NONE_MATCH)).toBeTruthy()
    expect(screen.queryByText(NEVER_RUN)).toBeNull()
  })

  it('tells the reader the filter is what is hiding the rest', () => {
    // Otherwise "no queries match this filter" is a dead end rather than
    // something a reader can act on.
    render(<LogTable records={[]} filtered={true} />)

    expect(screen.getByText(/clear the filter/i)).toBeTruthy()
  })
})

describe('AC1: who asked what, and when', () => {
  it('shows the actor, the entry and version, and the parameters', () => {
    render(<LogTable records={[RECORD]} filtered={false} />)

    expect(screen.getByText('user-7')).toBeTruthy()
    expect(screen.getByText(/dues_status@1/)).toBeTruthy()
    expect(screen.getByText(/4B/)).toBeTruthy()
  })

  it('shows the timestamp, and carries it machine-readably too', () => {
    // A locale string would sort wrongly and could be read as a different date
    // abroad. The `datetime` attribute is what anything parsing the page uses.
    const { container } = render(<LogTable records={[RECORD]} filtered={false} />)
    const time = container.querySelector('time')!

    // One call, not a `??` hedge across two spellings. `getAttribute` lowercases
    // the name for HTML elements, so the second branch could never run — an
    // unreachable fallback in a test reads as uncertainty about what the DOM
    // does, and hides which spelling is actually being asserted. Raised by
    // CodeRabbit.
    expect(time.getAttribute('datetime')).toBe('2026-08-12T01:00:00.000Z')
  })

  it('renders one row per record beneath the header', () => {
    render(<LogTable records={[RECORD, { ...RECORD, id: '018f-2' }]} filtered={false} />)

    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('is a real table with column headers, per UX-DR20', () => {
    // "Evidence tables carry real semantics — <table>, <th scope>, a caption
    // naming what it is. A screen-reader user must be able to navigate by
    // column, because that is the artifact under dispute."
    render(<LogTable records={[RECORD]} filtered={false} />)

    expect(screen.getByRole('table')).toBeTruthy()
    for (const heading of ['When', 'Who asked', 'What ran', 'With', 'Query']) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeTruthy()
    }
  })

  it('makes the exact SQL available per row, behind a disclosure', () => {
    // AC1: "the exact SQL is available per row - it is the column that makes the
    // record reproducible a year later". It was in the export only until the
    // close-out audit caught it.
    render(<LogTable records={[RECORD]} filtered={false} />)

    expect(screen.getByText('select 1')).toBeTruthy()
  })

  it('keeps the SQL collapsed, so it does not crowd out the scannable columns', () => {
    // The same argument UX-DR6 makes for the Oracle's query disclosure: it is the
    // widest value by far. `<details>` rather than a button because this is a
    // server component - it carries its own state, keyboard operation and
    // announced state with no JavaScript.
    const { container } = render(<LogTable records={[RECORD]} filtered={false} />)
    const details = container.querySelector('details')!

    expect(details).not.toBeNull()
    expect(details.open).toBe(false)
  })

  it('keeps the SQL inside the disclosure rather than loose in a cell', () => {
    // The previous version of this asserted no column was named `sqlText`,
    // which was never possible and so proved nothing — the vacuous-guard shape
    // this project has shipped ten times. Raised by CodeRabbit.
    //
    // What actually matters is containment: the SQL must sit *within* the
    // `<details>`, because that is what keeps it collapsed. A cell rendering it
    // beside the disclosure would satisfy every other test here — the text is
    // present, the details element exists and is closed — while putting the
    // widest value in the product back on screen.
    const { container } = render(<LogTable records={[RECORD]} filtered={false} />)
    const details = container.querySelector('details')!
    const sql = screen.getByText('select 1')

    expect(details.contains(sql)).toBe(true)
  })
})
