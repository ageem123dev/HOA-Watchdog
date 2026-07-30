import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The proxy is where the policy is *applied*: where `isAuthenticated` is derived,
 * where the matcher decides what is even seen, and where the response object
 * carrying refreshed session cookies is chosen. Testing the pure policy proves
 * the rule; only these tests prove the rule is enforced.
 */

interface WritableCookie {
  name: string
  value: string
  options?: Record<string, unknown>
}

const authState: { user: { id: string } | null; cookiesToWrite: WritableCookie[] } = {
  user: null,
  cookiesToWrite: [],
}

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: { setAll: (cookies: WritableCookie[]) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        // The real client rotates cookies through setAll during a silent
        // refresh. That write is the thing most easily lost on a redirect.
        if (authState.cookiesToWrite.length > 0) options.cookies.setAll(authState.cookiesToWrite)
        return { data: { user: authState.user } }
      },
    },
  }),
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
    '/register',
    '/some/route/nobody/has/written/yet',
  ])('guards %s', (pathname) => {
    expect(matches(pathname)).toBe(true)
  })

  /**
   * The first version of this matcher excluded `.*\.(svg|png|…)$`, which matches
   * any *route* whose path happens to end in an image suffix — not only files
   * under /public. A document preview at /api/documents/42/preview.png would
   * have shipped completely unauthenticated with nothing failing.
   */
  it.each([
    '/api/documents/42/preview.png',
    '/findings/7f3a/chart.svg',
    '/anything/not/a/route.png',
    '/export/register.jpeg',
  ])('guards %s — a route is not a static asset merely because it ends in an image suffix', (pathname) => {
    expect(matches(pathname)).toBe(true)
  })

  it.each([
    '/_next/static/chunks/main.js',
    '/_next/image',
    '/favicon.ico',
    '/robots.txt',
    '/sitemap.xml',
    '/.well-known/security.txt',
  ])('does not run for %s', (pathname) => {
    expect(matches(pathname)).toBe(false)
  })
})

describe('proxy', () => {
  beforeEach(() => {
    authState.user = null
    authState.cookiesToWrite = []
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
  })

  it('redirects an unauthenticated visitor to sign-in with their destination remembered', async () => {
    const response = await proxy(makeRequest('/dashboard'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://watchdog.example/sign-in?next=%2Fdashboard',
    )
  })

  it('lets an authenticated member through', async () => {
    authState.user = { id: 'member' }

    const response = await proxy(makeRequest('/dashboard'))

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('carries refreshed session cookies out on an allowed response', async () => {
    authState.user = { id: 'member' }
    authState.cookiesToWrite = [{ name: 'sb-auth-token', value: 'rotated', options: { path: '/' } }]

    const response = await proxy(makeRequest('/dashboard'))

    expect(response.cookies.get('sb-auth-token')?.value).toBe('rotated')
  })

  /**
   * The failure this guards is silent and intermittent: Supabase rotates the
   * refresh token during getUser(), the redirect throws the new cookie away, and
   * the browser keeps a token that has already been consumed. The member is
   * signed out on some later navigation with nothing to point at.
   */
  it('carries refreshed session cookies out on a redirect too', async () => {
    authState.user = { id: 'member' }
    authState.cookiesToWrite = [{ name: 'sb-auth-token', value: 'rotated', options: { path: '/' } }]

    // An authenticated member landing on sign-in is redirected away — the exact
    // path on which a silent refresh is most likely to be discarded.
    const response = await proxy(makeRequest('/sign-in'))

    expect(response.status).toBe(307)
    expect(response.cookies.get('sb-auth-token')?.value).toBe('rotated')
  })

  it('carries session-clearing cookies out on a redirect, so a dead session is evicted', async () => {
    authState.cookiesToWrite = [{ name: 'sb-auth-token', value: '', options: { maxAge: 0 } }]

    const response = await proxy(makeRequest('/dashboard'))

    expect(response.status).toBe(307)
    expect(response.cookies.get('sb-auth-token')?.value).toBe('')
  })

  it('fails closed when Supabase is not configured, rather than opening the gate', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')

    const response = await proxy(makeRequest('/dashboard'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/sign-in')
  })
})
