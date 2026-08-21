/**
 * AD-17's wire, from the gateway's side — the only way Node reaches the agent.
 *
 * "The Node gateway reaches the Python agent service through **versioned
 * `/chat/v*` endpoints only**. The **request** carries a question and nothing
 * else […] The **response** carries the answer, the provenance id, and the rows
 * the answer was drawn from."
 *
 * The mirror of `agent/watchdog_agent/chat_service.py`. Both ends enforce the
 * same two rules, and that duplication is deliberate rather than accidental:
 * this one never *sends* a catalog entry id, and that one refuses to *accept*
 * one. Either alone would be a convention; together they are a property.
 *
 * ## A refusal is never an empty answer
 *
 * Guarded in four places now — story 3.3's tools client, 3.4's routing, 3.6a's
 * service, and here. The reason has not changed: a caller that turns a failure
 * into `{answer: '', rows: []}` converts "the records could not be reached" into
 * "there is nothing to report", and for a balance that is a wrong financial
 * answer with a confident face.
 *
 * This is the last place before a renderer, so it also refuses a *malformed
 * success*: a 200 missing the answer, the provenance id, the rows, or the entry
 * the disclosure names is not a turn, and passing it on would move the failure
 * into a component whose job is to draw.
 */

import {
  ACTOR_ASSERTION_AUDIENCE,
  ACTOR_ASSERTION_TTL_MS,
  mintActorAssertion,
} from '../../core/auth/actor-assertion'

const CHAT_PATH = '/chat/v1/turn'

/** Where the agent service is. */
const BASE_URL_VARIABLE = 'AGENT_BASE_URL'

/**
 * The gateway's identity when it calls the agent. **Not** `AGENT_SERVICE_TOKEN`,
 * which is the agent's identity when it calls here — AD-17: "one token reused in
 * both directions means either runtime's compromise grants the other's
 * identity."
 */
const TOKEN_VARIABLE = 'GATEWAY_SERVICE_TOKEN'

/**
 * The key this gateway signs actor assertions with — AD-18.
 *
 * A **third** credential, and deliberately not either of the other two: those
 * authenticate runtimes, this one carries a subject. It never leaves Node. The
 * agent service relays what it produces and cannot mint or inspect one.
 */
const ASSERTION_KEY_VARIABLE = 'ACTOR_ASSERTION_KEY'

/**
 * How long a turn may take before the gateway gives up.
 *
 * Generous, because a turn is a model call and a catalog execution — but
 * bounded, because without a bound a single unresponsive agent holds the
 * gateway request open indefinitely and the board member sees a page that never
 * resolves. Raised by CodeRabbit.
 */
const DEFAULT_TIMEOUT_MS = 60_000

export class AgentNotConfiguredError extends Error {
  override readonly name = 'AgentNotConfiguredError'

  constructor(readonly missing: readonly string[]) {
    // Names only, never values. A configuration error is the one most likely to
    // be pasted into an issue, and one of these names a bearer token.
    super(
      `The agent service is not configured: ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } missing or invalid. Copy .env.example to .env.local and fill in the values.`,
    )
  }
}

