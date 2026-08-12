import { MAX_LIMIT, type QueryLogFilter } from '@/core/ports/query-log-reader'

/**
 * Reading the filter out of the URL.
 *
 * Its own module for the reason `app/oracle/question.ts` is: importing the page
 * pulls `auth` and therefore `next-auth` and `next/server` in, and the suite
 * cannot load the file. A pure function tested directly is worth more than one
 * tested through three layers of mock anyway.
 */

/** How many rows a page shows when nobody asked for a number. */
export const DEFAULT_LIMIT = 100

/** One value from a search parameter that may legitimately arrive repeated. */
function one(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const trimmed = raw?.trim()

  // An empty string is not a filter. It arrives on every submit of a form whose
  // boxes are blank, and treating it as one would filter the log down to actors
  // whose id is the empty string — which is to say, nothing, presented as
  // "no queries match this filter".
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * The filter this request asks for.
 *
 * A bad `limit` falls back to the default rather than rejecting: this is a
 * read-only surface reached by a URL people edit and share, and an error page
 * because somebody mistyped a number would be a worse answer than a hundred
 * rows.
 */
export function filterFrom(
  params: Record<string, string | string[] | undefined>,
): QueryLogFilter {
  // **Truncated before it is validated**, not after. `Math.trunc` first and the
  // `> 0` check second, because the other order turns `?limit=0.5` into a limit
  // of 0 — which the adapter then clamps *up* to 1, so a reader who mistyped a
  // decimal got a single row of the audit trail and no indication why. Raised by
  // CodeRabbit; verified before fixing.
  const requested = Math.trunc(Number(one(params['limit'])))
  const limit =
    Number.isFinite(requested) && requested >= 1 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT

  // Bound once each. Calling `one` twice per key invited the two calls to
  // disagree and forced a non-null assertion to paper over the fact that the
  // compiler could not see they were the same value. Raised by CodeRabbit.
  const actorId = one(params['actorId'])
  const entryId = one(params['entryId'])

  return {
    ...(actorId !== undefined ? { actorId } : {}),
    ...(entryId !== undefined ? { entryId } : {}),
    limit,
  }
}
