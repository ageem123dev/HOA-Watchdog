import { MOST_REGISTER_ROWS, type RegisterFilter } from '@/core/ports/finding-reader'

/**
 * Reading the register's filter out of the URL.
 *
 * Its own module for the reason `app/access-log/filter.ts` is: importing the
 * page pulls `auth` and therefore `next-auth` and `next/server` in, and the
 * suite cannot load the file. A pure function tested directly is worth more
 * than one tested through three layers of mock anyway.
 */

/** How many rows the register shows when nobody asked for a number. */
export const DEFAULT_LIMIT = 50

/**
 * One value from a search parameter that may legitimately arrive repeated.
 *
 * `?search=a&search=b` is a URL anyone can type, and the array reaches
 * `.trim()` and throws. An empty string is not a filter either: it arrives on
 * every submit of a blank form, and treating it as one narrows the register to
 * findings matching nothing — which a board member reads as an empty register.
 */
function one(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const trimmed = raw?.trim()

  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * The filter this request asks for.
 *
 * A bad `limit` falls back to the default rather than rejecting: this is a
 * read-only surface reached by a URL people edit and share, and an error page
 * because somebody mistyped a number would be a worse answer than the register.
 */
export function filterFrom(
  params: Record<string, string | string[] | undefined>,
): RegisterFilter {
  // **Truncated before it is range-checked**, not after. The other order turns
  // `?limit=0.5` into a limit of 0, which the adapter then clamps *up* to 1 —
  // so a reader who mistyped a decimal gets a single row of a permanent record
  // and no indication why. Raised by CodeRabbit on the access log's filter.
  const requested = Math.trunc(Number(one(params['limit'])))
  const limit =
    Number.isFinite(requested) && requested >= 1
      ? Math.min(requested, MOST_REGISTER_ROWS)
      : DEFAULT_LIMIT

  const search = one(params['search'])

  // Spread rather than assigned, so an absent search leaves the key off
  // entirely. A key present and holding `undefined` reads as "searched for
  // nothing" to anything enumerating the object — the export's query string
  // among them.
  return { ...(search !== undefined ? { search } : {}), limit }
}
