// @vitest-environment jsdom

/**
 * The access log page: its guard, and whether its filter boxes tell the truth.
 *
 * The guard matters more here than on most surfaces. This page renders the
 * record of every question every board member has asked — it is the one place
 * where one member's activity is visible to another, and the only thing between
 * it and an anonymous caller is the check below.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SIGN_IN_ROUTE } from '@/core/auth/route-policy'

const auth = vi.fn()
const recent = vi.fn()
const redirect = vi.fn((path: string) => {
  // The real `redirect` throws to unwind the render, and code after it never
  // runs. A mock that returned would let the page carry on and read the audit
  // trail, making this suite pass against a page that leaks it.
  throw new Error(`NEXT_REDIRECT:${path}`)
})

vi.mock('@/adapters/auth/auth', () => ({ auth: () => auth() }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => redirect(path) }))
vi.mock('@/adapters/db/query-log-reader-postgres', () => ({
  createQueryLogReader: () => ({ recent }),
}))

const RECORD = {
  id: '018f-1',
  actorId: 'user-7',
  executedAt: new Date('2026-08-12T01:00:00.000Z'),
  entryId: 'dues_status',
  entryVersion: 1,
  parameters: { unitNumber: '4B' },
  sqlText: 'select 1',
}

beforeEach(() => {
  vi.resetAllMocks()
  recent.mockResolvedValue([RECORD])
})

afterEach(cleanup)

async function renderPage(params: Record<string, string | string[]> = {}) {
  const { default: AccessLogPage } = await import('./page')
  return AccessLogPage({ searchParams: Promise.resolve(params) })
}

describe('AC7: who may read the audit trail', () => {
  it('redirects a visitor with no session, and reads nothing', async () => {
    auth.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN_ROUTE}`)
    // The assertion that matters. A page that queried and *then* redirected has
    // still pulled the whole trail out of the database.
    expect(recent).not.toHaveBeenCalled()
  })

  it('redirects a session carrying no id', async () => {
    // Story 3.6b's finding: `session.user` alone is not enough.
    auth.mockResolvedValue({ user: { email: 'treasurer@example.com' } })

    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN_ROUTE}`)
    expect(recent).not.toHaveBeenCalled()
  })

  it('lets a signed-in board member through', async () => {
    // The positive control in the same breath: a page that redirected everyone
    // would satisfy both tests above.
    auth.mockResolvedValue({ user: { id: 'user-7' } })

    render(await renderPage())

    expect(screen.getByRole('table')).toBeTruthy()
    expect(recent).toHaveBeenCalled()
  })
})

describe('the filter', () => {
  beforeEach(() => {
    auth.mockResolvedValue({ user: { id: 'user-7' } })
  })

  it('passes the URL filter to the query, not to the browser', async () => {
    // AC3. A surface that fetched everything and hid part of it has still put
    // the whole trail on the wire.
    render(await renderPage({ actorId: 'user-9' }))

    expect(recent).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'user-9' }))
  })

  it('tells the table a filter is in force, so the empty state is honest', async () => {
    // AC4's other half. With no rows and no `filtered`, the page would say the
    // association has never run a query.
    recent.mockResolvedValue([])

    render(await renderPage({ entryId: 'dues_status' }))

    expect(screen.getByText(/no queries match this filter/i)).toBeTruthy()
  })

  it('says nothing has ever run when nothing is filtered and nothing is there', async () => {
    recent.mockResolvedValue([])

    render(await renderPage())

    expect(screen.getByText(/no queries have been run yet/i)).toBeTruthy()
  })

  it('shows the current filter in the boxes', async () => {
    render(await renderPage({ actorId: 'user-9' }))

    expect((screen.getByLabelText(/who asked/i) as HTMLInputElement).value).toBe('user-9')
  })

  it('updates the boxes when the URL filter changes', async () => {
    // Uncontrolled inputs keep their DOM value across a re-render, so
    // `defaultValue` alone leaves a stale filter on screen after a soft
    // navigation — the back button, most obviously — while the URL and the rows
    // say something else. A `key` tied to the filter remounts them. Raised by
    // Argus.
    const { rerender } = render(await renderPage({ actorId: 'user-9' }))

    // Dirty the box first, which is what makes this the real scenario rather
    // than a re-render: a reader types, navigates, then comes back. An
    // uncontrolled input that React reuses keeps whatever is in the DOM, so
    // without the remount this half-typed text survives a navigation and sits
    // above rows it does not describe. Raised by CodeRabbit, and it is a
    // stronger test than the one it replaced.
    const before = screen.getByLabelText(/who asked/i) as HTMLInputElement
    before.value = 'half-typed'

    rerender(await renderPage({ actorId: 'user-3' }))

    expect((screen.getByLabelText(/who asked/i) as HTMLInputElement).value).toBe('user-3')
  })

  it('carries the limit through a filter submit', async () => {
    // A GET form submits only the fields it contains. Without a hidden input the
    // limit is dropped, so a reader who widened the page to 500 rows and then
    // filtered would silently fall back to 100 — and the rows that vanished
    // would look like the filter's doing rather than the form's. Raised by
    // Argus.
    const { container } = render(await renderPage({ limit: '500' }))
    const hidden = container.querySelector('input[name="limit"]') as HTMLInputElement

    expect(hidden).not.toBeNull()
    expect(hidden.value).toBe('500')
  })

  it('carries the filter into the export link, so the download matches the screen', async () => {
    render(await renderPage({ actorId: 'user-9' }))

    const link = screen.getByRole('link', { name: /download csv/i })
    expect(link.getAttribute('href')).toContain('actorId=user-9')
  })
})
