// @vitest-environment jsdom

/**
 * The register as a board member reads it (AC1, AC2, AC3, AC7).
 *
 * The copy was decided in `core/findings/register-view.ts` and is asserted
 * there. What can only be checked by rendering is that the three states reach
 * the page as three different screens — and, above all, that the reassuring one
 * is never shown to somebody who searched.
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { FindingDetail, ReviewedRegister } from '@/core/ports/finding-reader'
import { findingRoute } from '@/core/auth/route-policy'
import { toRegisterView } from '@/core/findings/register-view'
import { RegisterList } from './register-list'

afterEach(cleanup)

function finding(overrides: Partial<FindingDetail> = {}): FindingDetail {
  return {
    id: '018f3a2b-4c5d-7e8f-9a0b-1c2d3e4f5a6b',
    findingType: 'possible_duplicate_invoice',
    subjectId: 'document-1',
    period: { from: '2026-04-01', until: '2026-05-01' },
    evidence: {
      invoicesChecked: 3,
      pairs: [{ reason: 'same-amount-and-date', vendorName: 'Coastal Landscaping', amount: '1450.00' }],
    },
    raisedOn: '2026-04-14',
    reviewed: { by: 'R. Mbeki', on: '2026-04-20' },
    ...overrides,
  }
}

function draw(
  findings: readonly FindingDetail[] = [finding()],
  total = findings.length,
  search?: string,
) {
  const register: ReviewedRegister = { findings, total }

  return render(<RegisterList view={toRegisterView(register, search)} />)
}

describe('AC7: the empty register explains itself', () => {
  it('says nothing has been reviewed yet', () => {
    draw([], 0)

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Nothing has been reviewed yet')
  })

  it('explains that findings arrive after review, rather than reporting a fault', () => {
    // EXPERIENCE.md asks for the explanation by name. An empty permanent record
    // on the day an association signs up is not an error and must not read as
    // one.
    draw([], 0)

    expect(document.body.textContent).toMatch(/after (a board member has )?review/i)
    expect(document.body.textContent).not.toMatch(/error|failed|problem|sorry/i)
  })
})

describe('AC3: a search that matched nothing is a different screen', () => {
  it('says the search found nothing', () => {
    draw([], 0, 'Coastal')

    expect(document.body.textContent).toMatch(/no reviewed findings match/i)
  })

  it('names what was searched for, so the reader can see the typo', () => {
    draw([], 0, 'Coastul')

    expect(document.body.textContent).toContain('Coastul')
  })

  it('never tells somebody who searched that nothing has been reviewed', () => {
    // **The defect the state union exists to prevent.** Reassurance about the
    // whole record, in answer to a question about one vendor.
    draw([], 0, 'Coastal')

    expect(document.body.textContent).not.toMatch(/nothing has been reviewed yet/i)
  })

  it('renders a searched-for string as text, whatever it contains', () => {
    const hostile = '<script>alert(1)</script>'

    draw([], 0, hostile)

    expect(screen.getByText(new RegExp(hostile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeDefined()
    expect(document.querySelector('script')).toBeNull()
  })
})

describe('AC1 and AC2: the entries', () => {
  it('lists one row per reviewed finding', () => {
    draw([finding(), finding({ id: 'second' })])

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('says who reviewed it and when', () => {
    draw()

    expect(document.body.textContent).toContain('Already reviewed by R. Mbeki on 2026-04-20.')
  })

  it('says what is known when the reviewer had no display name', () => {
    draw([finding({ reviewed: { by: null, on: '2026-04-20' } })])

    expect(document.body.textContent).toContain('Already reviewed on 2026-04-20.')
    expect(document.body.textContent).not.toMatch(/null|undefined/i)
  })

  it('carries the finding title and the evidence sentence', () => {
    draw()

    expect(document.body.textContent).toContain('Possible duplicate invoice — Coastal Landscaping')
    expect(document.body.textContent).toMatch(/1 of 3 invoices/)
  })

  it('links each row to its finding, exactly once', () => {
    // UX-DR4's rule, the same one story 4.6 asserted for the dashboard: the
    // whole row is the target and the amount is not a second one.
    draw()

    for (const item of screen.getAllByRole('listitem')) {
      expect(within(item).getAllByRole('link')).toHaveLength(1)
    }
  })

  it('links to the finding it is about', () => {
    draw()

    expect(screen.getByRole('link').getAttribute('href')).toBe(
      '/findings/018f3a2b-4c5d-7e8f-9a0b-1c2d3e4f5a6b',
    )
  })

  it('agrees with the route helper about where that is', () => {
    // The literal above pins the shape; this pins that the page uses the one
    // helper rather than building its own path.
    draw()

    expect(screen.getByRole('link').getAttribute('href')).toBe(
      findingRoute('018f3a2b-4c5d-7e8f-9a0b-1c2d3e4f5a6b'),
    )
  })

  it('is a real list, so a screen reader can say how long it is', () => {
    draw()

    expect(screen.getByRole('list')).toBeDefined()
  })
})

describe('AC3: the register says when it is showing only part of itself', () => {
  it('says so when the register is longer than the page', () => {
    draw([finding()], 37)

    expect(document.body.textContent).toMatch(/showing the 1 most recent/i)
  })

  it('says nothing of the sort when it is showing all of them', () => {
    // Said only when true. A permanent record that always claims to be
    // truncated teaches a reader to ignore the one time it matters.
    draw([finding()], 1)

    expect(document.body.textContent).not.toMatch(/showing the/i)
  })

  it('states how many there are, which is what the auditor asked', () => {
    draw([finding()], 37)

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('37 reviewed findings')
  })

  it('uses the singular for one', () => {
    // Asserted on the heading rather than the page's text: `textContent` runs
    // the heading straight into the row beneath it, so a word-boundary check
    // reads "findingNeeds" and fails against copy that is correct.
    draw([finding()], 1)

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('1 reviewed finding')
  })
})
