import { createCatalogExecutor } from '@/adapters/db/catalog-executor-postgres'
import { bearerToken, failure } from '@/core/tools/http'
import {
  ACTOR_ASSERTION_AUDIENCE,
  verifyActorAssertion,
} from '@/core/auth/actor-assertion'
import { verifyServiceToken } from '@/core/tools/service-token'

/**
 * The one way into the catalog, and AD-15's "sole data path in the system".
 *
 * The Python agent service holds no database credential (AD-3) and obtains
 * every fact by calling here. That makes this file the entire data surface
 * exposed to the reasoning side — a small amount of code carrying an unusual
 * amount of weight.
 *
 * **Until the Railway private network exists, the token check is the whole
 * boundary.** AD-15 gives two mechanisms and the deployment half is a task
 * nobody has done yet (epics.md, 2026-08-07). An operator reading this should
 * assume the endpoint is reachable from the internet and that
 * `AGENT_SERVICE_TOKEN` is what stands in front of it.
 *
 * ## Order, which is the design
 *
 * Verify, then parse, then execute. A rejected caller must not reach the
 * executor at all: not to resolve an entry, not to validate a parameter, and
 * above all not to write a provenance row for a request that was never
 * authorised. Parsing after verifying also means a malformed body from a
 * stranger is answered `401` rather than `400`, so the response confirms
 * nothing about what the route expects.
 */

/**
 * Built once for the process. `createCatalogExecutor` reads no environment at
 * construction — its pools are lazy — which is the property `next build`
 * depends on.
 */
const executor = createCatalogExecutor()

// `failure` and `bearerToken` moved to `core/tools/http.ts` when story 3.4 added
// a second `/tools/*` endpoint. Two copies of the front door is how one of them
// starts distinguishing "no header" from "wrong token" while the other does not
// — and the pair then tells a stranger which of the two they got wrong.

interface ExecuteRequest {
  readonly entryId: string
  readonly version: number
  readonly parameters: Readonly<Record<string, unknown>>
  readonly actorAssertion: string
}

/**
 * The request shape only. Parameter *types* belong to the catalog entry's own
 * schema, which `validateParameters` enforces inside the executor — restating
 * them here would be a second statement of one rule with nothing failing on
 * disagreement.
 */
function readRequest(payload: unknown): ExecuteRequest | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null

  // Whose records a query runs against is not a request field. The association
  // is derived from the board member the assertion names, inside the provenance
  // write itself, so there is nothing here that could influence it — and this
  // refusal exists so that a caller which tries is told, rather than quietly
  // served its own association and left believing the parameter worked.
  //
  // The *presence* of the key is the refusal, whatever it holds. Written as a
  // truthiness check it would wave through `null`, `''` and `0`, which is a
  // caller learning exactly which shapes the endpoint does not mind receiving.
  if (Object.hasOwn(payload, 'associationId')) return null

  // AC4 of story 5.1c, and the same refusal for the same reason. Who a query is
  // run for is established by the assertion below, never by a field beside it.
  //
  // Refused even when it *agrees* with the assertion's subject. A guard that
  // only refused a disagreeing `actorId` would teach a caller that the field
  // works, and would answer "whose turn is this?" by which value comes back
  // 200. Ignoring it would be safe today — nothing reads it — but it would sit
  // in every request body looking exactly like an input, and the next reader
  // wires it to something.
  if (Object.hasOwn(payload, 'actorId')) return null

  const { entryId, version, parameters, actorAssertion } = payload as Record<string, unknown>

  if (typeof entryId !== 'string' || entryId.trim() === '') return null
  if (!Number.isInteger(version)) return null
  if (typeof actorAssertion !== 'string' || actorAssertion.trim() === '') return null
  if (parameters === null || typeof parameters !== 'object' || Array.isArray(parameters)) return null

  return {
    entryId,
    version: version as number,
    parameters: parameters as Record<string, unknown>,
    actorAssertion,
  }
}

export async function POST(request: Request): Promise<Response> {
  // Read at request time, not at module scope. A test can then vary it, and an
  // absent variable does not break `next build` — the same reasoning the
  // adapters use for their connection strings.
  if (!verifyServiceToken(bearerToken(request), process.env.AGENT_SERVICE_TOKEN)) {
    return failure(401, 'unauthenticated', 'this endpoint serves the agent service only')
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return failure(400, 'invalid_request', 'the request body is not valid JSON')
  }

  const parsed = readRequest(payload)
  if (parsed === null) {
    return failure(
      400,
      'invalid_request',
      'the request must carry entryId, an integer version, a parameters object and actorAssertion',
    )
  }

  // AD-18. The service token above established that the caller is the agent
  // service; this establishes **which board member the turn is for**, which the
  // service token says nothing about. Both, or neither is enough.
  //
  // `401` and not `403`: the request has failed to establish who it is for, and
  // the reason is deliberately not returned. Which check failed — signature,
  // expiry, audience — is the gateway's to log and not a caller's to learn.
  const verified = verifyActorAssertion(parsed.actorAssertion, {
    key: process.env.ACTOR_ASSERTION_KEY ?? '',
    now: Date.now(),
    audience: ACTOR_ASSERTION_AUDIENCE,
  })

  if (!verified.ok) {
    console.warn('tools/v1/catalog/execute refused an actor assertion', { reason: verified.reason })

    return failure(401, 'unauthenticated', 'the actor assertion was not accepted')
  }

  try {
    // The subject the assertion proves, never a field the request supplied.
    const execution = await executor.execute({
      entryId: parsed.entryId,
      version: parsed.version,
      parameters: parsed.parameters,
      actorId: verified.subject,
    })

    return Response.json({ provenanceId: execution.provenanceId, rows: execution.rows })
  } catch (error) {
    // Matched on `name` rather than by importing the classes, so this file does
    // not reach into the catalog's internals to answer an HTTP question.
    const name = error instanceof Error ? error.name : ''

    if (name === 'UnknownCatalogEntryError') {
      return failure(404, 'unknown_entry', 'the catalog holds no such entry or version')
    }
    if (name === 'ParameterValidationError') {
      return failure(400, 'invalid_parameters', 'the parameters do not match the entry schema')
    }

    // The message is deliberately generic. A Postgres error carries table
    // names, column names and sometimes row values, and the reasoning side is
    // the least trusted consumer in the system. The detail is logged, not
    // returned.
    console.error('tools/v1/catalog/execute failed', error)

    return failure(500, 'internal', 'the query could not be completed')
  }
}
