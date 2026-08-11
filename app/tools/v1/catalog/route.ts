import { agentViewOfCatalog } from '@/catalog/agent-view'
import { ALL_ENTRIES } from '@/catalog/registry'
import { bearerToken, failure } from '@/core/tools/http'
import { verifyServiceToken } from '@/core/tools/service-token'

/**
 * What the catalog holds, for the one caller allowed to ask.
 *
 * The reasoning model cannot choose an entry it does not know exists, and the
 * catalog is TypeScript while the agent is Python. This endpoint is how the
 * schema crosses that gap **once** rather than being written a second time in
 * Python — where a stale parameter name would be a rejected request and a stale
 * parameter *type* would be an accepted one, bound wrongly.
 *
 * AD-15 already makes the versioned `/tools/*` endpoints the only wire between
 * the two runtimes, so this is that pattern rather than a new one.
 *
 * ## It answers with `agentViewOf`, and that is the AD-5 boundary
 *
 * "Free-form SQL from a model is never executed" starts one step earlier than it
 * sounds: the model is never handed SQL at all. `catalog/agent-view.ts` picks
 * the four fields a model needs to choose — id, version, description, parameter
 * schema — and is written field by field so that a field added to `CatalogEntry`
 * later does not travel here by default.
 *
 * ## Same door as `execute`, deliberately
 *
 * The token check, the scheme strictness and the error envelope are the shared
 * ones from `core/tools/http.ts`. The private network AD-15 assumes does not
 * exist yet, so this token is the whole boundary — and an endpoint that
 * described the entire query surface to an unauthenticated caller would be a
 * generous place to start.
 *
 * Verify before doing anything else: a refused caller learns nothing, not even
 * how many entries there are.
 */
export async function GET(request: Request): Promise<Response> {
  // Read at request time rather than at module scope, so a test can vary it and
  // an absent variable does not break `next build`.
  if (!verifyServiceToken(bearerToken(request), process.env.AGENT_SERVICE_TOKEN)) {
    return failure(401, 'unauthenticated', 'this endpoint serves the agent service only')
  }

  return Response.json({ entries: agentViewOfCatalog(ALL_ENTRIES) })
}
