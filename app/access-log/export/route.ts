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
export async function GET(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response('Not found', { status: 404 })
  }

  const url = new URL(request.url)
  const params = Object.fromEntries(url.searchParams.entries())
  const records = await createQueryLogReader().recent(filterFrom(params))

  return new Response(accessLogCsv(records), {
    status: 200,
    headers: {
      // `text/csv` with an explicit charset: the trail carries text a member
      // typed, and a spreadsheet guessing the encoding renders a name wrongly
      // in the record of who did what.
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="access-log.csv"',
      // Never cached. This is per-actor authorised content, and a shared cache
      // holding it would serve one board member's export to the next caller.
      'cache-control': 'no-store',
    },
  })
}
