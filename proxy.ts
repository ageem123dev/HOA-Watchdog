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
    return NextResponse.redirect(new URL(decision.to, request.url))
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Every route except Next.js internals and static assets. Written as an
     * exclusion so a surface added later is guarded by default — an allow-list
     * here would silently leave new routes unprotected.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
