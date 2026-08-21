/**
 * The tool endpoint — AD-15's "sole data path", and the only door into the
 * catalog.
 *
 * Every test about *who may call this* matters more than every test about what
 * it returns. The private network AD-15 assumes does not exist yet, so the
 * token check here is the entire boundary between the public internet and the
 * association's records.
 *
 * The ordering assertions are the ones a reader should look at hardest: a
 * rejected caller must leave the executor untouched, so no catalog entry is
 * resolved, no provenance row is written and no query runs. An endpoint that
 * authenticated *after* doing the work would pass every status-code test in
 * this file.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { mintActorAssertion } from '@/core/auth/actor-assertion'

const execute = vi.fn()

vi.mock('@/adapters/db/catalog-executor-postgres', () => ({
  createCatalogExecutor: () => ({ execute: (...args: unknown[]) => execute(...args) }),
}))

const { POST } = await import('./route')

const TOKEN = 'r7Qx-4kP9mVt2LbN8sYw0aZc'
const ACTOR = '018f3a2b-0000-7000-8000-0000000000aa'
const ASSERTION_KEY = 'gateway-actor-assertion-signing-key'

/**
 * A live assertion for `ACTOR`, minted per call rather than once at module
 * scope: it carries an expiry, and a module-scope one would age across a slow
 * suite until the tests began failing on the clock rather than on the code.
 */
const validAssertion = () =>
  mintActorAssertion(ACTOR, {
    key: ASSERTION_KEY,
    now: Date.now(),
    ttlMs: 60_000,
    audience: 'tools/v1',
  })

const body = (overrides: Record<string, unknown> = {}) => ({
  entryId: 'dues_status',
  version: 1,
  parameters: { unitNumber: '4B', assessmentYear: 2026 },
  actorAssertion: validAssertion(),
  ...overrides,
})

