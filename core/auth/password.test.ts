import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCRYPT_PARAMETERS,
  hashPassword,
  needsRehash,
  verifyPassword,
  type ScryptParameters,
} from './password'

/**
 * Deliberately weak parameters so the suite stays fast. Every property under
 * test is independent of the cost factor; the production factor is asserted
 * separately against the OWASP guidance.
 */
const FAST: ScryptParameters = { cost: 2 ** 8, blockSize: 8, parallelization: 1 }

describe('hashPassword', () => {
  it('produces a verifiable hash — the round trip that matters', async () => {
    const stored = await hashPassword('correct horse battery staple', FAST)

    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true)
  })

  it('records the scheme and parameters alongside the hash', async () => {
    const stored = await hashPassword('pw', FAST)
    const [scheme, cost, blockSize, parallelization] = stored.split('$')

    expect(scheme).toBe('scrypt')
    expect(Number(cost)).toBe(FAST.cost)
    expect(Number(blockSize)).toBe(FAST.blockSize)
    expect(Number(parallelization)).toBe(FAST.parallelization)
  })

  it('salts, so the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword('same', FAST), hashPassword('same', FAST)])

    expect(a).not.toBe(b)
    await expect(verifyPassword('same', a)).resolves.toBe(true)
    await expect(verifyPassword('same', b)).resolves.toBe(true)
  })

  it('never contains the password itself', async () => {
    const stored = await hashPassword('sekrit-value', FAST)

    expect(stored).not.toContain('sekrit-value')
  })

  it.each([
    ['an empty password', ''],
    ['a non-string', null],
  ])('rejects %s rather than hashing nothing', async (_label, password) => {
    await expect(hashPassword(password as never, FAST)).rejects.toThrow(TypeError)
  })

  it('handles a very long password', async () => {
    const long = 'a'.repeat(4096)
    const stored = await hashPassword(long, FAST)

    await expect(verifyPassword(long, stored)).resolves.toBe(true)
  })

  it('handles non-ASCII passwords', async () => {
    const stored = await hashPassword('пароль-πάσσword-🔐', FAST)

    await expect(verifyPassword('пароль-πάσσword-🔐', stored)).resolves.toBe(true)
  })

  /**
   * The same characters can have more than one Unicode encoding. Without
   * normalisation a password typed on one platform can fail on another, which
   * presents to a director as "my password stopped working".
   */
  it('normalises Unicode, so a decomposed form verifies against a composed one', async () => {
    const composed = 'café'.normalize('NFC')
    const decomposed = 'café'.normalize('NFD')

    expect(composed).not.toBe(decomposed)
    const stored = await hashPassword(composed, FAST)

    await expect(verifyPassword(decomposed, stored)).resolves.toBe(true)
  })
})

describe('verifyPassword', () => {
  it('rejects the wrong password', async () => {
    const stored = await hashPassword('right', FAST)

    await expect(verifyPassword('wrong', stored)).resolves.toBe(false)
  })

  it('rejects a password differing by one character', async () => {
    const stored = await hashPassword('passphrase', FAST)

    await expect(verifyPassword('passphrasE', stored)).resolves.toBe(false)
  })

  it('rejects an empty password against a real hash', async () => {
    const stored = await hashPassword('something', FAST)

    await expect(verifyPassword('', stored)).resolves.toBe(false)
  })

  /**
   * A corrupt or truncated row must read as "does not match", not as an
   * exception — a 500 tells an attacker the account exists and is in an unusual
   * state, which is more than a failed sign-in should ever reveal.
   */
  it.each([
    ['an empty string', ''],
    ['a plain-text password', 'hunter2'],
    ['a bcrypt hash from another system', '$2b$12$abcdefghijklmnopqrstuv'],
    ['the wrong scheme', 'argon2$1$2$3$c2FsdA$aGFzaA'],
    ['too few fields', 'scrypt$256$8$c2FsdA'],
    ['too many fields', 'scrypt$256$8$1$c2FsdA$aGFzaA$extra'],
    ['a non-numeric cost', 'scrypt$abc$8$1$c2FsdA$aGFzaA'],
    ['a zero cost', 'scrypt$0$8$1$c2FsdA$aGFzaA'],
    ['a negative cost', 'scrypt$-1$8$1$c2FsdA$aGFzaA'],
    ['a truncated hash', 'scrypt$256$8$1$c2FsdA$'],
  ])('returns false without throwing for %s', async (_label, stored) => {
    await expect(verifyPassword('anything', stored)).resolves.toBe(false)
  })

  it('returns false for a non-string stored value', async () => {
    await expect(verifyPassword('anything', null as never)).resolves.toBe(false)
  })

  /**
   * A cost factor large enough to exhaust maxmem makes scrypt throw. A stored
   * hash is attacker-influenced only via a database compromise, but failing
   * closed costs nothing and a propagated error would be a 500 on the sign-in
   * path.
   */
  it('fails closed rather than throwing on absurd stored parameters', async () => {
    const absurd = `scrypt$${2 ** 30}$8$1$c2FsdA$aGFzaA`

    await expect(verifyPassword('anything', absurd)).resolves.toBe(false)
  })

  it('verifies against the parameters stored with the hash, not the current defaults', async () => {
    // An old password hashed with weaker parameters must keep working after the
    // defaults are raised, or raising them locks every existing director out.
    const old = await hashPassword('legacy', { cost: 2 ** 7, blockSize: 8, parallelization: 1 })

    await expect(verifyPassword('legacy', old)).resolves.toBe(true)
  })
})

describe('needsRehash', () => {
  it('is true for a hash made with a weaker cost than the current default', async () => {
    const old = await hashPassword('pw', { cost: 2 ** 7, blockSize: 8, parallelization: 1 })

    expect(needsRehash(old)).toBe(true)
  })

  it('is false for a hash made with the current default', async () => {
    const current = await hashPassword('pw', DEFAULT_SCRYPT_PARAMETERS)

    expect(needsRehash(current)).toBe(false)
  })

  it('is true for a malformed hash, so a bad row gets replaced on next sign-in', () => {
    expect(needsRehash('not-a-hash')).toBe(true)
  })
})

describe('production parameters', () => {
  it('meets the OWASP scrypt guidance of N=2^17, r=8, p=1', () => {
    expect(DEFAULT_SCRYPT_PARAMETERS.cost).toBeGreaterThanOrEqual(2 ** 17)
    expect(DEFAULT_SCRYPT_PARAMETERS.blockSize).toBeGreaterThanOrEqual(8)
    expect(DEFAULT_SCRYPT_PARAMETERS.parallelization).toBeGreaterThanOrEqual(1)
  })

  it('is usable in practice — a real hash and verify completes', async () => {
    const stored = await hashPassword('a realistic passphrase', DEFAULT_SCRYPT_PARAMETERS)

    await expect(verifyPassword('a realistic passphrase', stored)).resolves.toBe(true)
    await expect(verifyPassword('not it', stored)).resolves.toBe(false)
  })
})
