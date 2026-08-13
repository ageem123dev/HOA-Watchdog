/**
 * What the dashboard is in, as one decision made once.
 *
 * AC7 is the reason this is a discriminated union and not three booleans on the
 * page. "Nothing has been checked" and "nothing needs your attention" are
 * different sentences with different actions behind them, and a page deciding
 * between them with `if (rows.length === 0)` gets the second one in both cases
 * — telling a board member their records are clear on the day they signed up.
 *
 * UX-DR24 is enforced structurally here too: the count is a field of the
 * reassuring state, so there is no way to reach that copy without one.
 */

import { describe, expect, it } from 'vitest'

import type { FindingRecord, UnreviewedQueue } from '../ports/finding-reader'
import type { DocumentsChecked } from '../ports/checked-documents'
import { toDashboardView } from './dashboard-view'

const TODAY = '2026-04-14'

function finding(id: string, raisedOn = '2026-04-10'): FindingRecord {
  return {
    id,
    findingType: 'unit_dues_shortfall',
    subjectId: 'unit-1',
    period: { from: '2026-01-01', until: '2027-01-01' },
    evidence: {},
    raisedOn,
  }
}

function queue(findings: readonly FindingRecord[], total = findings.length): UnreviewedQueue {
  return { findings, total }
}

function checked(count: number, latestUploadOn: string | null): DocumentsChecked {
  return { count, latestUploadOn }
}

describe('when nothing has been checked', () => {
  it('says so, and does not reassure', () => {
    // The before-first-use state. "Nothing needs your attention" would be true
    // and useless here — the system has looked at nothing, and a board member
    // reading it as an all-clear is exactly what UX-DR24 forbids.
    const view = toDashboardView(queue([]), checked(0, null), TODAY)

    expect(view.kind).toBe('nothing-checked')
  })

  it('is still that state when documents are uploaded but none are read yet', () => {
    // Extraction is asynchronous, so there is a window where documents exist
    // and nothing has been examined. The count is what the copy rests on, and
    // it is zero, so the reassuring state is unavailable — deliberately, and
    // this is the boundary between the two.
    const view = toDashboardView(queue([]), checked(0, '2026-04-13'), TODAY)

    expect(view.kind).toBe('nothing-checked')
  })
})

describe('when everything checked is clear', () => {
  it('carries the count, because the copy is not allowed without it', () => {
    // **UX-DR24, made structural.** The count is a field of this state rather
    // than something the page looks up, so "Nothing needs your attention" and
    // "14 documents checked" cannot come apart.
    const view = toDashboardView(queue([]), checked(14, '2026-04-13'), TODAY)

    expect(view).toMatchObject({ kind: 'nothing-to-review', documentsChecked: 14 })
  })
})

describe('when there are findings', () => {
  it('never reassures because the window came back empty', () => {
    // **The one way this module could tell a lie a board member would act on.**
    // Deciding emptiness from the rows handed over rather than from the
    // register total means any disagreement between the two — a zero `limit`,
    // a finding reviewed between the count and the select — renders "nothing
    // needs your attention" over an outstanding queue.
    //
    // Showing a findings state with no rows in it is visibly wrong, which is
    // the right way to fail here. Reassurance is not.
    const view = toDashboardView(queue([], 3), checked(9, '2026-04-13'), TODAY)

    expect(view.kind).toBe('findings')
    expect(view).toMatchObject({ total: 3 })
  })

  it('carries the rows, the true total and the count checked', () => {
    const view = toDashboardView(queue([finding('a'), finding('b')]), checked(9, '2026-04-13'), TODAY)

    expect(view).toMatchObject({ kind: 'findings', total: 2, documentsChecked: 9 })
    expect(view.kind === 'findings' && view.rows.map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('reports the register total, not the number of rows it was handed', () => {
    // **The misleading-surface case the port was shaped to prevent.** The
    // dashboard is a bounded window; if it showed 2 under a figure reading 2
    // while 37 were outstanding, a board member would reasonably believe they
    // had seen everything.
    const view = toDashboardView(queue([finding('a'), finding('b')], 37), checked(9, '2026-04-13'), TODAY)

    expect(view).toMatchObject({ total: 37 })
    expect(view.kind === 'findings' && view.rows).toHaveLength(2)
  })

  it('keeps the order the register gave it', () => {
    // The adapter fixes the order — newest first, with a tie-break — and a
    // second answer here would be a second sort nobody could see. Same
    // argument `core/quarantine/queue-view.ts` makes.
    const view = toDashboardView(
      queue([finding('c', '2026-04-12'), finding('a', '2026-04-11'), finding('b', '2026-04-11')]),
      checked(9, '2026-04-13'),
      TODAY,
    )

    expect(view.kind === 'findings' && view.rows.map((row) => row.id)).toEqual(['c', 'a', 'b'])
  })

  it('is the findings state even when nothing has been read', () => {
    // A finding without a read document should not be reachable, but if the
    // register holds one, showing it beats hiding it behind an empty state
    // that says nothing was checked.
    const view = toDashboardView(queue([finding('a')]), checked(0, null), TODAY)

    expect(view.kind).toBe('findings')
  })
})

describe('the "as of" date on the figures', () => {
  it('is absent while the newest document is from the current month', () => {
    // UX-DR3 requires the date "whenever underlying documents predate the
    // current period". Within the period it would be noise on every figure on
    // the page, which is how a warning stops being read.
    const view = toDashboardView(queue([]), checked(3, '2026-04-01'), TODAY)

    expect(view.kind === 'nothing-to-review' && view.asOf).toBeNull()
  })

  it('appears when the newest document is from before this month', () => {
    const view = toDashboardView(queue([]), checked(3, '2026-03-31'), TODAY)

    expect(view.kind === 'nothing-to-review' && view.asOf).toBe('2026-03-31')
  })

  it.each([
    { latest: '2026-04-01', asOf: null, why: 'the first day of the current month is inside it' },
    { latest: '2026-03-31', asOf: '2026-03-31', why: 'the last day of the previous month is outside' },
  ])('has asOf $asOf when the newest is $latest, because $why', ({ latest, asOf }) => {
    // The boundary itself, either side. An off-by-one here labels every figure
    // on the first of the month, or none of them on the last.
    const view = toDashboardView(queue([finding('a')]), checked(3, latest), TODAY)

    expect(view.kind === 'findings' && view.asOf).toBe(asOf)
  })

  it('is absent when no document has ever arrived', () => {
    const view = toDashboardView(queue([finding('a')]), checked(0, null), TODAY)

    expect(view.kind === 'findings' && view.asOf).toBeNull()
  })

  it('refuses a date that is not a calendar date', () => {
    // `today` comes from the page, not from a document, so this is a
    // programming error rather than bad data — and it fails loudly for that
    // reason. Compared as a string, `2026-4-14` sorts *below* `2026-03-31`,
    // so a malformed clock would silently stop labelling anything as stale.
    expect(() => toDashboardView(queue([]), checked(3, '2026-03-31'), '2026-4-14')).toThrow(RangeError)
  })
})
