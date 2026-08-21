/**
 * AD-17's wire, from the gateway's side.
 *
 * The mirror of `agent/watchdog_agent/chat_service.py`, and it carries the same
 * two rules from the opposite end: the request names a question and nothing
 * else, and **a refusal is never an empty answer**.
 *
 * That second one has now been guarded in four places — story 3.3's tools
 * client, story 3.4's routing, story 3.6a's service, and here. The reason is the
 * same every time: a caller that turns a failure into `{answer: '', rows: []}`
 * converts "the records could not be reached" into "there is nothing to report",
 * and for a balance that is a wrong financial answer with a confident face.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  AgentNotConfiguredError,
  AgentUnavailableError,
  NoCatalogMatchError,
  askAgent,
} from './chat-client'

import {
  ACTOR_ASSERTION_AUDIENCE,
  ACTOR_ASSERTION_TTL_MS,
  verifyActorAssertion,
} from '../../core/auth/actor-assertion'

const ENV = {
  AGENT_BASE_URL: 'https://agent.internal',
  GATEWAY_SERVICE_TOKEN: 'gw-8Kd2mZq7Rt4Xn0Lb',
  ACTOR_ASSERTION_KEY: 'the-actor-assertion-signing-key',
}

const ACTOR = '018f3a2b-0000-7000-8000-0000000000aa'

const TURN = {
  answer: 'Unit 4B owes $240.00.',
  provenanceId: 'prov-1',
  rows: [{ unitNumber: '4B', balanceOutstanding: '240.00' }],
  entryId: 'dues_status',
  version: 1,
  parameters: { unitNumber: '4B', assessmentYear: 2026 },
}

const respondWith = (status: number, body: unknown) =>
  vi.fn(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof globalThis.fetch

const ask = (options: Partial<Parameters<typeof askAgent>[1]> = {}) =>
  askAgent(
    { question: 'What does 4B owe for 2026?', actorId: ACTOR },
    { env: ENV, fetch: respondWith(200, TURN), ...options },
  )

describe('the ordinary turn', () => {
  it('returns the answer, the provenance id and the rows', async () => {
    const turn = await ask()

    expect(turn.answer).toBe('Unit 4B owes $240.00.')
    expect(turn.provenanceId).toBe('prov-1')
    expect(turn.rows).toEqual(TURN.rows)
  })

  it('returns the entry and version the disclosure names', async () => {
    // UX-DR6 labels the query disclosure with `entry@version`.
    const turn = await ask()

    expect(turn.entryId).toBe('dues_status')
    expect(turn.version).toBe(1)
  })

  it('posts the question to the versioned chat path', async () => {
    const doFetch = respondWith(200, TURN)

    await ask({ fetch: doFetch })

    const [url, init] = vi.mocked(doFetch).mock.calls[0]!
    expect(String(url)).toBe('https://agent.internal/chat/v1/turn')
    expect(init?.method).toBe('POST')
  })

  it('presents the gateway token, not the agent one', async () => {
    const doFetch = respondWith(200, TURN)

    await ask({ fetch: doFetch })

    const [, init] = vi.mocked(doFetch).mock.calls[0]!
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Bearer ${ENV.GATEWAY_SERVICE_TOKEN}`,
    )
  })

  it('sends a question and a proved actor and nothing else', async () => {
    // AD-17's load-bearing clause, from the sending end. The agent refuses a
    // request naming the entry; this never sends one. Since AD-18 the actor is
    // an assertion rather than a claim — the exact-shape assertion is what stops
    // a third field being added without anyone noticing.
    const doFetch = respondWith(200, TURN)

    await ask({ fetch: doFetch })

    const [, init] = vi.mocked(doFetch).mock.calls[0]!
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>

    expect(Object.keys(payload).sort()).toEqual(['actorAssertion', 'question'])
    expect(payload.question).toBe('What does 4B owe for 2026?')
    expect(typeof payload.actorAssertion).toBe('string')
  })
})

describe('configuration', () => {
  it.each(['AGENT_BASE_URL', 'GATEWAY_SERVICE_TOKEN'])(
    'refuses to call anything when %s is missing',
    async (missing) => {
      const doFetch = respondWith(200, TURN)
      const env = { ...ENV, [missing]: undefined }

      // The type and the missing key, not a bare `toThrow()` — that passes for
      // an unrelated exception, which is the assertion story 3.5 spent three
      // rounds tightening. Raised by CodeRabbit.
      await expect(ask({ env, fetch: doFetch })).rejects.toThrow(AgentNotConfiguredError)
      await expect(ask({ env, fetch: doFetch })).rejects.toThrow(new RegExp(missing))
      expect(doFetch).not.toHaveBeenCalled()
    },
  )

  it.each(['', '   '])('refuses a blank configured value: %s', async (blank) => {
    const doFetch = respondWith(200, TURN)

    await expect(
      ask({ env: { ...ENV, GATEWAY_SERVICE_TOKEN: blank }, fetch: doFetch }),
    ).rejects.toThrow(AgentNotConfiguredError)
    expect(doFetch).not.toHaveBeenCalled()
  })

  it.each(['http://agent.internal', 'ftp://agent.internal', 'agent.internal'])(
    'refuses a base URL that is not absolute https: %s',
    async (url) => {
      // The token travels to whatever this names, and until the private network
      // exists it is the whole boundary. Story 3.3 made the same demand of
      // `GATEWAY_BASE_URL` in the other direction.
      const doFetch = respondWith(200, TURN)

      await expect(ask({ env: { ...ENV, AGENT_BASE_URL: url }, fetch: doFetch })).rejects.toThrow(
        AgentNotConfiguredError,
      )
      expect(doFetch).not.toHaveBeenCalled()
    },
  )

  it('never puts the token in the message when configuration is wrong', async () => {
    // A configuration error is the one most likely to be pasted into an issue.
    const error = await ask({ env: { ...ENV, AGENT_BASE_URL: '' } }).catch((e: Error) => e)

    expect(String(error)).not.toContain(ENV.GATEWAY_SERVICE_TOKEN)
  })

  it('carries nothing from the request when the network fails', async () => {
    // Raised by Argus on story 3.7: `app/oracle/page.tsx` logs the whole failure
    // object, so if a rejected `fetch` reached that log still carrying its
    // request configuration, the gateway service token would be sitting in
    // server logs.
    //
    // It does not — the fetch error is reduced to its `name` here and a fresh
    // `AgentUnavailableError` is thrown — but that was a property of the code
    // read once, not a property anything enforced. The previous test covers only
    // the configuration path and only `String(error)`, which would miss a token
    // hiding in an own property or a `cause`.
    const failing = vi.fn(() =>
      Promise.reject(
        Object.assign(new TypeError('fetch failed'), {
          // What a client that attached its request would look like. If the
          // implementation ever wraps the original error instead of naming it,
          // this is what would travel.
          config: { headers: { authorization: `Bearer ${ENV.GATEWAY_SERVICE_TOKEN}` } },
        }),
      ),
    ) as unknown as typeof globalThis.fetch

    const error = (await ask({ fetch: failing }).catch((e: Error) => e)) as Error

    expect(error).toBeInstanceOf(AgentUnavailableError)
    // Everything `console.error` would render: message, stack, own properties
    // and any `cause` chained onto it.
    const logged = JSON.stringify({
      ...error,
      message: error.message,
      stack: error.stack,
      cause: (error as { cause?: unknown }).cause,
    })
    expect(logged).not.toContain(ENV.GATEWAY_SERVICE_TOKEN)
  })
})

describe('a refusal is never an empty answer', () => {
  it('turns 422 into a no-catalog-match error', async () => {
    // The honest "no entry answers that". Story 3.7 gives it a face; this gives
    // it a type the caller can tell apart from a fault.
    await expect(
      ask({ fetch: respondWith(422, { code: 'no_catalog_match', message: 'no' }) }),
    ).rejects.toThrow(NoCatalogMatchError)
  })

  it('turns 401 into an error rather than an answer', async () => {
    await expect(
      ask({ fetch: respondWith(401, { code: 'unauthenticated', message: 'no' }) }),
    ).rejects.toThrow(AgentUnavailableError)
  })

  it.each([400, 403, 404, 500, 502, 503])('turns %i into an error', async (status) => {
    await expect(ask({ fetch: respondWith(status, { code: 'x', message: 'y' }) })).rejects.toThrow(
      AgentUnavailableError,
    )
  })

  it('gives up rather than waiting on a hung agent', async () => {
    // Without a timeout a single unresponsive turn holds the gateway request
    // open indefinitely, and the board member sees a page that never resolves.
    // Raised by CodeRabbit.
    const doFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      await new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      })
      return new Response('{}')
    }) as unknown as typeof globalThis.fetch

    await expect(ask({ fetch: doFetch, timeoutMs: 10 })).rejects.toThrow(AgentUnavailableError)
  })

  it('passes a signal the platform fetch can honour', async () => {
    const doFetch = respondWith(200, TURN)

    await ask({ fetch: doFetch })

    const [, init] = vi.mocked(doFetch).mock.calls[0]!
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('turns a network failure into an error, not an empty turn', async () => {
    const doFetch = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof globalThis.fetch

    await expect(ask({ fetch: doFetch })).rejects.toThrow(AgentUnavailableError)
  })

  it('never resolves to an answerless turn for any failure', async () => {
    // The sweep. Whatever goes wrong, no caller receives something it could
    // render as "there is nothing to report".
    for (const status of [400, 401, 422, 500, 503]) {
      const outcome = await ask({ fetch: respondWith(status, { code: 'x', message: 'y' }) })
        .then(() => 'resolved')
        .catch(() => 'rejected')

      expect(outcome).toBe('rejected')
    }
  })
})

describe('a malformed success', () => {
  it.each(['answer', 'provenanceId', 'rows', 'entryId', 'version'])(
    'refuses a 200 with no %s',
    async (field) => {
      // Built by filtering rather than by destructuring-to-discard: the latter
      // leaves an unused binding, and a lint warning in the gate is one more
      // line nobody reads.
      const rest = Object.fromEntries(Object.entries(TURN).filter(([key]) => key !== field))

      await expect(ask({ fetch: respondWith(200, rest) })).rejects.toThrow(new RegExp(field))
    },
  )

  it('refuses a blank answer rather than passing it on', async () => {
    // The same hole story 3.5 closed in `groundedAnswer` and 3.6a closed in the
    // service. Guarded here too, because this is the last place before a
    // renderer.
    await expect(ask({ fetch: respondWith(200, { ...TURN, answer: '   ' }) })).rejects.toThrow(
      /answer was missing or blank/,
    )
  })

  it.each([['a string', 'unitNumber=4B'], ['an array', [1, 2]], ['a number', 7]])(
    'refuses parameters that are %s',
    async (_label, parameters) => {
      // Absent is fine and defaults; present-but-not-an-object would reach the
      // query disclosure as something it cannot render. Raised by CodeRabbit.
      await expect(ask({ fetch: respondWith(200, { ...TURN, parameters }) })).rejects.toThrow(
        /parameters/,
      )
    },
  )

  it('still accepts a turn with no parameters at all', async () => {
    const rest = Object.fromEntries(
      Object.entries(TURN).filter(([key]) => key !== 'parameters'),
    )

    await expect(ask({ fetch: respondWith(200, rest) })).resolves.toMatchObject({ parameters: {} })
  })

  it.each([
    ['a null member', [null]],
    ['a string member', ['row']],
    ['an array member', [[]]],
    ['a number member', [7]],
  ])('refuses rows containing %s', async (_label, rows) => {
    // `Array.isArray` said yes and these reached the renderer typed as
    // `Record<string, unknown>[]`. An evidence table cannot draw a null.
    // Raised by CodeRabbit.
    await expect(ask({ fetch: respondWith(200, { ...TURN, rows }) })).rejects.toThrow(/rows/)
  })

  it('still accepts an empty result set, which is a real answer', async () => {
    // "No payments recorded" is a true thing the rows can say, and it must not
    // be confused with a malformed one.
    await expect(ask({ fetch: respondWith(200, { ...TURN, rows: [] }) })).resolves.toMatchObject({
      rows: [],
    })
  })

  it('refuses rows that are not a list', async () => {
    await expect(
      ask({ fetch: respondWith(200, { ...TURN, rows: { unitNumber: '4B' } }) }),
    ).rejects.toThrow(/rows/)
  })

  it('refuses a body that is not JSON', async () => {
    await expect(ask({ fetch: respondWith(200, '<html>hello</html>') })).rejects.toThrow(
      /the body was not JSON/,
    )
  })
})


/**
 * AD-18 from the minting end. The gateway's half is tested in
 * `app/tools/v1/catalog/execute/route.test.ts`; this asserts the two ends agree
 * — the assertion this client sends is one that verifier accepts, for the
 * subject it was asked about.
 */
