/**
 * Who may see what, decided as a pure function.
 *
 * The policy lives here rather than in middleware so it can be tested without a
 * running server, and so the middleware has no judgement of its own to get wrong.
 * Nothing in this module imports Next.js, reads a cookie, or performs I/O.
 */

export const SIGN_IN_ROUTE = '/sign-in'
export const DEFAULT_SIGNED_IN_ROUTE = '/dashboard'

/**
 * The complete set of routes reachable without a session. This is an allow-list,
 * and the decision below is deny-by-default: a route nobody thought about is
 * protected, not exposed. Adding to this list is how a surface becomes public —
 * there is no other way, and there is deliberately no prefix matching, because
 * prefix matching is how `/sign-in-secretly` becomes reachable.
 */
export const PUBLIC_ROUTES: readonly string[] = [SIGN_IN_ROUTE]

export type RouteDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'redirect'; readonly to: string }

/** `scheme:` at the start — `http:`, `javascript:`, `data:`. */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

const DELETE_CODE_POINT = 0x7f
const FIRST_PRINTABLE_CODE_POINT = 0x20

/**
 * Written as a code-point scan rather than a regex character class: the class
 * would need literal control characters or escapes in the source, and a control
 * character embedded in a source file is a hazard in its own right.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code < FIRST_PRINTABLE_CODE_POINT || code === DELETE_CODE_POINT) return true
  }
  return false
}

/** Trailing slashes are cosmetic; `/sign-in` and `/sign-in/` are one route. */
function normalisePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}

export function isPublicRoute(pathname: string): boolean {
  if (typeof pathname !== 'string') {
    throw new TypeError('isPublicRoute expects a pathname string')
  }
  return PUBLIC_ROUTES.includes(normalisePathname(pathname))
}

export function routeDecision(input: {
  readonly pathname: string
  readonly isAuthenticated: boolean
}): RouteDecision {
  const { pathname, isAuthenticated } = input

  if (typeof pathname !== 'string') {
    throw new TypeError('routeDecision expects a pathname string')
  }

  if (isPublicRoute(pathname)) {
    // A signed-in member has no business on sign-in; showing it again invites
    // them to authenticate over a session they already hold.
    return isAuthenticated ? { kind: 'redirect', to: DEFAULT_SIGNED_IN_ROUTE } : { kind: 'allow' }
  }

  if (isAuthenticated) return { kind: 'allow' }

  return {
    kind: 'redirect',
    to: `${SIGN_IN_ROUTE}?next=${encodeURIComponent(pathname)}`,
  }
}

/**
 * Narrows an arbitrary `?next=` value to something safe to redirect to.
 *
 * The parameter is attacker-controlled by construction — it arrives in a URL
 * anyone can craft and hand to a board member. Only a same-origin absolute path
 * survives; everything else becomes the fallback rather than an error, because a
 * hostile target should send the member somewhere sensible, not show them a page
 * about their own attempted redirection.
 */
export function safeRedirectTarget(raw: string | null | undefined, fallback: string): string {
  if (raw === null || raw === undefined) return fallback

  if (typeof raw !== 'string') {
    throw new TypeError('safeRedirectTarget expects a string target')
  }

  if (raw === '') return fallback
  if (hasControlCharacter(raw)) return fallback
  if (HAS_SCHEME.test(raw)) return fallback

  // Must be an absolute path, and must not be protocol-relative. Browsers treat
  // a leading `/\` the same as `//`, so both forms are rejected.
  if (!raw.startsWith('/')) return fallback
  if (raw[1] === '/' || raw[1] === '\\') return fallback

  const pathname = normalisePathname(raw.split(/[?#]/)[0] ?? '')
  if (pathname === SIGN_IN_ROUTE) return fallback

  return raw
}
