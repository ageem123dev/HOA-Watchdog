import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { MissingSupabaseConfigError, readSupabaseConfig } from './adapters/auth/env'
import { routeDecision } from './core/auth/route-policy'

/**
 * The gate. It resolves the session and applies `core/auth/route-policy`, and it
 * holds no policy of its own — every decision about who may see what is a pure
 * function tested without a server, so the rule cannot drift from its tests.
 *
 * Named `proxy` in `proxy.ts`: Next.js 16 renamed the middleware file convention
 * and warns on the old one.
 */
export async function proxy(request: NextRequest) {
  // `response` is reassigned by setAll below so refreshed session cookies ride
  // out on the response. Returning a different response object drops them and
  // signs the member out on their next navigation.
  let response = NextResponse.next({ request })
  let isAuthenticated = false

  try {
    const { url, anonKey } = readSupabaseConfig()
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    })

    const {
      data: { user },
    } = await supabase.auth.getUser()
    isAuthenticated = user !== null
  } catch (error) {
    // An unconfigured or unreachable auth provider must not open the gate. The
    // visitor is treated as unauthenticated and sent to sign-in, which explains
    // the missing configuration; no association data is served either way.
    if (!(error instanceof MissingSupabaseConfigError)) throw error
  }

  const decision = routeDecision({ pathname: request.nextUrl.pathname, isAuthenticated })

  if (decision.kind === 'redirect') {
    const redirected = NextResponse.redirect(new URL(decision.to, request.url))

    // Session cookies written during getUser() live on `response`, and a redirect
    // is a different object. Dropping them loses a rotated refresh token — the
    // member is signed out on some later navigation with nothing to point at —
    // and loses Supabase's *clearing* cookies too, so a dead session is never
    // evicted and every request keeps paying a failed round trip.
    for (const cookie of response.cookies.getAll()) redirected.cookies.set(cookie)

    return redirected
  }

  return response
}

/*
 * Every route except Next.js internals and a short list of well-known root
 * files. Written as an exclusion so a surface added later is guarded by default.
 *
 * The exclusion is anchored to *prefixes and whole filenames*, never to a
 * suffix. An earlier version ended in `.*\.(svg|png|…)$`, which excluded any
 * route whose path merely ended in an image suffix — a document preview at
 * `/api/documents/42/preview.png` would have served association records to
 * anyone with the link, and no test would have failed.
 *
 * The consequence is that files under `/public` are guarded too. That is the
 * intended trade: the only unauthenticated surface is sign-in, and it needs no
 * assets. Anything genuinely public must be added here deliberately.
 */
export const config = {
  // Written as a literal because Next.js parses this statically at build time —
  // a reference to a constant fails the build. `proxy.test.ts` reads it back
  // from here, so the pattern under test is the pattern that ships.
  matcher: [
    '/((?!_next/|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$|manifest\\.webmanifest$|\\.well-known/).*)',
  ],
}
