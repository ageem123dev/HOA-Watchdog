/**
 * Whether a caller presenting a token is the agent service.
 *
 * AD-15: the `/tools/*` endpoints "must reject any caller that is not the agent
 * service". The architecture gives that rule two mechanisms — the endpoints are
 * bound to a private network, and the caller presents a shared token — and
 * **only the second one exists yet**. The Railway private network is a
 * deployment task (epics.md, 2026-08-07), so until it is done this function is
 * the entire boundary between the public internet and the association's
 * records. It is written for that job rather than for the one it will have
 * later.
 *
 * Pure, and it reads no environment. The variable is the adapter's to fetch,
 * which is what lets the case that matters — nothing configured — be tested at
 * all.
 */

import { timingSafeEqual } from 'node:crypto'

/**
 * **Unconfigured rejects everybody.** The tempting shape is
 *
 * ```ts
 * if (!configured) return true   // "nothing to check"
 * ```
 *
 * and it fails open at the exact moment the endpoint is most exposed: a fresh
 * deploy, a renamed variable, a secret that did not propagate. `readWriterDatabaseUrl`
 * in `adapters/auth/env.ts` sets the house precedent — absent configuration
 * throws, it does not degrade.
 *
 * **A length mismatch returns `false`, it does not throw.** `timingSafeEqual`
 * requires equal-length buffers and raises `RangeError` otherwise, so a wrapper
 * that let that escape would answer a wrong-length token with an exception and a
 * wrong-value token with `false` — two distinguishable outcomes, which is a
 * length oracle. The length of the configured token is not worth protecting; the
 * *kind* of answer is.
 *
 * Lengths are compared in **bytes**, because that is what the buffers hold. A
 * multi-byte character makes `String.length` disagree with `Buffer.byteLength`,
 * and mixing the two is how a comparison reads past the shorter buffer.
 */
export function verifyServiceToken(presented: unknown, configured: unknown): boolean {
  if (typeof configured !== 'string' || configured.trim() === '') return false
  if (typeof presented !== 'string' || presented.trim() === '') return false

  const presentedBytes = Buffer.from(presented, 'utf8')
  const configuredBytes = Buffer.from(configured, 'utf8')

  if (presentedBytes.length !== configuredBytes.length) return false

  return timingSafeEqual(presentedBytes, configuredBytes)
}
