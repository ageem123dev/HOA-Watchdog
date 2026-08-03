import { NextResponse } from 'next/server'
import { auth } from './adapters/auth/auth'
import { routeDecision } from './core/auth/route-policy'

/**
 * The gate. It resolves the session and applies `core/auth/route-policy`, and it
 * holds no policy of its own — every decision about who may see what is a pure
 * function tested without a server, so the rule cannot drift from its tests.
 *
 * Named `proxy` in `proxy.ts`: Next.js 16 renamed the middleware file convention
 * and warns on the old one.
 *
 * Auth.js owns its own session cookie, so unlike the previous Supabase wiring
 * there is no refresh-and-reattach dance here — and with it goes the "the
 * redirect dropped the rotated cookie" defect the last review found.
 */
export const proxy = auth((request) => {
  const decision = routeDecision({
    pathname: request.nextUrl.pathname,
    // A token that fails verification arrives as null, so an unreadable or
    // tampered session falls through to unauthenticated rather than opening the gate.
    isAuthenticated: request.auth !== null,
  })

  if (decision.kind === 'redirect') {
    return NextResponse.redirect(new URL(decision.to, request.url))
  }

  return NextResponse.next()
})

export const config = {
  // Written as a literal because Next.js parses this statically at build time —
  // a reference to a constant fails the build. `proxy.test.ts` reads it back
  // from here, so the pattern under test is the pattern that ships.
  //
  // Anchored to prefixes and whole filenames, never to a suffix: an earlier
  // version excluded `.*\.(svg|png|…)$`, which unguarded any *route* whose path
  // merely ended in an image suffix.
  //
  // `api/auth/` is excluded because Auth.js must serve its own sign-in and
  // callback endpoints to unauthenticated visitors — guarding them would make
  // signing in impossible.
  matcher: [
    '/((?!_next/|api/auth/|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$|manifest\\.webmanifest$|\\.well-known/).*)',
  ],
}
