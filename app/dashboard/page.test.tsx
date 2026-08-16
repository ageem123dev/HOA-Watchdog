// @vitest-environment jsdom

/**
 * The dashboard's route to the queue.
 *
 * `EXPERIENCE.md` lists the quarantine queue as entered from the dashboard "when
 * non-empty". This link is shown unconditionally instead, and the reason is
 * recorded in the story: a link that appears only when there is something behind
 * it is a surface a treasurer cannot learn, and the empty state exists precisely
 * to be readable. Hiding it would also make "nothing is waiting" and "I have
 * forgotten where that page is" the same experience.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { QUARANTINE_ROUTE, REGISTER_ROUTE } from '@/core/auth/route-policy'

const auth = vi.fn()
const unreviewed = vi.fn()
const checked = vi.fn()

vi.mock('@/adapters/auth/auth', () => ({
  auth: () => auth(),
  signOut: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  },
}))
vi.mock('@/adapters/db/finding-reader-postgres', () => ({
  createFindingReader: () => ({ unreviewed: (limit: number) => unreviewed(limit) }),
  createCheckedDocuments: () => ({ checked: () => checked() }),
}))

/** The shape the reader returns, as the page consumes it. */
function finding(id: string, findingType = 'possible_duplicate_invoice') {
  return {
    id,
    findingType,
    subjectId: 'doc-1',
    period: { from: '2026-04-01', until: '2026-05-01' },
    evidence: {
      invoicesChecked: 3,
      pairs: [{ reason: 'same-amount-and-date', vendorName: 'Coastal Landscaping', amount: '1450.00' }],
    },
    raisedOn: '2026-04-14',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  auth.mockResolvedValue({ user: { email: 'treasurer@example.com' } })
  unreviewed.mockResolvedValue({ findings: [], total: 0 })
  checked.mockResolvedValue({ count: 14, latestUploadOn: '2026-04-13' })
})

afterEach(() => {
  cleanup()
  vi.resetModules()
})

async function renderDashboard() {
  const { default: DashboardPage } = await import('./page')
  render(await DashboardPage())
}

describe('the dashboard', () => {
  it('links to the quarantine queue', async () => {
    await renderDashboard()

    const link = screen.getByRole('link', { name: /waiting on you/i })

    // The literal, not the imported constant. Comparing the rendered href to
    // QUARANTINE_ROUTE compares the constant with itself: renaming the route
    // would move both sides together and the test would keep passing while every
    // link in the product pointed somewhere else.
    expect(link.getAttribute('href')).toBe('/quarantine')

    // And the constant is what the page is built from, so it has to agree with
    // the directory the route actually lives in.
    expect(QUARANTINE_ROUTE).toBe('/quarantine')
  })

  it('links to the reviewed register', async () => {
    // **UX-DR10 lists the register as part of this surface**, and until story
    // 4.7 there was nowhere for a reviewed finding to go. A record with no way
    // in is one nobody learns.
    await renderDashboard()

    const link = screen.getByRole('link', { name: /reviewed register/i })

    // The literal, for the reason above: comparing against the constant the
    // page is built from compares it with itself.
    expect(link.getAttribute('href')).toBe('/findings/register')
    expect(REGISTER_ROUTE).toBe('/findings/register')
  })

  it('links there whether or not anything is waiting', async () => {
    // The dashboard does not read the queue to decide, which is the point: this
    // page has no reason to query held vendor names, and a link whose presence
    // depends on a count is a link that vanishes exactly when someone goes
    // looking for the page they saw yesterday.
    await renderDashboard()

    // Asserting the count rather than mere presence. `getByRole` already throws
    // when nothing matches, so wrapping it in `toBeDefined()` reads as a check
    // and performs none — and the property actually worth pinning here is that
    // there is exactly one route in, not that some link exists.
    expect(screen.getAllByRole('link', { name: /waiting on you/i })).toHaveLength(1)
  })
})

