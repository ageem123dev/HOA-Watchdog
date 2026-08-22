// @vitest-environment jsdom

/**
 * The mapping step's route guard.
 *
 * `PUBLIC_ROUTES` is an allow-list and the decision is deny-by-default, so a
 * route nobody thought about is closed rather than open. This is the second
 * lock, matching `app/upload/page.tsx` — a page that reads a treasurer's file
 * must not render because a matcher pattern was edited carelessly.
 */

import { describe, expect, it, vi } from 'vitest'

const auth = vi.fn()

vi.mock('@/adapters/auth/auth', () => ({ auth: () => auth() }))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    // The real `redirect` throws to unwind the render, and nothing after it
    // runs. A mock that returned would let the page carry on and render.
    throw new Error(`NEXT_REDIRECT:${path}`)
  },
}))
vi.mock('./mapping-wizard', () => ({ MappingWizard: () => <div data-testid="wizard" /> }))

const page = async () => (await import('./page')).default

describe('the mapping step is not public', () => {
  it('sends a signed-out visitor to sign in', async () => {
    auth.mockResolvedValue(null)

    await expect((await page())()).rejects.toThrow(/NEXT_REDIRECT/)
  })

  it('sends a session with no user to sign in', async () => {
    auth.mockResolvedValue({})

    await expect((await page())()).rejects.toThrow(/NEXT_REDIRECT/)
  })

  it('renders the step for a signed-in treasurer', async () => {
    // The inverse, so the redirects above are not passing against a page that
    // redirects everyone.
    auth.mockResolvedValue({ user: { id: 'director-1' } })

    await expect((await page())()).resolves.toBeTruthy()
  })
})
