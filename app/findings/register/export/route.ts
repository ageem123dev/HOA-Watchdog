import { auth } from '@/adapters/auth/auth'
import { createFindingReader } from '@/adapters/db/finding-reader-postgres'
import { registerCsv } from '@/core/findings/register-csv'
import { filterFrom } from '../filter'

/**
 * The reviewed register as a CSV download (AC4, AC5, AC6).
 *
 * ## It authenticates, and does so before reading anything
 *
 * A route handler is not covered by a page's guard, and this one returns the
 * association's **entire reviewed history** — every finding the board has ever
 * looked at, with the vendors, amounts and members named. It is the most
 * attractive single request in the product to an unauthenticated caller, and
 * the easiest to forget, because the page beside it is guarded and looks like it
 * covers the directory.
 *
 * 404 rather than 401 for a missing session: this endpoint's existence is not
 * something an anonymous caller needs confirmed.
 *
 * ## The filter is honoured
 *
 * What downloads is what was on screen. An export ignoring the search would
 * hand a reader a different document from the one they were looking at — and on
 * a permanent record, quietly a much larger one. `app/access-log/export/route.ts`
 * records the same rule for the audit trail.
 */

/**
 * The UTF-8 byte order mark.
 *
 * Written here rather than inside `registerCsv`, which stays a producer of
 * plain CSV: the BOM is a fact about how this file is *consumed*, not about the
 * format.
 *
 * Written as an escape rather than as the character itself — an invisible byte
 * in source is the hazard `docs/no-control-characters.test.ts` exists for, and
 * that scanner does not catch this one, because U+FEFF is not a C0 control.
 */
const BOM = '\uFEFF'

export async function GET(request: Request): Promise<Response> {
  const session = await auth()

  if (!session?.user?.id) {
    return new Response('Not found', { status: 404 })
  }

  const url = new URL(request.url)
  const filter = filterFrom(searchParamsOf(url))

  const register = await createFindingReader().register(filter)

  return new Response(`${BOM}${registerCsv(register.findings)}`, {
    status: 200,
    headers: {
      // The charset is declared *and* the BOM is written, because the header
      // alone does not reach the program that matters. Excel ignores
      // `charset=utf-8` on a downloaded file and falls back to the system ANSI
      // codepage, so a member named José arrives as JosÃ© in the record of who
      // reviewed what.
      'content-type': 'text/csv; charset=utf-8',
      // `attachment`, so a browser saves it rather than rendering CSV as text
      // in a tab — which is what a board member gets otherwise, and which they
      // then cannot attach to anything.
      'content-disposition': 'attachment; filename="reviewed-findings.csv"',
      // The register is permanent but not immutable: a finding reviewed a
      // minute ago belongs in the next download. A cached copy of a board
      // packet is one that quietly omits the most recent review.
      'cache-control': 'no-store',
    },
  })
}

/**
 * The query string in the shape the page receives it.
 *
 * **`Object.fromEntries` is wrong here, and quietly.** It keeps the *last* value
 * of a repeated key, while Next.js hands a page every value as an array and
 * `filterFrom` takes the *first*. So `?search=a&search=b` showed a reader
 * findings matching "a" and offered them a download of findings matching "b" —
 * the page and its own export disagreeing, which is the single thing AC4 exists
 * to prevent.
 *
 * Neither task's tests could see it: the page was right about arrays and the
 * route was right about strings, and only reading them together showed that
 * they were right about different things. Raised by the whole-story review.
 */
function searchParamsOf(url: URL): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {}

  for (const key of new Set(url.searchParams.keys())) {
    params[key] = url.searchParams.getAll(key)
  }

  return params
}
