import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { readSupabaseConfig } from './env'

/**
 * A request-scoped Supabase client for server components and server actions.
 *
 * Created per request, never memoised at module scope: one client shared across
 * requests would carry one visitor's session into another's response, which on a
 * financial surface is the worst defect this codebase could ship.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  const { url, anonKey } = readSupabaseConfig()

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server components cannot write cookies. This is expected and safe:
          // the middleware performs the session refresh and writes the cookies
          // on the response, so nothing is lost by ignoring it here.
        }
      },
    },
  })
}
