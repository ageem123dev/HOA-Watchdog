/**
 * `GET /tools/v1/catalog` — how the reasoning side learns what it may ask for.
 *
 * The catalog is TypeScript and the agent is Python. The tempting shortcut is a
 * dict of entry ids and parameter schemas written a second time in Python, and
 * migration 007's comment records why this project does not do that: a second
 * statement of a shape with nothing failing on disagreement. Here the
 * disagreement would not even be loud — a stale parameter *name* in Python is a
 * request the gateway rejects, but a stale parameter *type* is a request it
 * accepts and binds wrongly.
 *
 * So the catalog travels over the wire, and AD-15 already says these endpoints
 * are the only wire there is.
 *
 * **Two properties matter more than the payload.** Who may call this — the same
 * token boundary `execute` carries, for the same reason, since the private
 * network AD-15 assumes still does not exist. And what it refuses to say: AD-5's
 * "free-form SQL from a model is never executed" starts with the model never
 * being handed SQL in the first place.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ALL_ENTRIES } from '@/catalog/registry'

const { GET } = await import('./route')

const TOKEN = 'r7Qx-4kP9mVt2LbN8sYw0aZc'

const call = (options: { token?: string | null; scheme?: string } = {}) => {
  const headers: Record<string, string> = {}
  if (options.token !== null) {
    headers.authorization = `${options.scheme ?? 'Bearer'} ${options.token ?? TOKEN}`
  }

  return GET(new Request('https://gateway.example/tools/v1/catalog', { method: 'GET', headers }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('AGENT_SERVICE_TOKEN', TOKEN)
})

// `unstubEnvs` is not set in vitest.config.ts, so without this the stubbed token
// outlives the file and any later suite reading AGENT_SERVICE_TOKEN sees it.
// The same footgun CodeRabbit raised on the execute route.
afterAll(() => {
  vi.unstubAllEnvs()
})

describe('who may ask what the catalog holds', () => {
  it('serves the agent service', async () => {
    expect((await call()).status).toBe(200)
  })

  it('refuses a caller with no authorization header', async () => {
    const response = await call({ token: null })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ code: 'unauthenticated' })
  })

  it('refuses a wrong token', async () => {
    expect((await call({ token: 'not-the-token' })).status).toBe(401)
  })

  it('refuses a credential carrying whitespace', async () => {
    // `Bearer a b` used to be rejoined into the token `"a b"`. No bearer
    // credential contains whitespace, so that was malformed input being repaired
    // rather than refused. Raised by CodeRabbit.
    const response = await GET(
      new Request('https://gateway.example/tools/v1/catalog', {
        headers: { authorization: `Bearer ${TOKEN} extra` },
      }),
    )

    expect(response.status).toBe(401)
  })

  it('refuses a non-Bearer scheme carrying the right token', async () => {
    // Telling "wrong scheme" apart from "wrong token" tells a stranger how to
    // try again.
    expect((await call({ scheme: 'Basic' })).status).toBe(401)
  })

  it('fails closed when no token is configured at all', async () => {
    // The state where the endpoint is most exposed and least watched. An absent
    // secret must not read as "nothing to check".
    //
    // `undefined`, not `''`. Stubbing an empty string duplicated the blank-token
    // case below and never exercised `verifyServiceToken(..., undefined)`, which
    // is the shape an unset variable actually produces. Raised by CodeRabbit.
    vi.stubEnv('AGENT_SERVICE_TOKEN', undefined)

    // Asserted, because Vitest 4 has a reported regression where stubbing
    // `undefined` fails to delete. If that ever regresses here, this test would
    // quietly go back to testing whatever was already set.
    expect(process.env.AGENT_SERVICE_TOKEN).toBeUndefined()
    expect((await call()).status).toBe(401)
  })

  it('fails closed when the configured token is blank', async () => {
    vi.stubEnv('AGENT_SERVICE_TOKEN', '   ')

    expect((await call()).status).toBe(401)
  })
})

describe('what it says', () => {
  it('names every registered entry', async () => {
    const body = (await (await call()).json()) as { entries: { id: string; version: number }[] }

    expect(body.entries.map((entry) => `${entry.id}@${entry.version}`).sort()).toEqual(
      ALL_ENTRIES.map((entry) => `${entry.id}@${entry.version}`).sort(),
    )
  })

  it('carries the description and parameter schema a model chooses on', async () => {
    const body = (await (await call()).json()) as {
      entries: { id: string; description: string; parameters: Record<string, unknown> }[]
    }
    const entry = body.entries.find((candidate) => candidate.id === 'dues_status')

    expect(entry?.description).toEqual(expect.any(String))
    expect(entry?.description).not.toBe('')
    expect(entry?.parameters).toMatchObject({ type: 'object', additionalProperties: false })
  })

  it('returns something, so the assertions above cannot pass over an empty list', async () => {
    const body = (await (await call()).json()) as { entries: unknown[] }

    expect(body.entries.length).toBeGreaterThan(0)
  })
})

describe('AD-5: the model is never handed SQL', () => {
  it('carries no entry SQL in the response body', async () => {
    const raw = await (await call()).text()

    for (const entry of ALL_ENTRIES) {
      // Against the JSON-escaped form, not the raw text. The SQL is a
      // multi-line template literal and serialization escapes its newlines, so
      // comparing against `entry.sql` directly passes whether the SQL is there
      // or not — a vacuous assertion this story already shipped once and caught
      // with a sensitivity check.
      const asItWouldTravel = JSON.stringify(entry.sql).slice(1, -1)

      expect(asItWouldTravel.length).toBeGreaterThan(0)
      expect(raw).not.toContain(asItWouldTravel)
    }
  })

  it('carries no SQL keywords in the response body', async () => {
    const raw = (await (await call()).text()).toLowerCase()

    for (const keyword of ['select ', ' from ', ' where ', ' join ', 'coalesce(']) {
      expect(raw).not.toContain(keyword)
    }
  })

  it('carries no bind order', async () => {
    const body = (await (await call()).json()) as { entries: Record<string, unknown>[] }

    for (const entry of body.entries) {
      expect(entry).not.toHaveProperty('bind')
      expect(entry).not.toHaveProperty('sql')
    }
  })

  /**
   * The refusal must not leak either. A 401 that described the catalog would
   * hand an unauthenticated caller the entire query surface.
   */
  it('says nothing about the catalog to a caller it refused', async () => {
    const raw = await (await call({ token: null })).text()

    for (const entry of ALL_ENTRIES) {
      expect(raw).not.toContain(entry.id)
    }
  })
})
