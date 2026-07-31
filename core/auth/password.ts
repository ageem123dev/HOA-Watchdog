import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/**
 * Password hashing and verification.
 *
 * Uses scrypt from Node's own crypto module rather than adding argon2 or bcrypt.
 * scrypt is a memory-hard KDF designed for exactly this, it ships with the
 * runtime, and it needs no native compilation step in a container build — which
 * is the boring choice for a dependency that guards board members' access to an
 * association's financial records.
 *
 * The stored format is `scrypt$N$r$p$salt$hash`, all base64url. The parameters
 * travel with the hash so raising them later does not invalidate existing
 * passwords: an old hash still verifies against the parameters it was made with.
 */

export interface ScryptParameters {
  readonly cost: number
  readonly blockSize: number
  readonly parallelization: number
}

/**
 * OWASP's scrypt guidance: N=2^17, r=8, p=1. Raising `cost` later is safe — the
 * value used for a given password is read back from that password's own hash.
 */
export const DEFAULT_SCRYPT_PARAMETERS: ScryptParameters = {
  cost: 2 ** 17,
  blockSize: 8,
  parallelization: 1,
}

const SALT_BYTES = 16
const KEY_BYTES = 64
const SCHEME = 'scrypt'

/** scrypt needs maxmem above roughly 128 * N * r; give it headroom. */
function maxmemFor({ cost, blockSize }: ScryptParameters): number {
  return 256 * cost * blockSize
}

function derive(
  password: string,
  salt: Buffer,
  parameters: ScryptParameters,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_BYTES,
      {
        N: parameters.cost,
        r: parameters.blockSize,
        p: parameters.parallelization,
        maxmem: maxmemFor(parameters),
      },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)),
    )
  })
}

export async function hashPassword(
  password: string,
  parameters: ScryptParameters = DEFAULT_SCRYPT_PARAMETERS,
): Promise<string> {
  if (typeof password !== 'string' || password === '') {
    throw new TypeError('hashPassword expects a non-empty password')
  }

  const salt = randomBytes(SALT_BYTES)
  const derived = await derive(password, salt, parameters)

  return [
    SCHEME,
    parameters.cost,
    parameters.blockSize,
    parameters.parallelization,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$')
}

interface ParsedHash {
  readonly parameters: ScryptParameters
  readonly salt: Buffer
  readonly key: Buffer
}

function parseStoredHash(stored: string): ParsedHash | null {
  if (typeof stored !== 'string') return null

  const parts = stored.split('$')
  if (parts.length !== 6) return null

  const [scheme, cost, blockSize, parallelization, salt, key] = parts
  if (scheme !== SCHEME) return null

  const parameters = {
    cost: Number(cost),
    blockSize: Number(blockSize),
    parallelization: Number(parallelization),
  }

  if (!Object.values(parameters).every((value) => Number.isInteger(value) && value > 0)) return null

  return {
    parameters,
    salt: Buffer.from(salt as string, 'base64url'),
    key: Buffer.from(key as string, 'base64url'),
  }
}

/**
 * Returns false for a wrong password and for a malformed stored hash alike —
 * never throws on bad stored data, because a corrupt row must read as "this
 * password does not match", not as a 500 that tells an attacker the account
 * exists and is in an unusual state.
 *
 * The comparison is timing-safe. Length is checked first because
 * `timingSafeEqual` throws on a length mismatch, and that throw would itself be
 * an observable timing signal.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== 'string' || password === '') return false

  const parsed = parseStoredHash(stored)
  if (parsed === null) return false

  let derived: Buffer
  try {
    derived = await derive(password, parsed.salt, parsed.parameters)
  } catch {
    // Absurd parameters in a stored hash (a cost value that exhausts maxmem) must
    // fail closed rather than propagate.
    return false
  }

  if (derived.length !== parsed.key.length) return false

  return timingSafeEqual(derived, parsed.key)
}

/**
 * Whether a stored hash was made with weaker parameters than we now use, so the
 * caller can transparently re-hash on a successful sign-in.
 */
export function needsRehash(
  stored: string,
  parameters: ScryptParameters = DEFAULT_SCRYPT_PARAMETERS,
): boolean {
  const parsed = parseStoredHash(stored)
  if (parsed === null) return true

  return (
    parsed.parameters.cost < parameters.cost ||
    parsed.parameters.blockSize < parameters.blockSize ||
    parsed.parameters.parallelization < parameters.parallelization
  )
}
