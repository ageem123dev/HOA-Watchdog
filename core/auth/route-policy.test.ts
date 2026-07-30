import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIGNED_IN_ROUTE,
  PUBLIC_ROUTES,
  SIGN_IN_ROUTE,
  isPublicRoute,
  routeDecision,
  safeRedirectTarget,
} from './route-policy'

/**
 * Surfaces this product will grow. None of them is public, and the point of
 * listing them is that the policy must protect a route before anyone remembers
 * to think about it.
 */
const PROTECTED_PATHS = [
  '/dashboard',
  '/oracle',
  '/upload',
  '/register',
  '/quarantine',
  '/access-log',
  '/findings/7f3a',
  '/api/tools/dues-status',
  '/some/route/nobody/has/written/yet',
]

describe('PUBLIC_ROUTES', () => {
  it('contains the sign-in route', () => {
    expect(PUBLIC_ROUTES).toContain(SIGN_IN_ROUTE)
  })

  it('is small enough to read — every entry here is a hole in the fence', () => {
    expect(PUBLIC_ROUTES.length).toBeLessThanOrEqual(2)
  })
})

describe('isPublicRoute', () => {
  it('recognises the sign-in route', () => {
    expect(isPublicRoute(SIGN_IN_ROUTE)).toBe(true)
  })

  it('tolerates a trailing slash on a public route', () => {
    expect(isPublicRoute('/sign-in/')).toBe(true)
  })

  it.each(PROTECTED_PATHS)('does not treat %s as public', (pathname) => {
    expect(isPublicRoute(pathname)).toBe(false)
  })

  it('does not match by prefix, so /sign-in-secretly is not public', () => {
    expect(isPublicRoute('/sign-in-secretly')).toBe(false)
  })

  it('does not match a path merely containing the public route', () => {
    expect(isPublicRoute('/admin/sign-in')).toBe(false)
  })

  it('is case-sensitive, so a case variant falls through to protected', () => {
    expect(isPublicRoute('/Sign-In')).toBe(false)
  })

  it('treats the empty pathname as protected', () => {
    expect(isPublicRoute('')).toBe(false)
  })

  it('treats a traversal-shaped pathname as protected', () => {
    expect(isPublicRoute('/sign-in/../dashboard')).toBe(false)
  })
})

describe('routeDecision', () => {
  it.each(PROTECTED_PATHS)('redirects an unauthenticated visitor away from %s', (pathname) => {
    const decision = routeDecision({ pathname, isAuthenticated: false })

    expect(decision.kind).toBe('redirect')
  })

  it('remembers where the visitor was headed', () => {
    const decision = routeDecision({ pathname: '/findings/7f3a', isAuthenticated: false })

    expect(decision).toEqual({
      kind: 'redirect',
      to: `${SIGN_IN_ROUTE}?next=%2Ffindings%2F7f3a`,
    })
  })

  it('lets an unauthenticated visitor reach sign-in', () => {
    expect(routeDecision({ pathname: SIGN_IN_ROUTE, isAuthenticated: false })).toEqual({
      kind: 'allow',
    })
  })

  it.each(PROTECTED_PATHS)('lets an authenticated member reach %s', (pathname) => {
    expect(routeDecision({ pathname, isAuthenticated: true })).toEqual({ kind: 'allow' })
  })

  it('sends an authenticated member away from sign-in rather than showing it again', () => {
    expect(routeDecision({ pathname: SIGN_IN_ROUTE, isAuthenticated: true })).toEqual({
      kind: 'redirect',
      to: DEFAULT_SIGNED_IN_ROUTE,
    })
  })

  it('protects the empty pathname rather than falling open', () => {
    expect(routeDecision({ pathname: '', isAuthenticated: false }).kind).toBe('redirect')
  })

  it('does not append a next parameter pointing back at sign-in', () => {
    const decision = routeDecision({ pathname: '/sign-in/', isAuthenticated: false })

    expect(decision).toEqual({ kind: 'allow' })
  })

  it('rejects a non-string pathname rather than deciding on nonsense', () => {
    expect(() => routeDecision({ pathname: undefined as never, isAuthenticated: false })).toThrow(
      TypeError,
    )
  })
})

describe('safeRedirectTarget', () => {
  const FALLBACK = DEFAULT_SIGNED_IN_ROUTE

  it('accepts an ordinary same-origin path', () => {
    expect(safeRedirectTarget('/register', FALLBACK)).toBe('/register')
  })

  it('accepts a path carrying a query string', () => {
    expect(safeRedirectTarget('/register?q=vendor', FALLBACK)).toBe('/register?q=vendor')
  })

  it.each([
    ['absent', null],
    ['undefined', undefined],
    ['empty', ''],
  ])('falls back when the target is %s', (_label, raw) => {
    expect(safeRedirectTarget(raw, FALLBACK)).toBe(FALLBACK)
  })

  it.each([
    ['a protocol-relative URL', '//evil.example/pwned'],
    ['a backslash protocol-relative URL', '/\\evil.example'],
    ['an absolute http URL', 'http://evil.example'],
    ['an absolute https URL', 'https://evil.example'],
    ['a scheme-only target', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,<script>alert(1)</script>'],
    ['a bare relative path', 'register'],
    ['a target with a newline', '/register\nSet-Cookie: a=b'],
    ['a target with a carriage return', '/register\rSet-Cookie: a=b'],
    ['a target with a tab', '/register\tmore'],
    ['a target with a null byte', '/register\u0000'],
  ])('falls back on %s', (_label, raw) => {
    expect(safeRedirectTarget(raw, FALLBACK)).toBe(FALLBACK)
  })

  it('falls back when the target is the sign-in route itself, which would bounce forever', () => {
    expect(safeRedirectTarget(SIGN_IN_ROUTE, FALLBACK)).toBe(FALLBACK)
  })

  it('falls back when the target is sign-in with a query string', () => {
    expect(safeRedirectTarget(`${SIGN_IN_ROUTE}?next=%2F`, FALLBACK)).toBe(FALLBACK)
  })

  it('round-trips a decision: the next parameter it emits is one it accepts back', () => {
    const decision = routeDecision({ pathname: '/quarantine', isAuthenticated: false })
    if (decision.kind !== 'redirect') throw new Error('expected a redirect')

    const next = new URLSearchParams(decision.to.split('?')[1]).get('next')

    expect(safeRedirectTarget(next, FALLBACK)).toBe('/quarantine')
  })

  it('rejects a non-string target rather than coercing it', () => {
    expect(() => safeRedirectTarget(42 as never, FALLBACK)).toThrow(TypeError)
  })
})
