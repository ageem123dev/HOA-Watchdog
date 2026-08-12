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
  const requested = Number(one(params['limit']))
  // Clamped to the port's bound here, not only in the adapter. When only the
  // adapter clamped, `?limit=10000` stayed in the URL and in the form while the
  // database returned 500 — telling a reader they were looking at more of the
  // audit trail than they were. Raised by Argus.
  const limit =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.trunc(requested), MAX_LIMIT)
      : DEFAULT_LIMIT

  return {
    ...(one(params['actorId']) !== undefined ? { actorId: one(params['actorId'])! } : {}),
    ...(one(params['entryId']) !== undefined ? { entryId: one(params['entryId'])! } : {}),
    limit,
  }
}