describe('the actor assertion on the wire', () => {
  const sent = async (options: Partial<Parameters<typeof askAgent>[1]> = {}) => {
    const doFetch = respondWith(200, TURN)
    await ask({ fetch: doFetch, ...options })

    const [, init] = (doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    return JSON.parse((init as RequestInit).body as string) as Record<string, unknown>
  }

  it('sends an assertion the gateway verifier accepts for this actor', async () => {
    const payload = await sent()

    const verified = verifyActorAssertion(payload.actorAssertion as string, {
      key: ENV.ACTOR_ASSERTION_KEY,
      now: Date.now(),
      audience: ACTOR_ASSERTION_AUDIENCE,
    })

    expect(verified).toEqual({ ok: true, subject: ACTOR })
  })

  /**
   * The point of the story. A claim the gateway would have to believe must not
   * travel at all — leaving it beside the assertion would keep the old path
   * open and make the new one decoration.
   */
  it('sends no actorId at all', async () => {
    const payload = await sent()

    expect(payload).not.toHaveProperty('actorId')
    expect(Object.keys(payload).sort()).toEqual(['actorAssertion', 'question'])
  })

  it('mints an assertion that is not yet expired but does not outlive the window', async () => {
    const payload = await sent()

    const justInside = verifyActorAssertion(payload.actorAssertion as string, {
      key: ENV.ACTOR_ASSERTION_KEY,
      now: Date.now() + ACTOR_ASSERTION_TTL_MS - 1_000,
      audience: ACTOR_ASSERTION_AUDIENCE,
    })
    const wellOutside = verifyActorAssertion(payload.actorAssertion as string, {
      key: ENV.ACTOR_ASSERTION_KEY,
      now: Date.now() + ACTOR_ASSERTION_TTL_MS + 60_000,
      audience: ACTOR_ASSERTION_AUDIENCE,
    })

    expect(justInside.ok).toBe(true)
    expect(wellOutside).toEqual({ ok: false, reason: 'expired' })
  })

  /**
   * Unconfigured refuses to send, rather than sending something the gateway
   * will reject — a turn that fails at the far end costs a model call and
   * reports as an outage instead of as a misconfiguration.
   */
  it.each(['', '   '])('refuses to send when the signing key is %j', async (blank) => {
    const doFetch = respondWith(200, TURN)

    await expect(
      ask({ env: { ...ENV, ACTOR_ASSERTION_KEY: blank }, fetch: doFetch }),
    ).rejects.toThrow(AgentNotConfiguredError)
    expect(doFetch).not.toHaveBeenCalled()
  })

  it('names the missing variable without printing any secret', async () => {
    const error = await ask({ env: { ...ENV, ACTOR_ASSERTION_KEY: '' } }).catch((e: Error) => e)

    expect(String(error)).toContain('ACTOR_ASSERTION_KEY')
    expect(String(error)).not.toContain(ENV.ACTOR_ASSERTION_KEY)
    expect(String(error)).not.toContain(ENV.GATEWAY_SERVICE_TOKEN)
  })
})
