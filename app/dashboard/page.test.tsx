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

import { QUARANTINE_ROUTE } from '@/core/auth/route-policy'

const auth = vi.fn()

vi.mock('@/adapters/auth/auth', () => ({
  auth: () => auth(),
  signOut: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { email: 'treasurer@example.com' } })
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
