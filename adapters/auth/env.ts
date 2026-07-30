/**
 * Supabase configuration, read at call time rather than at module load.
 *
 * The distinction is not stylistic. Next.js evaluates modules during
 * `next build`, so a module-scope read that throws would make the build itself
 * require real credentials — turning Story 1.1's build gate into something only
 * a developer with a populated `.env` can run. Reading inside the function keeps
 * `npm run build` working for everyone and fails loudly at the moment a client
 * is actually needed.
 */

export class MissingSupabaseConfigError extends Error {
  override readonly name = 'MissingSupabaseConfigError'

  constructor(readonly missing: readonly string[]) {
    super(
      `Supabase is not configured: ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } missing. Copy .env.example to .env.local and fill in the values from the Supabase project settings.`,
    )
  }
}

export interface SupabaseConfig {
  readonly url: string
  readonly anonKey: string
}

export const SUPABASE_URL_VAR = 'NEXT_PUBLIC_SUPABASE_URL'
export const SUPABASE_ANON_KEY_VAR = 'NEXT_PUBLIC_SUPABASE_ANON_KEY'

/**
 * Next.js inlines `process.env.NEXT_PUBLIC_*` into the client bundle only when
 * the property is accessed statically, which is why these are written out rather
 * than looked up through a variable key.
 */
function readFromProcess(): Record<string, string | undefined> {
  return {
    [SUPABASE_URL_VAR]: process.env.NEXT_PUBLIC_SUPABASE_URL,
    [SUPABASE_ANON_KEY_VAR]: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }
}

export function readSupabaseConfig(
  env: Readonly<Record<string, string | undefined>> = readFromProcess(),
): SupabaseConfig {
  const url = env[SUPABASE_URL_VAR]?.trim()
  const anonKey = env[SUPABASE_ANON_KEY_VAR]?.trim()

  const missing: string[] = []
  if (!url) missing.push(SUPABASE_URL_VAR)
  if (!anonKey) missing.push(SUPABASE_ANON_KEY_VAR)

  // Reported together rather than one at a time: a developer setting this up for
  // the first time should learn everything that is wrong in one pass.
  if (missing.length > 0) throw new MissingSupabaseConfigError(missing)

  return { url: url as string, anonKey: anonKey as string }
}
