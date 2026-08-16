// @vitest-environment jsdom

/**
 * The finding page's guard, the order it happens in, and what an id that
 * resolves to nothing does (AC8, AC9).
 *
 * The second lock, as `app/quarantine/page.tsx` calls it: the proxy already
 * redirects unauthenticated visitors, and the page checks again so that a
 * carelessly edited matcher pattern cannot expose a surface that reads member
 * data. A finding names a vendor, an amount, and sometimes a member.
 *
 * What is asserted beyond "it redirects" is that **nothing was read first**. A
 * page that fetches and then redirects has already put the query on the wire,
 * and nothing visible from a browser would say so.
 */

import type { ReactElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PUBLIC_ROUTES, SIGN_IN_ROUTE, findingRoute } from '@/core/auth/route-policy'

const auth = vi.fn()
const byId = vi.fn(async () => null as unknown)
const redirect = vi.fn((path: string) => {
  // The real `redirect` throws to unwind the render, and code after it never
  // runs. A mock that returned would let the page carry on and read the
  // finding, making this suite pass against a page that leaks.
  throw new Error(`NEXT_REDIRECT:${path}`)
})
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})

vi.mock('@/adapters/auth/auth', () => ({ auth: () => auth() }))
vi.mock('@/adapters/db/finding-reader-postgres', () => ({
  createFindingReader: () => ({ byId, unreviewed: vi.fn() }),
}))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirect(path),
  notFound: () => notFound(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  vi.resetModules()
})

const FINDING = '018f3a2b-4c5d-7e8f-9a0b-1c2d3e4f5a6b'

async function renderPage(id = FINDING) {
  const { default: FindingPage } = await import('./page')
  return FindingPage({ params: Promise.resolve({ id }) })
}

describe('AC9: the route is protected, and the guard runs before the read', () => {
  it('redirects a visitor with no session', async () => {
    auth.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN_ROUTE}`)
  })

  it('redirects a session that carries no user', async () => {
    // A distinct shape from "no session": a session object with no user
    // satisfies a truthiness check on the session alone.
    auth.mockResolvedValue({})

    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN_ROUTE}`)
  })

  it('reads no finding for a visitor it turns away', async () => {
    // **The assertion this file exists for.** "It redirects" is satisfied by a
    // page that queries the register first and redirects afterwards, which has
    // already done the work an unauthenticated visitor asked for.
    auth.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow(/NEXT_REDIRECT/)
    expect(byId).not.toHaveBeenCalled()
  })

  it('is not on the public allow-list', async () => {
    // Deny-by-default, and there is deliberately no prefix matching — so this
    // stays closed unless somebody adds it here on purpose.
    expect(PUBLIC_ROUTES).not.toContain('/findings')
    expect(PUBLIC_ROUTES).not.toContain(findingRoute(FINDING))
  })
})

describe('AC8: an id that resolves to nothing is a 404', () => {
  beforeEach(() => {
    auth.mockResolvedValue({ user: { id: 'member-1', email: 'board@example.org' } })
  })

  it('does not render a page shaped like a finding when there is none', async () => {
    // A detail page with empty fields is a claim that a finding exists. The
    // reader answers `null` for an unknown id and for a malformed one alike,
    // and both are the same honest answer to "is there a finding here".
    byId.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('sends a malformed id to the same place', async () => {
    byId.mockResolvedValue(null)

    await expect(renderPage('not-a-uuid')).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('renders the finding when there is one, and calls notFound for nothing', async () => {
    // The success path, which nothing here asserted: every case above ends in a
    // throw, so the page could have been wrong about the ordinary outcome and
    // this file would still have been green. Raised by CodeRabbit.
    byId.mockResolvedValue({
      id: FINDING,
      findingType: 'possible_duplicate_invoice',
      subjectId: 'document-1',
      period: { from: '2026-04-01', until: '2026-05-01' },
      evidence: { invoicesChecked: 3, pairs: [{ vendorName: 'Coastal Landscaping' }] },
      raisedOn: '2026-04-14',
      reviewed: null,
    })

    const element = await renderPage()

    expect(notFound).not.toHaveBeenCalled()
    render(element as ReactElement)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Possible duplicate invoice — Coastal Landscaping',
    )
    expect(screen.queryByRole('button', { name: /mark reviewed/i })).not.toBeNull()
  })

  it('passes the id through to the reader exactly as the route gave it', async () => {
    byId.mockResolvedValue(null)

    await expect(renderPage(FINDING)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(byId).toHaveBeenCalledWith(FINDING)
  })
})
