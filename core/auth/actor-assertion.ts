/**
 * AD-18's mechanism: proof of *which board member* a tool request is for.
 *
 * The Node gateway mints one on the way out and verifies it on the way back in.
 * The agent service relays it and holds no key. AD-15's and AD-17's tokens
 * authenticate **runtimes**; this authenticates a **subject**, which is the gap
 * AD-18 exists to name.
 *
 * ## Why HMAC with no algorithm field, rather than a JWT library
 *
 * There is no second party to negotiate an algorithm with — Node signs and Node
 * verifies — so an `alg` field would buy nothing and carry JWT's classic
 * confusion vector. The format is fixed: `base64url(payload).base64url(hmac)`,
 * SHA-256, and a verifier that recomputes rather than reads. That is a standard
 * primitive used as intended; what is avoided is the parsing surface where
 * JWT's actual CVEs live.
 *
 * ## Pure, and that is what makes the important case testable
 *
 * The key and the clock are arguments. `core/tools/service-token.ts` records the
 * same decision for the same reason: the case worth testing hardest is **nothing
 * configured**, and a module that fetches its own key cannot be asked about it.
 *
 * ## What the payload deliberately does not carry
 *
 * No association. Story 5.1b derives that from the subject inside the provenance
 * write, and a copy here would be a second source that can disagree with the
 * database — the shape migration 007's comment warns about, and the shape 5.1b
 * spent itself removing.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export interface MintOptions {
  /** The signing secret. Blank refuses to mint rather than producing something unsigned. */
  readonly key: string
  /** Milliseconds since the epoch, supplied by the caller. Never read from a clock here. */
  readonly now: number
  /** How long the assertion is good for. Must be positive: zero is born expired. */
  readonly ttlMs: number
  /** Who the assertion is for — `tools/v1`. Checked on verify. */
  readonly audience: string
}

export interface VerifyOptions {
  readonly key: string
  readonly now: number
  readonly audience: string
}

export type VerifyResult =
  | { readonly ok: true; readonly subject: string }
  | {
      readonly ok: false
      readonly reason: 'signature' | 'expired' | 'audience' | 'malformed' | 'unconfigured'
    }

/**
 * How long an assertion is good for — AD-18's expiry window.
 *
 * Long enough that a slow model call does not fail a legitimate turn: the
 * gateway's chat timeout is 60s and a turn is a model call plus a catalog
 * execution. Short enough that a relayed assertion is not a bearer credential
 * for that member — five minutes bounds replay to the turn it was minted for
 * and a little either side, rather than to a session.
 */
export const ACTOR_ASSERTION_TTL_MS = 5 * 60_000

/**
 * Who the assertion is for. **In `core`, so the minter and the verifier read the
 * same constant.** A copy on each side is two statements of one rule with
 * nothing failing on disagreement: they would drift, and the symptom would be
 * every turn refused for `audience` with both sides looking correct in isolation.
 */
export const ACTOR_ASSERTION_AUDIENCE = 'tools/v1'

/** The one place the wire format is written down. */
const DELIMITER = '.'

const sign = (payload: string, key: string) =>
  createHmac('sha256', key).update(payload).digest('base64url')

interface Claims {
  readonly sub: string
  readonly exp: number
  readonly aud: string
}

export function mintActorAssertion(subject: string, options: MintOptions): string {
  if (typeof options.key !== 'string' || options.key.trim() === '') {
    throw new Error('an actor assertion needs a signing key; refusing to mint an unsigned one')
  }
  if (typeof subject !== 'string' || subject.trim() === '') {
    throw new Error('an actor assertion needs a subject; refusing to mint one that names nobody')
  }
  if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
    throw new Error('an actor assertion needs a positive ttlMs; zero or less is born expired')
  }

  const claims: Claims = {
    sub: subject,
    exp: options.now + options.ttlMs,
    aud: options.audience,
  }

  // base64url, so no field can contain the delimiter and shift the boundary —
  // the subject is a database id today and a delimiter-bearing one tomorrow.
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')

  return `${payload}${DELIMITER}${sign(payload, options.key)}`
}

export function verifyActorAssertion(assertion: string, options: VerifyOptions): VerifyResult {
  // Unconfigured refuses everybody. The tempting shape — "no key, nothing to
  // check" — fails open when the endpoint is most exposed: a fresh deploy, a
  // renamed variable, a secret that did not propagate.
  if (typeof options.key !== 'string' || options.key.trim() === '') {
    return { ok: false, reason: 'unconfigured' }
  }
  if (typeof assertion !== 'string') return { ok: false, reason: 'malformed' }

  const parts = assertion.split(DELIMITER)
  if (parts.length !== 2) return { ok: false, reason: 'malformed' }

  const [payload, presented] = parts as [string, string]
  if (payload === '' || presented === '') return { ok: false, reason: 'malformed' }

  // Signature before payload, so a *tampered* assertion is reported as a bad
  // signature rather than as malformed. The two are different events: one is
  // somebody trying, the other is something broken.
  const expected = sign(payload, options.key)
  const presentedBytes = Buffer.from(presented, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')

  // Length first. `timingSafeEqual` raises `RangeError` on unequal lengths, and
  // letting that escape would answer a wrong-length signature with an exception
  // and a wrong-value one with a refusal — a length oracle. `verifyServiceToken`
  // records the same reasoning for the same primitive.
  if (presentedBytes.length !== expectedBytes.length) return { ok: false, reason: 'signature' }
  if (!timingSafeEqual(presentedBytes, expectedBytes)) return { ok: false, reason: 'signature' }

  let claims: Claims
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
      return { ok: false, reason: 'malformed' }
    }
    const { sub, exp, aud } = decoded as Record<string, unknown>
    if (typeof sub !== 'string' || sub.trim() === '') return { ok: false, reason: 'malformed' }
    if (typeof exp !== 'number' || !Number.isFinite(exp)) return { ok: false, reason: 'malformed' }
    if (typeof aud !== 'string') return { ok: false, reason: 'malformed' }
    claims = { sub, exp, aud }
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  if (claims.aud !== options.audience) return { ok: false, reason: 'audience' }
  // `>=`: at the expiry instant it is expired. A boundary that admits the exact
  // millisecond is a boundary nobody can state.
  if (options.now >= claims.exp) return { ok: false, reason: 'expired' }

  return { ok: true, subject: claims.sub }
}
