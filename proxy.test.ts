import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The proxy is where the policy is *applied*: where `isAuthenticated` is derived
 * and where the matcher decides what is even seen. Testing the pure policy
 * proves the rule; only these tests prove the rule is enforced.
 */

const sessionState: { session: { user: { id: string } } | null } = { session: null }

/**
 * Stands in for Auth.js's `auth` wrapper, which in production verifies the
 * session cookie and attaches the result as `request.auth`.
 */
vi.mock('./adapters/auth/auth', () => ({
  auth: (handler: (request: NextRequest & { auth: unknown }) => Response) => (request: NextRequest) =>
    handler(Object.assign(request, { auth: sessionState.session })),
}))

const { config, proxy } = await import('./proxy')

const makeRequest = (pathname: string) =>
  new NextRequest(new URL(pathname, 'https://watchdog.example'))

describe('config.matcher', () => {
  // Next.js matches a `config.matcher` entry against the whole pathname, so the
  // pattern is anchored here too. Testing it unanchored would let a pattern pass
  // that matches a substring and guards nothing it claims to.
  const matches = (pathname: string) =>
    new RegExp(`^${config.matcher[0] as string}$`).test(pathname)

  it.each([
    '/',
    '/dashboard',
    '/sign-in',
    '/upload',
    '/findings/7f3a',
    '/api/tools/dues-status',
    '/some/route/nobody/has/written/yet',
  ])('guards %s', (pathname) => {
    expect(matches(pathname)).toBe(true)
  })

  /**
   * A route is not a static asset merely because its path ends in an image
   * suffix. An earlier matcher excluded `.*\.(svg|png|…)$` and would have served
   * a document preview at /api/documents/42/preview.png unauthenticated.
   */
  it.each([
    '/api/documents/42/preview.png',
    '/findings/7f3a/chart.svg',
    '/export/register.jpeg',
  ])('guards %s', (pathname) => {
    expect(matches(pathname)).toBe(true)
  })

  it.each([
    '/_next/static/chunks/main.js',
    '/favicon.ico',
    '/robots.txt',
    '/.well-known/security.txt',
  ])('does not run for %s', (pathname) => {
    expect(matches(pathname)).toBe(false)
  })

  /**
   * Auth.js serves sign-in and callback endpoints under /api/auth. Guarding them
   * would redirect the sign-in POST to sign-in, making authentication impossible
   * — a deadlock that would look like "the password is wrong".
   */
  it.each(['/api/auth/session', '/api/auth/callback/credentials', '/api/auth/csrf'])(
    'does not guard the Auth.js endpoint %s',
    (pathname) => {
      expect(matches(pathname)).toBe(false)
    },
  )
})

describe('proxy', () => {
  beforeEach(() => {
    sessionState.session = null
  })

  it('redirects an unauthenticated visitor to sign-in with their destination remembered', async () => {
    const response = (await proxy(makeRequest('/dashboard'), undefined as never)) as NextResponse

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://watchdog.example/sign-in?next=%2Fdashboard',
    )
  })

  it('lets an authenticated member through', async () => {
    sessionState.session = { user: { id: 'member-1' } }

    const response = (await proxy(makeRequest('/dashboard'), undefined as never)) as NextResponse

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('lets an unauthenticated visitor reach sign-in', async () => {
    const response = (await proxy(makeRequest('/sign-in'), undefined as never)) as NextResponse

    expect(response.status).toBe(200)
  })

  it('sends an authenticated member away from sign-in', async () => {
    sessionState.session = { user: { id: 'member-1' } }

    const response = (await proxy(makeRequest('/sign-in'), undefined as never)) as NextResponse

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://watchdog.example/dashboard')
  })

  it.each(['/upload', '/register', '/api/tools/dues-status', '/anything/at/all'])(
    'guards %s against an unauthenticated visitor',
    async (pathname) => {
      const response = (await proxy(makeRequest(pathname), undefined as never)) as NextResponse

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('/sign-in')
    },
  )
})
