/**
 * Mail configuration, and the address a board member's browser follows.
 *
 * Read at call time rather than at module load, for the reason
 * `adapters/auth/env.ts` records: Next.js evaluates modules during
 * `next build`, so a module-scope read that throws makes the build itself
 * require real credentials — turning the build gate into something only a
 * developer with a populated environment can run. This project builds and tests
 * without any of these set, and must keep doing so.
 *
 * ## `WATCHDOG_BASE_URL` is application-wide and lives here anyway
 *
 * It is not mail configuration. It is where this application is, and the alert
 * email is simply the first thing that ever needed to say so — every other
 * surface is reached from a browser that already knows. It sits here because the
 * mailer is its only reader today; when a second one appears, this is the
 * function to move, not to copy.
 */

export class MailNotConfiguredError extends Error {
  override readonly name = 'MailNotConfiguredError'

  constructor(readonly missing: readonly string[]) {
    // **Names only, never values.** A configuration error is the message most
    // likely to be pasted into an issue, and one of these names a bearer token.
    // `chat-client.ts` makes the same rule for the same reason.
    super(
      `Mail is not configured: ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } missing or invalid. Copy .env.example to .env.local and fill in the values.`,
    )
  }
}

export const MAIL_API_URL_VAR = 'MAIL_API_URL'
export const MAIL_API_KEY_VAR = 'MAIL_API_KEY'
export const MAIL_FROM_VAR = 'MAIL_FROM'
export const BASE_URL_VAR = 'WATCHDOG_BASE_URL'

export interface MailConfig {
  readonly url: string
  readonly key: string
  readonly from: string
}

/** Present and not blank. A blank credential is not one, and neither is a blank address. */
function set(env: Readonly<Record<string, string | undefined>>, name: string): string | null {
  const value = env[name]?.trim()

  return value === undefined || value === '' ? null : value
}

/** An absolute URL on one of the given schemes, or `null`. Trailing slashes removed. */
function absolute(value: string | null, schemes: readonly string[]): string | null {
  if (value === null) return null

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    // A path, a bare hostname, or nonsense. `fetch` would accept none of them
    // and `new URL(route, base)` would resolve a path against the wrong thing.
    return null
  }

  if (!schemes.includes(parsed.protocol) || parsed.hostname === '') return null

  return value.replace(/\/+$/, '')
}

export function readMailConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MailConfig {
  // **`https:` only, and this is a credential boundary rather than a
  // preference.** The key below travels in an `Authorization` header to
  // whatever this names, and `fetch` will open `http:` quite happily. The
  // rule `chat-client.ts` states for `AGENT_BASE_URL`, for the same reason
  // and with the same consequence if it is relaxed. Raised by Argus, which
  // was right and which found this project's own precedent arguing against
  // what had been written.
  //
  // `readBaseUrl` below deliberately does not share it: that one carries no
  // credential.
  const url = absolute(set(env, MAIL_API_URL_VAR), ['https:'])
  const key = set(env, MAIL_API_KEY_VAR)
  const from = set(env, MAIL_FROM_VAR)

  // Every missing name at once, not the first one. A caller filling them in one
  // error at a time restarts the process three times to learn three things.
  const missing: string[] = []
  if (url === null) missing.push(MAIL_API_URL_VAR)
  if (key === null) missing.push(MAIL_API_KEY_VAR)
  if (from === null) missing.push(MAIL_FROM_VAR)
  if (missing.length > 0) throw new MailNotConfiguredError(missing)

  return { url: url!, key: key!, from: from! }
}

/**
 * Where this application is, absolutely.
 *
 * **`http:` is accepted, deliberately, and this is not the same decision
 * `chat-client.ts` made.** That one carries a service token to whatever its base
 * URL names, so `https:` there is a credential boundary. This one is the address
 * a director's browser follows from an email, and a pilot running behind a
 * local relay or without a certificate yet is an ordinary state to be in.
 *
 * What is refused is anything that is not a web address at all: a path, a bare
 * hostname, or a scheme like `javascript:`. Links built from those work in
 * development and are dead — or worse — in every inbox, which is the worst place
 * to find out.
 */
export function readBaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const base = absolute(set(env, BASE_URL_VAR), ['https:', 'http:'])

  if (base === null) throw new MailNotConfiguredError([BASE_URL_VAR])

  return base
}
