// @vitest-environment jsdom

/**
 * The page's guard, and the order it happens in.
 *
 * `app/upload/page.tsx` calls this the second lock: the proxy already redirects
 * unauthenticated visitors, and the page checks again so that a carelessly
 * edited matcher pattern cannot expose a surface that reads member data. The
 * queue is a list of vendor names lifted off the association's invoices, so the
 * same rule applies.
 *
 * What is asserted beyond "it redirects" is that nothing was read first. A page
 * that fetches and then redirects still put the query on the wire.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PUBLIC_ROUTES, SIGN_IN_ROUTE } from '@/core/auth/route-policy'

const auth = vi.fn()
const held = vi.fn(async () => [])
const redirect = vi.fn((path: string) => {
  // The real `redirect` throws to unwind the render, and code after it never
  // runs. A mock that returns would let the page carry on and read the queue,
  // making this suite pass against a page that leaks.
  throw new Error(`NEXT_REDIRECT:${path}`)
})

vi.mock('@/adapters/auth/auth', () => ({ auth: () => auth() }))
vi.mock('@/adapters/db/quarantine-queue-postgres', () => ({
  createQuarantineQueue: () => ({ held }),
}))
vi.mock('next/navigation', () => ({ redirect: (path: string) => redirect(path) }))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.resetModules()
})

async function renderPage() {
  const { default: QuarantinePage } = await import('./page')
  return QuarantinePage()
}

describe('the quarantine page', () => {
  it('redirects a visitor with no session', async () => {
    auth.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN_ROUTE}`)
  })

  it('redirects a session that carries no user', async () => {
    // A distinct shape from "no session", and `app/upload/page.tsx` tells them
    // apart for the same reason: a session object with no user satisfies a
    // truthiness check on the session alone.
    auth.mockResolvedValue({})

    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN_ROUTE}`)
  })

  it('reads nothing before redirecting', async () => {
    // The assertion that makes the two above worth writing. Redirecting after
    // the read still sent the query, and the failure is invisible from the
    // browser.
    auth.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow()
    expect(held).not.toHaveBeenCalled()
  })

  it('reads the queue for a signed-in member', async () => {
    auth.mockResolvedValue({ user: { email: 'treasurer@example.com' } })

    await renderPage()

    expect(held).toHaveBeenCalledTimes(1)
    expect(redirect).not.toHaveBeenCalled()
  })

  it('is not in the public allow-list', async () => {
    // `PUBLIC_ROUTES` is an allow-list, so a new route is closed without an
    // entry anywhere. Asserted rather than reasoned about, because the property
    // that matters is that nobody adds one later.
    expect(PUBLIC_ROUTES).not.toContain('/quarantine')
    expect(PUBLIC_ROUTES).toEqual([SIGN_IN_ROUTE])
  })
})