describe('the ask field (story 3.6c, UX-DR7)', () => {
  it('is on the dashboard', async () => {
    await renderDashboard()

    expect(screen.getByRole('searchbox')).toBeTruthy()
  })

  it('comes before the other links, so a keyboard reaches it first', async () => {
    // EXPERIENCE.md: "reachable by keyboard from the top of the dashboard
    // without traversing every finding". Tab order follows DOM order, so this
    // is the accessibility requirement rather than a layout preference — and it
    // is the clause a later story adding UX-DR10's findings list above it would
    // silently break.
    //
    // Asserted on document position, so moving the markup fails here rather
    // than being noticed by somebody holding Tab.
    await renderDashboard()

    const field = screen.getByRole('searchbox')
    const queueLink = screen.getByRole('link', { name: /waiting on you/i })

    expect(field.compareDocumentPosition(queueLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('submits to the Oracle rather than back to the dashboard', async () => {
    // The one assertion that says this field does its job at all. A form with
    // no action posts to the current URL, which would reload the dashboard and
    // look, to a board member, like nothing happened.
    await renderDashboard()

    expect(screen.getByRole('search').getAttribute('action')).toBe('/oracle')
  })
})

describe('the unreviewed findings list (story 4.5, UX-DR10)', () => {
  it('shows what the register says needs review', async () => {
    unreviewed.mockResolvedValue({ findings: [finding('a')], total: 1 })

    await renderDashboard()

    expect(screen.getByText('Possible duplicate invoice — Coastal Landscaping')).toBeDefined()
  })

  it('comes after the ask field, so a keyboard reaches the field first', async () => {
    // **The clause the ask-field test above warned this story would break.**
    // EXPERIENCE.md wants the field "reachable by keyboard from the top of the
    // dashboard without traversing every finding", and tab order follows DOM
    // order — so where the list sits in the markup is the accessibility
    // requirement, not a layout preference.
    unreviewed.mockResolvedValue({ findings: [finding('a')], total: 1 })

    await renderDashboard()

    const field = screen.getByRole('searchbox')
    const list = screen.getByRole('list')

    expect(field.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('asks for a bounded page rather than the whole register', async () => {
    // The register is permanent and append-only. A page that read all of it
    // would get slower every year the association runs, and the adapter refuses
    // an unbounded request anyway.
    await renderDashboard()

    expect(unreviewed).toHaveBeenCalledTimes(1)
    const [limit] = unreviewed.mock.calls[0] as [number]
    expect(Number.isInteger(limit)).toBe(true)
    expect(limit).toBeGreaterThan(0)
    expect(limit).toBeLessThanOrEqual(200)
  })

  it('reads nothing at all when nobody is signed in', async () => {
    // **The guard runs before the read, matching `app/quarantine/page.tsx`.** A
    // page that queries the register and then redirects has already done the
    // work an unauthenticated visitor asked for.
    auth.mockResolvedValue(null)

    await expect(renderDashboard()).rejects.toThrow(/NEXT_REDIRECT/)

    expect(unreviewed).not.toHaveBeenCalled()
    expect(checked).not.toHaveBeenCalled()
  })
})

describe('the dashboard figures (story 4.5, UX-DR3)', () => {
  it('states how many need review and how many documents were checked', async () => {
    unreviewed.mockResolvedValue({ findings: [finding('a')], total: 7 })

    await renderDashboard()

    // "Unreviewed findings", not "Needs review". The figure counts the whole
    // queue, and `Needs review` is the label of the *loud* severity — a figure
    // block wearing it would read as a count of those alone, and it would
    // collide with the row labels beneath it in the same breath.
    expect(screen.getByText('Unreviewed findings')).toBeDefined()
    expect(screen.getByText('7')).toBeDefined()
    expect(screen.getByText('Documents checked')).toBeDefined()
    expect(screen.getByText('14')).toBeDefined()
  })

  it('states no figures at all before anything has been read', async () => {
    // Figures over an empty register are three zeroes and a claim about
    // nothing. The empty state says the one true thing instead.
    checked.mockResolvedValue({ count: 0, latestUploadOn: null })

    await renderDashboard()

    expect(screen.queryByText('Documents checked')).toBeNull()
    expect(screen.getByText(/nothing has been checked yet/i)).toBeDefined()
  })

  it('dates the figures when the newest document predates this month', async () => {
    // The page's clock, wired end to end. `today` is derived once in UTC and
    // passed down; nothing below it calls `new Date()`.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-14T12:00:00Z'))
    checked.mockResolvedValue({ count: 14, latestUploadOn: '2026-03-31' })

    await renderDashboard()

    // **Exactly two — one per figure block.** `toBeGreaterThan(0)` passes when
    // only one of them carries the date, which is the way this breaks: a figure
    // stated without its "as of" is a stale number presented as current, and
    // the page renders two figures from the same documents. Raised by
    // CodeRabbit.
    expect(screen.getAllByText(/as of 2026-03-31/)).toHaveLength(2)
  })

  it('leaves them undated while the newest document is from this month', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-14T12:00:00Z'))
    checked.mockResolvedValue({ count: 14, latestUploadOn: '2026-04-01' })

    await renderDashboard()

    expect(screen.queryByText(/as of/)).toBeNull()
  })

  it('takes the day from UTC, not from wherever the server happens to sit', async () => {
    // **This test was vacuous when first written and a mutation caught it.**
    // The original picked `latestUploadOn: '2026-04-01'`, where a UTC clock and
    // a local one both produce no "as of" — so "refused" and "did not apply"
    // were the same observable, which is story 4.3's defect in a new place.
    //
    // These values separate them. At 2026-04-01T02:00Z the UTC day is 1 April,
    // so the month starts that day and a document from 31 March is stale. Read
    // in any zone behind UTC the day is still 31 March, the month starts on the
    // 1st of March, and the same document looks current.
    //
    // Decisive on any runner not sitting at UTC+0 — and on one that is, the two
    // implementations are the same function, so there is nothing left to
    // distinguish.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-01T02:00:00Z'))
    checked.mockResolvedValue({ count: 14, latestUploadOn: '2026-03-31' })

    await renderDashboard()

    expect(screen.getAllByText(/as of 2026-03-31/)).toHaveLength(2)
  })

  it('takes the day from UTC for a server sitting east of it too', async () => {
    // The other half, and without it the pair is only decisive on a runner
    // *behind* UTC. At 2026-03-31T22:00Z the UTC day is still 31 March, so a
    // document from mid-March is inside the current month; read anywhere ahead
    // of UTC the day is already 1 April and the same document looks stale.
    //
    // CodeRabbit asked for the timezone to be forced instead. That does not
    // work here: `TZ` is ignored on this Windows host — measured, with
    // `getTimezoneOffset()` staying at 300 under `TZ=America/Los_Angeles`. Two
    // cases in opposite directions need no environment at all, and between them
    // one of the two fails on any runner that is not itself at UTC.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-31T22:00:00Z'))
    checked.mockResolvedValue({ count: 14, latestUploadOn: '2026-03-15' })

    await renderDashboard()

    expect(screen.queryByText(/as of/)).toBeNull()
  })
})
