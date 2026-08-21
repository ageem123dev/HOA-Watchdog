/**
 * The actor assertion — AD-18's mechanism, tested as a pure function.
 *
 * The key and the clock are arguments, not environment reads, for the reason
 * `core/tools/service-token.ts` records about itself: the case that matters most
 * is **nothing configured**, and a module that fetches its own key cannot be
 * asked that question.
 *
 * ## The vacuity this file is built against
 *
 * "A forged token is refused" passes just as happily against a verifier that
 * refuses *everything*, valid tokens included — and that verifier would take the
 * Oracle down while looking secure. So **every refusal case asserts, in the same
 * test, that a valid assertion is still accepted.** Story 5.1b shipped this exact
 * shape twice and only the sensitivity check found it.
 */

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { mintActorAssertion, verifyActorAssertion } from './actor-assertion'

const KEY = 'a-signing-key-that-is-long-enough-to-be-real'
const AUDIENCE = 'tools/v1'
const NOW = 1_770_000_000_000
const TTL_MS = 60_000

const SUBJECT = '018f3a2b-0000-7000-8000-0000000000aa'

const mint = (overrides: Partial<Parameters<typeof mintActorAssertion>[1]> = {}, subject = SUBJECT) =>
  mintActorAssertion(subject, { key: KEY, now: NOW, ttlMs: TTL_MS, audience: AUDIENCE, ...overrides })

const verify = (assertion: string, overrides: Partial<Parameters<typeof verifyActorAssertion>[1]> = {}) =>
  verifyActorAssertion(assertion, { key: KEY, now: NOW, audience: AUDIENCE, ...overrides })

/** Asserts the verifier has not simply stopped accepting anything. */
const stillAcceptsAValidAssertion = () => {
  expect(verify(mint())).toEqual({ ok: true, subject: SUBJECT })
}

describe('minting an actor assertion', () => {
  it('produces something the verifier resolves back to the same subject', () => {
    expect(verify(mint())).toEqual({ ok: true, subject: SUBJECT })
  })

  /**
   * The inverse, over subjects chosen to break a naive encoding: the delimiter
   * itself, and a multi-byte character where `String.length` and byte length
   * disagree.
   */
  it.each([
    ['a uuid', SUBJECT],
    ['a subject containing the delimiter', 'a.b.c|d'],
    ['a subject with multi-byte characters', 'café-señor-日本'],
    ['a single character', 'x'],
  ])('round-trips %s unchanged', (_label, subject) => {
    const assertion = mint({}, subject)

    expect(verify(assertion)).toEqual({ ok: true, subject })
  })

  /**
   * Cross-check: the signature is recomputed here from the payload with an
   * independent `createHmac`, so the token is not merely self-consistent with
   * whatever `mint` happened to produce.
   */
  it('signs the payload with an HMAC a second implementation can reproduce', () => {
    const assertion = mint()
    const [payload, signature] = assertion.split('.')

    const expected = createHmac('sha256', KEY).update(payload!).digest('base64url')

    expect(signature).toBe(expected)
  })

  it('refuses to mint without a key, rather than producing something unsigned', () => {
    expect(() => mint({ key: '' })).toThrow(/key/i)
    expect(() => mint({ key: '   ' })).toThrow(/key/i)
  })

  it('refuses to mint an assertion that names nobody', () => {
    expect(() => mint({}, '')).toThrow(/subject/i)
    expect(() => mint({}, '   ')).toThrow(/subject/i)
  })

  it('refuses a lifetime that is zero or negative, which would be born expired', () => {
    expect(() => mint({ ttlMs: 0 })).toThrow(/ttl/i)
    expect(() => mint({ ttlMs: -1 })).toThrow(/ttl/i)
  })
})

describe('verifying an actor assertion', () => {
  it('refuses a signature that does not match, and still accepts a valid one', () => {
    const [payload] = mint().split('.')
    const forged = `${payload}.${createHmac('sha256', 'not-the-key').update(payload!).digest('base64url')}`

    expect(verify(forged)).toEqual({ ok: false, reason: 'signature' })
    stillAcceptsAValidAssertion()
  })

  /**
   * The attack this whole story exists for: take a legitimate assertion and
   * swap the subject for another board member's.
   */
  it('refuses a payload altered after signing, and still accepts a valid one', () => {
    const assertion = mint()
    const [, signature] = assertion.split('.')

    const otherMember = Buffer.from(
      JSON.stringify({ sub: 'somebody-else', exp: NOW + TTL_MS, aud: AUDIENCE }),
      'utf8',
    ).toString('base64url')

    expect(verify(`${otherMember}.${signature}`)).toEqual({ ok: false, reason: 'signature' })
    stillAcceptsAValidAssertion()
  })

  // Self-describing labels: `it.each` fills `%s` positionally, so a title with
  // one placeholder and three columns prints the elapsed milliseconds where the
  // expectation should be — which is how a red test reads as gibberish.
  it.each([
    ['accepts one millisecond before expiry', TTL_MS - 1, true],
    ['refuses exactly at expiry', TTL_MS, false],
    ['refuses one millisecond after expiry', TTL_MS + 1, false],
  ])('%s', (_label, elapsed, accepted) => {
    const result = verify(mint(), { now: NOW + (elapsed as number) })

    expect(result.ok).toBe(accepted)
    if (!accepted) expect(result).toEqual({ ok: false, reason: 'expired' })
  })

  it('refuses an assertion minted for another audience, and still accepts a valid one', () => {
    expect(verify(mint({ audience: 'chat/v1' }))).toEqual({ ok: false, reason: 'audience' })
    stillAcceptsAValidAssertion()
  })

  it.each([
    ['an empty string', ''],
    ['no delimiter', 'notoken'],
    ['two delimiters', 'a.b.c'],
    ['an empty payload half', '.signature'],
    ['an empty signature half', 'payload.'],
    ['a payload that is not base64', '!!!.###'],
    ['a payload that is not JSON', `${Buffer.from('nope', 'utf8').toString('base64url')}.x`],
  ])('refuses %s without throwing, and still accepts a valid one', (_label, malformed) => {
    expect(() => verify(malformed)).not.toThrow()
    expect(verify(malformed).ok).toBe(false)
    stillAcceptsAValidAssertion()
  })

  /**
   * `timingSafeEqual` raises `RangeError` on unequal-length buffers. A verifier
   * that let that escape would answer a wrong-*length* signature with an
   * exception and a wrong-*value* signature with a refusal — two distinguishable
   * outcomes, which is a length oracle. `verifyServiceToken` records the same
   * reasoning for the same primitive.
   */
  it('refuses a signature of the wrong length rather than throwing', () => {
    const [payload] = mint().split('.')

    expect(() => verify(`${payload}.short`)).not.toThrow()
    expect(verify(`${payload}.short`)).toEqual({ ok: false, reason: 'signature' })
    stillAcceptsAValidAssertion()
  })

  /**
   * Unconfigured refuses everybody. The tempting shape — "no key, nothing to
   * check, allow it" — fails open exactly when the endpoint is most exposed: a
   * fresh deploy, a renamed variable, a secret that did not propagate.
   */
  it.each([
    ['an empty key', ''],
    ['a blank key', '   '],
  ])('refuses every assertion when the key is %s', (_label, key) => {
    expect(verify(mint(), { key }).ok).toBe(false)
  })
})
