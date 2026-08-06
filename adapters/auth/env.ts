/**
 * Database configuration, read at call time rather than at module load.
 *
 * The distinction is not stylistic. Next.js evaluates modules during
 * `next build`, so a module-scope read that throws would make the build itself
 * require real credentials — turning the build gate into something only a
 * developer with a populated environment can run.
 *
 * `AUTH_SECRET` is deliberately *not* read here. Auth.js picks it up from the
 * environment itself, at request time. An earlier version bundled the two, which
 * meant the route gate — which needs only the secret to verify a JWT — threw
 * whenever the database URL was absent, turning a database blip into a total
 * outage on a path that never touches the database.
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

export const WRITER_DATABASE_URL_VAR = 'WATCHDOG_WRITER_DATABASE_URL'

export function readWriterDatabaseUrl(
  env: Readonly<Record<string, string | undefined>> = {
    [WRITER_DATABASE_URL_VAR]: process.env.WATCHDOG_WRITER_DATABASE_URL,
  },
): string {
  const url = env[WRITER_DATABASE_URL_VAR]?.trim()

  if (!url) throw new MissingAuthConfigError([WRITER_DATABASE_URL_VAR])

  return url
}

/**
 * The SELECT-only role's URL, read on the same terms as the writer's above.
 *
 * A second variable rather than a second use of the first: AD-4 puts the read
 * path on a role that cannot write, and a connection string is the only place
 * that distinction is actually made. Sharing the writer's URL would leave the
 * grant in migration 010 true and unexercised.
 */
export const READER_DATABASE_URL_VAR = 'WATCHDOG_READER_DATABASE_URL'

export function readReaderDatabaseUrl(
  env: Readonly<Record<string, string | undefined>> = {
    [READER_DATABASE_URL_VAR]: process.env.WATCHDOG_READER_DATABASE_URL,
  },
): string {
  const url = env[READER_DATABASE_URL_VAR]?.trim()

  if (!url) throw new MissingAuthConfigError([READER_DATABASE_URL_VAR])

  return url
}
