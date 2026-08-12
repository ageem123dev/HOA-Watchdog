import { auth } from '@/adapters/auth/auth'
import { createQueryLogReader } from '@/adapters/db/query-log-reader-postgres'
import { accessLogCsv } from '@/core/provenance/access-log-csv'
import { filterFrom } from '../filter'

/**
 * The access log as a CSV download (story 3.8, AC5).
 *
 * ## It authenticates, and does so before reading anything
 *
 * A route handler is not covered by a page's guard, and this one returns the
 * whole audit trail — every question every board member has asked. It is the
 * most attractive single request in the product to an unauthenticated caller,
 * and it is the one most easily forgotten, because the *page* beside it is
 * guarded and looks like it covers the directory.
 *
 * 404 rather than 401 for a missing session: this endpoint's existence is not
 * something an anonymous caller needs confirmed.
 *
 * ## The filter is honoured
 *
 * What downloads is what was on screen. An export that ignored the filter would
 * hand a reader a different document from the one they were looking at — and
 * quietly a much larger one, which on an audit trail means handing over more
 * than they asked for.
 */
/**
 * The UTF-8 byte order mark.
 *
 * Written here rather than inside `accessLogCsv`, which stays a producer of
 * plain CSV: the BOM is a fact about how this file is *consumed*, not about the
 * format, and a caller wanting the CSV for anything else should not have to
 * strip it.
 */
const BOM = '\uFEFF'  // U+FEFF, written as an escape rather than as the
// character itself. An invisible byte in source is exactly the hazard
// `docs/no-control-characters.test.ts` exists for — that scanner does not catch
// this one, because U+FEFF is not a C0 control — and a stray BOM is trivially
// deleted by an editor or a copy-paste with nothing to show for it. Raised by
// Argus.

export async function GET(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response('Not found', { status: 404 })
  }

  const url = new URL(request.url)
  const records = await createQueryLogReader().recent(filterFrom(searchParamsOf(url)))

  return new Response(`${BOM}${accessLogCsv(records)}`, {
    status: 200,
    headers: {
      // The charset is declared *and* the BOM is written, because the header
      // alone does not reach the program that matters. Excel ignores
      // `charset=utf-8` on a downloaded file and falls back to the system ANSI
      // codepage, so a board member named José arrives as JosÃ© in the record of
      // who did what. Raised by Argus — an earlier version of this comment
      // claimed the header handled it, which was the risk correctly named and
      // then not solved.
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="access-log.csv"',
      // Never cached. This is per-actor authorised content, and a shared cache
      // holding it would serve one board member's export to the next caller.
      'cache-control': 'no-store',
    },
  })
}

/**
 * The query string in the shape a Next.js page receives it.
 *
 * `Object.fromEntries(url.searchParams.entries())` is the obvious spelling and
 * it is **wrong here**: it keeps the *last* value of a repeated parameter, while
 * the page is handed arrays and `filterFrom` takes the *first*. So
 * `?actorId=A&actorId=B` showed a board member records for A and downloaded
 * records for B — which is precisely the invariant this endpoint exists to hold,
 * broken in the direction that hands over more than was on screen.
 *
 * `getAll` keeps both paths reading the same value from the same URL. Raised by
 * Argus.
 */
function searchParamsOf(url: URL): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {}
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key)
    // A single value is a string, not a one-element array — which is what Next.js
    // actually hands a page, and therefore what this claims to produce. The
    // behaviour was already correct because `filterFrom` unwraps either shape,
    // but a helper whose docblock and return type disagree is one the next
    // caller is entitled to be wrong about. Raised by Argus.
    params[key] = values.length === 1 ? values[0]! : values
  }

  return params
}
