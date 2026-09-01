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
    //
    // `!= null`, loosely, and deliberately: `!== null` is **true** for
    // `undefined`, so an auth layer yielding nothing would open the gate rather
    // than close it. Fail-open is the one direction this file must never fail
    // in. Raised by Argus on story 3.2; `proxy.test.ts` pins it.
    isAuthenticated: request.auth != null,
  })

  switch (decision.kind) {
    case 'redirect':
      return NextResponse.redirect(new URL(decision.to, request.url))
    case 'allow':
      return NextResponse.next()
  }

  // Unreachable while `RouteDecision` has two members, and that is the point:
  // the previous shape was `if (redirect) … else next()`, so **adding a third
  // kind would have fallen through to allow** and opened the gate silently. The
  // `never` assignment makes that a compile error instead, and the throw makes
  // the runtime answer a 500 rather than a pass. Raised by Argus on story 3.2.
  const unhandled: never = decision
  throw new Error(`unhandled route decision: ${JSON.stringify(unhandled)}`)
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
  // signing in impossible. `tools/` is excluded for the same shape of reason:
  // AD-15's endpoints authenticate the agent service by bearer token and it has
  // no session, so this gate could only answer it with a redirect it cannot
  // follow. The consequence is that the route's own token check is the whole of
  // the protection there. It is narrowed to a **versioned** path — `tools/v1/`,
  // `tools/v2/` — so a future page under app/tools/ is still guarded; excluding
  // all of `tools/` would unguard it silently. Raised by Argus.
  // `hoa-watchdog-logo.png` is excluded as a whole filename, exactly as
  // `favicon.ico` is, because the sign-in page shows it and sign-in is the one
  // surface reached without a session. Guarded, the image request answered 307
  // to /sign-in — and the optimizer, which fetches the original through this
  // same gate, then reported the file as "not a valid image". A brand asset
  // redirecting to the login page is invisible in every test that renders the
  // markup rather than loading it.
  matcher: [
    '/((?!_next/|api/auth/|tools/v\\d+/|favicon\\.ico$|hoa-watchdog-logo\\.png$|robots\\.txt$|sitemap\\.xml$|manifest\\.webmanifest$|\\.well-known/).*)',
  ],
}
