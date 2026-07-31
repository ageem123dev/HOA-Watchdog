/**
 * Auth and database configuration, read at call time rather than at module load.
 *
 * The distinction is not stylistic. Next.js evaluates modules during
 * `next build`, so a module-scope read that throws would make the build itself
 * require real credentials — turning the build gate into something only a
 * developer with a populated environment can run.
 */

export class MissingAuthConfigError extends Error {
  override readonly name = 'MissingAuthConfigError'

  constructor(readonly missing: readonly string[]) {
    super(
      `The application is not configured: ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } missing. Copy .env.example to .env.local and fill in the values.`,
    )
  }
}

export const DATABASE_URL_VAR = 'WATCHDOG_WRITER_DATABASE_URL'
export const AUTH_SECRET_VAR = 'AUTH_SECRET'

export interface AuthConfig {
  readonly databaseUrl: string
  readonly authSecret: string
}

function readFromProcess(): Record<string, string | undefined> {
  return {
    [DATABASE_URL_VAR]: process.env.WATCHDOG_WRITER_DATABASE_URL,
    [AUTH_SECRET_VAR]: process.env.AUTH_SECRET,
  }
}

export function readAuthConfig(
  env: Readonly<Record<string, string | undefined>> = readFromProcess(),
): AuthConfig {
  const databaseUrl = env[DATABASE_URL_VAR]?.trim()
  const authSecret = env[AUTH_SECRET_VAR]?.trim()

  const missing: string[] = []
  if (!databaseUrl) missing.push(DATABASE_URL_VAR)
  if (!authSecret) missing.push(AUTH_SECRET_VAR)

  // Reported together: a developer setting this up for the first time should
  // learn everything that is wrong in one pass.
  if (missing.length > 0) throw new MissingAuthConfigError(missing)

  return { databaseUrl: databaseUrl as string, authSecret: authSecret as string }
}
