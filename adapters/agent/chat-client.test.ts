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

import { AgentUnavailableError, NoCatalogMatchError, askAgent } from './chat-client'

const ENV = {
  AGENT_BASE_URL: 'https://agent.internal',
  GATEWAY_SERVICE_TOKEN: 'gw-8Kd2mZq7Rt4Xn0Lb',
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

  it('sends a question and an actor and nothing else', async () => {
    // AD-17's load-bearing clause, from the sending end. The agent refuses a
    // request naming the entry; this never sends one.
    const doFetch = respondWith(200, TURN)

    await ask({ fetch: doFetch })

    const [, init] = vi.mocked(doFetch).mock.calls[0]!
    expect(JSON.parse(String(init?.body))).toEqual({
      question: 'What does 4B owe for 2026?',
      actorId: ACTOR,
    })
  })
})

describe('configuration', () => {
  it.each(['AGENT_BASE_URL', 'GATEWAY_SERVICE_TOKEN'])(
    'refuses to call anything when %s is missing',
    async (missing) => {
      const doFetch = respondWith(200, TURN)
      const env = { ...ENV, [missing]: undefined }

      await expect(ask({ env, fetch: doFetch })).rejects.toThrow(/not configured/)
      expect(doFetch).not.toHaveBeenCalled()
    },
  )

  it.each(['', '   '])('refuses a blank configured value: %s', async (blank) => {
    const doFetch = respondWith(200, TURN)

    await expect(
      ask({ env: { ...ENV, GATEWAY_SERVICE_TOKEN: blank }, fetch: doFetch }),
    ).rejects.toThrow()
    expect(doFetch).not.toHaveBeenCalled()
  })

  it.each(['http://agent.internal', 'ftp://agent.internal', 'agent.internal'])(
    'refuses a base URL that is not absolute https: %s',
    async (url) => {
      // The token travels to whatever this names, and until the private network
      // exists it is the whole boundary. Story 3.3 made the same demand of
      // `GATEWAY_BASE_URL` in the other direction.
      const doFetch = respondWith(200, TURN)

      await expect(ask({ env: { ...ENV, AGENT_BASE_URL: url }, fetch: doFetch })).rejects.toThrow()
      expect(doFetch).not.toHaveBeenCalled()
    },
  )

  it('never puts the token in the message when configuration is wrong', async () => {
    // A configuration error is the one most likely to be pasted into an issue.
    const error = await ask({ env: { ...ENV, AGENT_BASE_URL: '' } }).catch((e: Error) => e)

    expect(String(error)).not.toContain(ENV.GATEWAY_SERVICE_TOKEN)
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
    await expect(ask({ fetch: respondWith(status, { code: 'x', message: 'y' }) })).rejects.toThrow()
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
      const { [field as keyof typeof TURN]: _dropped, ...rest } = TURN

      await expect(ask({ fetch: respondWith(200, rest) })).rejects.toThrow(new RegExp(field))
    },
  )

  it('refuses a blank answer rather than passing it on', async () => {
    // The same hole story 3.5 closed in `groundedAnswer` and 3.6a closed in the
    // service. Guarded here too, because this is the last place before a
    // renderer.
    await expect(ask({ fetch: respondWith(200, { ...TURN, answer: '   ' }) })).rejects.toThrow()
  })

  it('refuses rows that are not a list', async () => {
    await expect(
      ask({ fetch: respondWith(200, { ...TURN, rows: { unitNumber: '4B' } }) }),
    ).rejects.toThrow(/rows/)
  })

  it('refuses a body that is not JSON', async () => {
    await expect(ask({ fetch: respondWith(200, '<html>hello</html>') })).rejects.toThrow()
  })
})