const call = (options: { token?: string | null; raw?: string; payload?: unknown } = {}) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.token !== null) headers.authorization = `Bearer ${options.token ?? TOKEN}`

  return POST(
    new Request('https://gateway.example/tools/v1/catalog/execute', {
      method: 'POST',
      headers,
      body: options.raw ?? JSON.stringify(options.payload ?? body()),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('AGENT_SERVICE_TOKEN', TOKEN)
  vi.stubEnv('ACTOR_ASSERTION_KEY', ASSERTION_KEY)
  execute.mockResolvedValue({ provenanceId: 'prov-1', rows: [{ unitNumber: '4B' }] })
})

// `unstubEnvs` is not set in vitest.config.ts, so without this the stubbed token
// outlives the file and any later suite reading AGENT_SERVICE_TOKEN sees this
// one. Raised by CodeRabbit.
afterAll(() => {
  vi.unstubAllEnvs()
})

describe('POST /tools/v1/catalog/execute', () => {
  describe('the agent service', () => {
    it('executes the entry it names and returns the rows with the provenance id', async () => {
      const response = await call()

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        provenanceId: 'prov-1',
        rows: [{ unitNumber: '4B' }],
      })
      expect(execute).toHaveBeenCalledWith({
        entryId: 'dues_status',
        version: 1,
        parameters: { unitNumber: '4B', assessmentYear: 2026 },
        actorId: ACTOR,
      })
    })
  })

  describe('a caller who is not the agent service', () => {
    it.each([
      ['no Authorization header', { token: null }],
      ['a wrong token', { token: 'not-the-token-at-all-x' }],
      ['an empty bearer value', { token: '' }],
    ])('is refused with 401 given %s', async (_label, options) => {
      const response = await call(options)

      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toMatchObject({ code: 'unauthenticated' })
    })

    it('is refused when the header is not a Bearer scheme', async () => {
      const response = await POST(
        new Request('https://gateway.example/tools/v1/catalog/execute', {
          method: 'POST',
          headers: { authorization: `Token ${TOKEN}`, 'content-type': 'application/json' },
          body: JSON.stringify(body()),
        }),
      )

      expect(response.status).toBe(401)
    })

    /**
     * AC2, and the assertion the endpoint's design turns on. A rejected caller
     * must not reach the executor at all — not to resolve an entry, not to
     * validate a parameter, and above all not to write a provenance row for a
     * request that was never authorised.
     */
    it('never reaches the executor', async () => {
      await call({ token: 'wrong' })

      expect(execute).not.toHaveBeenCalled()
    })

    /**
     * Rejection precedes parsing. With both a bad token and an unparseable body
     * the answer is 401, not 400 — a 400 would confirm to an unauthenticated
     * caller that the route exists and what it expects.
     */
    it('answers 401 rather than 400 when the body is also malformed', async () => {
      const response = await call({ token: 'wrong', raw: 'not json at all' })

      expect(response.status).toBe(401)
      expect(execute).not.toHaveBeenCalled()
    })

    /**
     * AC3. With no token configured the endpoint refuses everyone, including a
     * caller presenting nothing. `core/tools/service-token.ts` owns the rule;
     * this proves the route actually consults it rather than short-circuiting.
     */
    it('refuses every caller when the token is configured blank', async () => {
      vi.stubEnv('AGENT_SERVICE_TOKEN', '')

      expect((await call()).status).toBe(401)
      expect((await call({ token: null })).status).toBe(401)
      expect(execute).not.toHaveBeenCalled()
    })

    /**
     * Absent, not blank — and they are different values reaching
     * `verifyServiceToken`. The route passes `process.env.AGENT_SERVICE_TOKEN`
     * through unchanged, which is `undefined` when the variable is unset, and
     * only the `''` case was covered. `.env.example` and the README both promise
     * that an unset token refuses everyone, so the promise needed the test.
     * Raised by CodeRabbit on MR !37.
     */
    it('refuses every caller when the token variable is absent entirely', async () => {
      vi.stubEnv('AGENT_SERVICE_TOKEN', undefined)

      expect(process.env.AGENT_SERVICE_TOKEN).toBeUndefined()
      expect((await call()).status).toBe(401)
      expect((await call({ token: null })).status).toBe(401)
      expect(execute).not.toHaveBeenCalled()
    })
  })

  describe('a request the endpoint cannot act on', () => {
    it('answers 400 for a body that is not JSON', async () => {
      const response = await call({ raw: '{ not json' })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ code: 'invalid_request' })
      expect(execute).not.toHaveBeenCalled()
    })

    it.each([
      ['a missing entryId', { entryId: undefined }],
      ['a non-string entryId', { entryId: 42 }],
      ['a missing version', { version: undefined }],
      ['a non-integer version', { version: 1.5 }],
      ['a missing actorAssertion', { actorAssertion: undefined }],
      ['a non-string actorAssertion', { actorAssertion: 42 }],
      ['a blank actorAssertion', { actorAssertion: '   ' }],
      ['parameters that are not an object', { parameters: ['4B'] }],
    ])('answers 400 for %s', async (_label, override) => {
      const response = await call({ payload: body(override) })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ code: 'invalid_request' })
      expect(execute).not.toHaveBeenCalled()
    })
  })

  /**
   * AC2, and the half of it that carries the weight. AD-5 stops a model
   * *authoring* SQL; it says nothing about a model choosing whose records the
   * reviewed SQL runs against. The agent service holds this endpoint's token,
   * so an instruction smuggled through a document could try exactly that.
   *
   * Refused rather than ignored, deliberately. Ignoring is safe — nothing reads
   * the field — but it is safe silently, and a caller that supplies a parameter
   * and gets a 200 has been told it worked. The association is derived from the
   * board member the query is run for and there is no request shape that can
   * influence it.
   */
  describe('a request that tries to choose its own association', () => {
    it.each([
      ['a real-looking id', '00000000-0000-7000-8000-000000000002'],
      ['null', null],
      ['an empty string', ''],
      ['a number', 7],
    ])('is refused when associationId is %s', async (_label, value) => {
      const response = await call({ payload: body({ associationId: value }) })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ code: 'invalid_request' })
    })

    /**
     * The presence of the key is the refusal, not its truthiness. A guard
     * written as `if (payload.associationId)` lets `null`, `''` and `0`
     * through — and a caller probing for a way in learns which values the
     * endpoint does not mind receiving.
     */
    it('never reaches the executor, so nothing is logged for a refused request', async () => {
      await call({ payload: body({ associationId: 'anything' }) })

      expect(execute).not.toHaveBeenCalled()
    })

    /**
     * 401 outranks 400. Answering "your associationId is not allowed" to a
     * caller holding no token would confirm the field exists to someone who has
     * not authenticated at all.
     */
    it('answers 401 rather than 400 when the caller is not the agent service', async () => {
      const response = await call({ token: 'wrong', payload: body({ associationId: 'x' }) })

      expect(response.status).toBe(401)
      expect(execute).not.toHaveBeenCalled()
    })
  })

  /**
   * AD-18 at the gateway. The service token proves the *caller is the agent
   * service*; the assertion proves *which board member the turn is for*. Both,
   * or neither is enough.
   *
   * Every refusal here asserts a **valid** assertion is still accepted in the
   * same run. A verifier that refused everything would pass a suite of refusal
   * tests while taking the Oracle down, and story 5.1b shipped that shape twice.
   */
  describe('the actor assertion', () => {
    const KEY = ASSERTION_KEY
    const NOW = Date.now()

    const assertionFor = (subject: string, overrides: Record<string, unknown> = {}) =>
      mintActorAssertion(subject, {
        key: KEY,
        now: NOW,
        ttlMs: 60_000,
        audience: 'tools/v1',
        ...overrides,
      } as Parameters<typeof mintActorAssertion>[1])

    const callWith = (assertion: string, extra: Record<string, unknown> = {}) =>
      call({ payload: { ...body(), actorAssertion: assertion, ...extra } })

    it('accepts a valid assertion and runs the entry for its subject', async () => {
      const response = await callWith(assertionFor(ACTOR))

      expect(response.status).toBe(200)
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ actorId: ACTOR }))
    })

    it('refuses a forged signature, and still accepts a valid assertion', async () => {
      const [payload] = assertionFor(ACTOR).split('.')
      const forged = `${payload}.bm90LXRoZS1zaWduYXR1cmU`

      const response = await callWith(forged)

      expect(response.status).toBe(401)
      expect(execute).not.toHaveBeenCalled()

      execute.mockClear()
      expect((await callWith(assertionFor(ACTOR))).status).toBe(200)
    })

    /** The attack: a legitimate assertion with the subject swapped. */
    it('refuses a subject altered after signing, and still accepts a valid assertion', async () => {
      const [, signature] = assertionFor(ACTOR).split('.')
      const otherMember = Buffer.from(
        JSON.stringify({ sub: 'somebody-else', exp: NOW + 60_000, aud: 'tools/v1' }),
        'utf8',
      ).toString('base64url')

      const response = await callWith(`${otherMember}.${signature}`)

      expect(response.status).toBe(401)
      expect(execute).not.toHaveBeenCalled()

      execute.mockClear()
      expect((await callWith(assertionFor(ACTOR))).status).toBe(200)
    })

    it('refuses an expired assertion, and still accepts a valid assertion', async () => {
      const response = await callWith(assertionFor(ACTOR, { now: NOW - 120_000 }))

      expect(response.status).toBe(401)
      expect(execute).not.toHaveBeenCalled()

      execute.mockClear()
      expect((await callWith(assertionFor(ACTOR))).status).toBe(200)
    })

    it('refuses one minted for another audience, and still accepts a valid assertion', async () => {
      const response = await callWith(assertionFor(ACTOR, { audience: 'chat/v1' }))

      expect(response.status).toBe(401)
      expect(execute).not.toHaveBeenCalled()

      execute.mockClear()
      expect((await callWith(assertionFor(ACTOR))).status).toBe(200)
    })

    /**
     * Unconfigured refuses everybody, matching `verifyServiceToken`. A gateway
     * that accepted assertions because it had no key to check them with would
     * fail open exactly when it is most exposed.
     */
    it('refuses every assertion when no signing key is configured', async () => {
      vi.stubEnv('ACTOR_ASSERTION_KEY', '')

      const response = await callWith(assertionFor(ACTOR))

      expect(response.status).toBe(401)
      expect(execute).not.toHaveBeenCalled()
    })
  })

  describe('what the executor refuses', () => {
    it('answers 404 when the catalog holds no such entry', async () => {
      const error = new Error('the catalog holds no entry called drop_everything')
      error.name = 'UnknownCatalogEntryError'
      execute.mockRejectedValue(error)

      const response = await call()

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toMatchObject({ code: 'unknown_entry' })
    })

    it('answers 400 when a parameter does not match the entry schema', async () => {
      const error = new Error('assessmentYear must be an integer')
      error.name = 'ParameterValidationError'
      execute.mockRejectedValue(error)

      const response = await call()

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ code: 'invalid_parameters' })
    })

    /**
     * AC8. A database failure must not travel to the caller: the reasoning side
     * is the least trusted consumer in the system, and a Postgres error carries
     * table names, column names and sometimes row values.
     */
    it('answers 500 without leaking the underlying failure', async () => {
      execute.mockRejectedValue(
        new Error('relation "query_log" does not exist at character 13; SELECT unit_number FROM'),
      )

      const response = await call()
      const payload = (await response.json()) as Record<string, unknown>

      expect(response.status).toBe(500)
      expect(payload).toMatchObject({ code: 'internal' })
      const text = JSON.stringify(payload)
      expect(text).not.toMatch(/query_log|relation|SELECT|unit_number/i)
    })
  })

  /**
   * The envelope the architecture's Consistency Conventions require:
   * `{code, message, detail?}`. `app/api/documents/[id]/extract/route.ts`
   * predates it and answers `{error}`; this route follows the convention rather
   * than its neighbour.
   */
  it.each([
    ['401', { token: 'wrong' }],
    ['400', { raw: '{ not json' }],
  ])('shapes its %s failure as {code, message}', async (_label, options) => {
    const payload = (await (await call(options)).json()) as Record<string, unknown>

    expect(typeof payload.code).toBe('string')
    expect(typeof payload.message).toBe('string')
    expect(payload.error).toBeUndefined()
  })
})
