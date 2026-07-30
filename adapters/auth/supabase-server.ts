import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { readSupabaseConfig } from './env'

/**
 * Whether this caller is allowed to write cookies.
 *
 * `best-effort` is for server components, where Next.js forbids cookie writes
 * and throwing is the expected outcome — the proxy performs the session refresh,
 * so nothing is lost by ignoring it.
 *
 * `required` is for server actions and route handlers, where a write is
 * permitted and a failure means something is genuinely wrong. Swallowing it
 * there produces the worst kind of bug: sign-in reports success, no session
 * cookie is set, the proxy bounces the member back to a blank form, and it
 * happens again on every attempt with nothing explaining why.
 */
export type CookieWritePolicy = 'best-effort' | 'required'

export async function createSupabaseServerClient(
  { cookieWrites }: { cookieWrites: CookieWritePolicy } = { cookieWrites: 'best-effort' },
) {
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
        } catch (error) {
          if (cookieWrites === 'required') throw error
        }
      },
    },
  })
}
