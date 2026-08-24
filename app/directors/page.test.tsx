// @vitest-environment jsdom

/**
 * The provisioning page's route guard (story 5.9).
 *
 * `PUBLIC_ROUTES` is an allow-list and the decision is deny-by-default, so a
 * route nobody thought about is closed rather than open. This is the second
 * lock, matching `app/upload/page.tsx` and the mapping step.
 *
 * It matters more here than on either of those. This page **creates
 * credentials**: a visitor who reached it without a session could add an account
 * to a board and then sign in as it. A page that renders because a matcher
 * pattern was edited carelessly is a privilege escalation, not a leak.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SIGN_IN_ROUTE } from '@/core/auth/route-policy'

const auth = vi.fn()

vi.mock('@/adapters/auth/auth', () => ({ auth: () => auth() }))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    // The real `redirect` throws to unwind the render, and nothing after it
    // runs. A mock that returned would let the page carry on and render.
    throw new Error(`NEXT_REDIRECT:${path}`)
  },
}))
vi.mock('./director-form', () => ({ DirectorForm: () => <div data-testid="form" /> }))

const page = async () => (await import('./page')).default

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.resetModules())

describe('adding a director is not public', () => {
  it('sends a signed-out visitor to sign in', async () => {
    auth.mockResolvedValue(null)

    // The route, not merely *a* redirect: a page sending a signed-out visitor
    // somewhere else entirely would satisfy a looser assertion.
    await expect((await page())()).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN_ROUTE}`)
  })

  it('sends a session with no user to sign in', async () => {
    auth.mockResolvedValue({})

    await expect((await page())()).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN_ROUTE}`)
  })

  it('sends a session whose user is explicitly null to sign in', async () => {
    auth.mockResolvedValue({ user: null })

    await expect((await page())()).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN_ROUTE}`)
  })

  it('renders for a signed-in director', async () => {
    /**
     * The control. Without it every assertion above is satisfied by a page that
     * redirects unconditionally — which would pass the guard tests and make the
     * feature unreachable.
     */
    auth.mockResolvedValue({ user: { id: 'director-1' } })

    await expect((await page())()).resolves.toBeTruthy()
  })
})
