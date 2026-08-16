// @vitest-environment jsdom

/**
 * The register page's guard, and the order it happens in (AC6's sibling).
 *
 * The second lock every surface here carries. What is asserted beyond "it
 * redirects" is that **nothing was read first** — this page returns the
 * association's entire reviewed history, and a page that fetches and then
 * redirects has already put that on the wire.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PUBLIC_ROUTES, SIGN_IN_ROUTE } from '@/core/auth/route-policy'

const auth = vi.fn()
const registerRead = vi.fn(async () => ({ findings: [], total: 0 }))
const redirect = vi.fn((path: string) => {
  // The real `redirect` throws to unwind the render. A mock that returned would
  // let the page carry on and read the register, making this suite pass against
  // a page that leaks.
  throw new Error(`NEXT_REDIRECT:${path}`)
})

vi.mock('@/adapters/auth/auth', () => ({ auth: () => auth() }))
vi.mock('@/adapters/db/finding-reader-postgres', () => ({
  createFindingReader: () => ({ register: registerRead, unreviewed: vi.fn(), byId: vi.fn() }),
}))
vi.mock('next/navigation', () => ({ redirect: (path: string) => redirect(path) }))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.resetModules()
})

async function renderPage(params: Record<string, string | string[] | undefined> = {}) {
  const { default: RegisterPage } = await import('./page')

  return RegisterPage({ searchParams: Promise.resolve(params) })
}

describe('the route is protected, and the guard runs before the read', () => {
  it('redirects a visitor with no session', async () => {
    auth.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN_ROUTE}`)
  })

  it('redirects a session that carries no user', async () => {
    auth.mockResolvedValue({})

    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN_ROUTE}`)
  })

  it('redirects a session whose user has no id', async () => {
    // The id, not merely the user. A session without one otherwise reaches code
    // that refuses it, and the refusal surfaces as though the register were
    // unreachable rather than as a sign-in.
    auth.mockResolvedValue({ user: { email: 'board@example.org' } })

    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN_ROUTE}`)
  })

  it('reads no register for a visitor it turns away', async () => {
    // **The assertion this file exists for.** "It redirects" is satisfied by a
    // page that queries the whole reviewed history first and redirects after.
    auth.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow(/NEXT_REDIRECT/)
    expect(registerRead).not.toHaveBeenCalled()
  })

  it('is not on the public allow-list', () => {
    // Deny-by-default, with no prefix matching — so this stays closed unless
    // somebody adds it here on purpose.
    expect(PUBLIC_ROUTES).not.toContain('/findings/register')
    expect(PUBLIC_ROUTES).not.toContain('/findings')
  })
})

describe('the read is given what the URL asked for', () => {
  beforeEach(() => {
    auth.mockResolvedValue({ user: { id: 'member-1', email: 'board@example.org' } })
  })

  it('passes the search through to the register', async () => {
    await renderPage({ search: 'Coastal' })

    expect(registerRead).toHaveBeenCalledWith({ search: 'Coastal', limit: 50 })
  })

  it('asks for no search when the box was blank', async () => {
    await renderPage({ search: '   ' })

    expect(registerRead).toHaveBeenCalledWith({ limit: 50 })
  })

  it('honours a limit from the URL', async () => {
    await renderPage({ limit: '25' })

    expect(registerRead).toHaveBeenCalledWith({ limit: 25 })
  })

  it('renders rather than throwing when the register is empty', async () => {
    registerRead.mockResolvedValue({ findings: [], total: 0 })

    await expect(renderPage()).resolves.toBeDefined()
  })
})
