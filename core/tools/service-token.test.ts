/**
 * AD-15's caller check, at the point where a stranger becomes the agent service.
 *
 * "The Python agent service reaches Node only through versioned `/tools/*`
 * endpoints, which are the sole data path in the system and **must reject any
 * caller that is not the agent service**."
 *
 * The architecture gave that rule two mechanisms — a private network and a
 * shared token — and the private network does not exist yet (epics.md,
 * 2026-08-07). Until it does, **this function is the whole of the check**, so it
 * is tested as the only thing standing between the internet and the catalog
 * rather than as a string comparison.
 *
 * The case that matters most is the one that looks like a convenience: an
 * unconfigured token must reject everybody. A fresh deploy, a renamed variable
 * or a secret that failed to propagate is exactly when the endpoint is most
 * exposed and least watched.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { verifyServiceToken } from './service-token'

const TOKEN = 'r7Qx-4kP9mVt2LbN8sYw0aZc'

describe('verifying the agent service token', () => {
  it('accepts the configured token', () => {
    expect(verifyServiceToken(TOKEN, TOKEN)).toBe(true)
  })

  describe('rejects a caller who is not the agent service', () => {
    it('rejects a different token of the same length', () => {
      const wrong = `${'x'.repeat(TOKEN.length - 1)}y`

      expect(wrong).toHaveLength(TOKEN.length)
      expect(verifyServiceToken(wrong, TOKEN)).toBe(false)
    })

    /**
     * `crypto.timingSafeEqual` throws `RangeError` on unequal-length buffers, so
     * the naive wrapper answers a wrong-length token with an exception and a
     * wrong-value token with `false`. Two different kinds of outcome is a length
     * oracle. This must be a plain `false`.
     */
    it('rejects a token of a different length without throwing', () => {
      expect(() => verifyServiceToken('short', TOKEN)).not.toThrow()
      expect(verifyServiceToken('short', TOKEN)).toBe(false)
      expect(verifyServiceToken(`${TOKEN}extra`, TOKEN)).toBe(false)
    })

    it('rejects a prefix of the configured token', () => {
      expect(verifyServiceToken(TOKEN.slice(0, -1), TOKEN)).toBe(false)
    })

    it.each([
      ['an empty string', ''],
      ['whitespace', '   '],
      ['undefined', undefined],
      ['null', null],
      ['a number', 12345],
      ['an object', { token: TOKEN }],
    ])('rejects %s as a presented token', (_label, presented) => {
      expect(verifyServiceToken(presented, TOKEN)).toBe(false)
    })

    /**
     * Byte length, not character length. A multi-byte character makes
     * `String.length` and `Buffer.byteLength` disagree, and a comparison that
     * mixed the two would either throw or read past the shorter buffer.
     */
    it('rejects a token that differs only beyond the ASCII range', () => {
      expect(verifyServiceToken('café', 'cafe')).toBe(false)
      expect(verifyServiceToken('cafe', 'café')).toBe(false)
    })
  })

  /**
   * AC3. The whole point: unconfigured means "reject everyone", never "nothing
   * to check". The natural implementation — `if (!configured) return true` —
   * passes every test above and opens the catalog to the internet on the day the
   * secret fails to propagate.
   */
  describe('fails closed when no token is configured', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['an empty string', ''],
      ['whitespace only', ' \t\n '],
      ['a non-string', 42],
    ])('rejects the correct-looking token when configuration is %s', (_label, configured) => {
      expect(verifyServiceToken(TOKEN, configured)).toBe(false)
    })

    it('rejects a caller presenting nothing when configuration is absent', () => {
      expect(verifyServiceToken(undefined, undefined)).toBe(false)
      expect(verifyServiceToken('', '')).toBe(false)
    })
  })

  /**
   * Constant-time comparison cannot be observed from a unit test without timing
   * measurements that are flaky on shared hardware, so what is asserted is that
   * the module reaches for the primitive rather than for `===`.
   *
   * This proves the call exists, not that every path takes it — a real limit,
   * stated rather than implied. The behavioural half is covered above: a
   * length mismatch returns `false` rather than throwing, which is the leak a
   * hand-rolled comparison actually produces.
   */
  it('compares with timingSafeEqual rather than string equality', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'service-token.ts'),
      'utf8',
    )
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

    expect(code).toContain('timingSafeEqual')
    expect(code).not.toMatch(/presented\s*===\s*configured/)
  })
})
