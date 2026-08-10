import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The proxy is where the policy is *applied*: where `isAuthenticated` is derived
 * and where the matcher decides what is even seen. Testing the pure policy
 * proves the rule; only these tests prove the rule is enforced.
 */

// `undefined` is in the type on purpose. Auth.js declares `req.auth` as
// `Session | null`, but the gate's job is to be right when the declaration is
// wrong — a version change or a callback returning nothing. Narrowing this to
// `| null` would make the fail-open case below unwritable, which is how the
// hole stayed open.
const sessionState: { session: { user: { id: string } } | null | undefined } = { session: null }

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

  /**
   * AD-15's tool endpoints authenticate with a service token, not a session, so
   * the session gate can only turn the agent away — a 307 to /sign-in it has no
   * way to satisfy. Excluded for structurally the same reason as /api/auth.
   *
   * The cost is that the route's own token check becomes the whole of the
   * protection for anything under this prefix, which is why the exclusion is
   * asserted to be exactly a prefix and nothing wider.
   */
  it.each(['/tools/v1/catalog/execute', '/tools/v1/anything/else', '/tools/v2/later'])(
    'does not guard the tool endpoint %s',
    (pathname) => {
      expect(matches(pathname)).toBe(false)
    },
  )

  /**
   * The anchoring. A route is not a tool endpoint because its path contains the
   * word — the matcher's own comment records an earlier version that anchored to
   * a suffix and left whole routes unguarded.
   */
  it.each([
    '/tools',
    '/toolsmith',
    '/tools-of-the-trade',
    '/x/tools/y',
    '/atools/v1',
    '/tools/ui',
    '/tools/v/thing',
    '/tools/version/one',
  ])(
    'still guards %s',
    (pathname) => {
      expect(matches(pathname)).toBe(true)
    },
  )
})

/**
 * Nothing user-facing may live behind the middleware exclusion.
 *
 * `tools/v\d+/` is outside the session gate, so a `page.tsx` placed under it
 * would be served to anyone. Narrowing the matcher further — to
 * `tools/v\d+/catalog/` — was the other option and it decays: every new tool
 * family would have to remember to extend it. This asserts the rule instead, so
 * it holds for tool families nobody has written yet.
 */
describe('nothing user-facing sits behind the exclusion', () => {
  it('has no page or layout anywhere under app/tools', async () => {
    const { readdir } = await import('node:fs/promises')
    const { join } = await import('node:path')

    const walk = async (dir: string, found: string[] = []): Promise<string[]> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) await walk(full, found)
        // `[jt]sx?`: tsconfig sets allowJs false so a page.js is invisible to tsc,
        // but Next.js still serves it — the exclusion would not care that it was
        // never type-checked.
        else if (/^(page|layout|template|default)\.[jt]sx?$/.test(entry.name)) found.push(full)
      }
      return found
    }

    await expect(walk(join(process.cwd(), 'app', 'tools'))).resolves.toEqual([])
  })
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

  /**
   * `request.auth` is typed `Session | null`, and the check used to be
   * `!== null`. If the auth layer ever yields `undefined` — a version change, a
   * callback returning nothing — that comparison is **true** and the gate opens.
   * Fail-open is the one direction this file must never fail in. Raised by
   * Argus on story 3.2.
   */
  it('treats an undefined session as unauthenticated, not as a member', async () => {
    sessionState.session = undefined

    const response = (await proxy(makeRequest('/dashboard'), undefined as never)) as NextResponse

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/sign-in')
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
