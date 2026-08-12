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

    expect(time.getAttribute('dateTime') ?? time.getAttribute('datetime')).toBe(
      '2026-08-12T01:00:00.000Z',
    )
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
    for (const heading of ['When', 'Who asked', 'What ran', 'With']) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeTruthy()
    }
  })

  it('does not put the SQL in the table', () => {
    // Deliberate: the SQL is the widest column by far and would push the four
    // that a reader actually scans off the screen. It is in the export, which
    // is where a reader goes to reproduce a query rather than to scan the trail.
    render(<LogTable records={[RECORD]} filtered={false} />)

    expect(screen.queryByText('select 1')).toBeNull()
  })
})