/** The agent could not be reached, or refused, or answered with nonsense. */
export class AgentUnavailableError extends Error {
  override readonly name = 'AgentUnavailableError'

  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/**
 * The agent had no catalog entry for the question.
 *
 * A distinct type because it is a distinct thing: an honest "I cannot answer
 * that from the records", not a fault. Story 3.7 turns it into something a board
 * member reads, and it must not arrive there disguised as an outage.
 */
export class NoCatalogMatchError extends Error {
  override readonly name = 'NoCatalogMatchError'
}

export interface ChatTurn {
  readonly answer: string
  readonly provenanceId: string
  readonly rows: readonly Record<string, unknown>[]
  readonly entryId: string
  readonly version: number
  readonly parameters: Readonly<Record<string, unknown>>
}

export interface AskAgentOptions {
  /** Defaults to `process.env`, read at call time — never at module scope. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Injected by tests; production uses the platform `fetch`. */
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
}

interface Question {
  readonly question: string
  readonly actorId: string
}

function readConfig(env: Readonly<Record<string, string | undefined>>) {
  const missing: string[] = []

  const baseUrl = env[BASE_URL_VARIABLE]?.trim()
  const token = env[TOKEN_VARIABLE]?.trim()
  const assertionKey = env[ASSERTION_KEY_VARIABLE]?.trim()

  if (!baseUrl) missing.push(BASE_URL_VARIABLE)
  if (!token) missing.push(TOKEN_VARIABLE)
  // Refuse to send rather than sending a turn the gateway will reject: a
  // failure at the far end costs a model call and reads as an outage instead of
  // as a missing variable.
  if (!assertionKey) missing.push(ASSERTION_KEY_VARIABLE)
  if (missing.length > 0) throw new AgentNotConfiguredError(missing)

  // Absolute https, for the reason story 3.3 gave in the other direction: the
  // token travels to whatever this names, and until the private network exists
  // it is the whole boundary. `fetch` will open `http:` quite happily.
  let parsed: URL
  try {
    parsed = new URL(baseUrl!)
  } catch {
    throw new AgentNotConfiguredError([BASE_URL_VARIABLE])
  }
  if (parsed.protocol !== 'https:' || parsed.hostname === '') {
    throw new AgentNotConfiguredError([BASE_URL_VARIABLE])
  }

  return { baseUrl: baseUrl!.replace(/\/+$/, ''), token: token!, assertionKey: assertionKey! }
}

export async function askAgent(question: Question, options: AskAgentOptions = {}): Promise<ChatTurn> {
  const { baseUrl, token, assertionKey } = readConfig(options.env ?? process.env)
  const doFetch = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let response: Response
  try {
    response = await doFetch(`${baseUrl}${CHAT_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      // The question and **proof of** the actor — never a claim about one, and
      // never an entry id. AD-17's load-bearing clause from the sending end, and
      // AD-18's from the minting end. `actorId` does not travel at all: leaving
      // it beside the assertion would keep the believable path open and make the
      // assertion decoration.
      body: JSON.stringify({
        question: question.question,
        actorAssertion: mintActorAssertion(question.actorId, {
          key: assertionKey,
          now: Date.now(),
          ttlMs: ACTOR_ASSERTION_TTL_MS,
          audience: ACTOR_ASSERTION_AUDIENCE,
        }),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    // A connection that never became a response is still this caller's problem.
    // Letting it escape means a caller correctly handling AgentUnavailableError
    // still dies on a network blip.
    throw new AgentUnavailableError(
      `the agent service could not be reached: ${error instanceof Error ? error.name : 'unknown'}`,
      0,
    )
  }

  const payload = await readJson(response)

  if (!response.ok) {
    const code = typeof payload?.code === 'string' ? payload.code : ''
    if (code === 'no_catalog_match') {
      throw new NoCatalogMatchError('the agent found no catalog entry for that question')
    }
    // Deliberately generic. The agent's message may carry detail from a gateway
    // error beneath it, and this response is on its way to a renderer.
    throw new AgentUnavailableError(
      `the agent service refused the turn with ${response.status}`,
      response.status,
    )
  }

  return asTurn(payload, response.status)
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

function asTurn(payload: Record<string, unknown> | null, status: number): ChatTurn {
  const refuse = (why: string): never => {
    throw new AgentUnavailableError(`the agent returned a success that is not a turn: ${why}`, status)
  }

  if (payload === null) refuse('the body was not JSON')

  const { answer, provenanceId, rows, entryId, version, parameters } = payload!

  if (typeof answer !== 'string' || answer.trim() === '') refuse('answer was missing or blank')
  if (typeof provenanceId !== 'string' || provenanceId.trim() === '') refuse('provenanceId was missing')
  if (!Array.isArray(rows)) refuse('rows was missing or not a list')
  // Each member too. `Array.isArray` said yes to `[null]` and `['row']`, and
  // they reached the renderer typed as `Record<string, unknown>[]` — an evidence
  // table cannot draw a null. An *empty* list stays valid: "no payments
  // recorded" is a true thing the rows can say. Raised by CodeRabbit.
  for (const row of rows as unknown[]) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      refuse('rows contained something that is not a row')
    }
  }
  if (typeof entryId !== 'string' || entryId.trim() === '') refuse('entryId was missing')
  if (!Number.isInteger(version)) refuse('version was missing or not an integer')

  // `parameters` defaults when absent, but a *present* one must be an object.
  // A string or an array would satisfy the cast below and reach the query
  // disclosure as something it cannot render. Raised by CodeRabbit.
  if (parameters !== undefined && parameters !== null) {
    if (typeof parameters !== 'object' || Array.isArray(parameters)) {
      refuse('parameters was present but not an object')
    }
  }

  return {
    answer: answer as string,
    provenanceId: provenanceId as string,
    rows: rows as Record<string, unknown>[],
    entryId: entryId as string,
    version: version as number,
    parameters: (parameters ?? {}) as Record<string, unknown>,
  }
}
