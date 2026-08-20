import { describe, expect, it, vi } from 'vitest'
import type { DirectoryUser, UserDirectory } from '../ports/user-directory'
import { authenticate, normaliseEmail } from './authenticate'
import { DEFAULT_SCRYPT_PARAMETERS, hashPassword, type ScryptParameters } from './password'

const FAST: ScryptParameters = { cost: 2 ** 8, blockSize: 8, parallelization: 1 }

function fakeDirectory(users: DirectoryUser[]): UserDirectory & { updated: string[] } {
  const updated: string[] = []
  return {
    updated,
    findByEmail: async (email) => users.find((user) => user.email === email) ?? null,
    updatePasswordHash: async (userId) => {
      updated.push(userId)
    },
  }
}

async function member(
  overrides: Partial<DirectoryUser> & { password?: string } = {},
): Promise<DirectoryUser> {
  const { password = 'correct-passphrase', ...rest } = overrides
  return {
    id: 'member-1',
    email: 'director@association.example',
    passwordHash: await hashPassword(password, FAST),
    disabledAt: null,
    associationId: 'association-a',
    ...rest,
  }
}

describe('normaliseEmail', () => {
  it.each([
    ['Director@Association.example', 'director@association.example'],
    ['  director@association.example  ', 'director@association.example'],
    ['DIRECTOR@ASSOCIATION.EXAMPLE', 'director@association.example'],
  ])('normalises %s', (input, expected) => {
    expect(normaliseEmail(input)).toBe(expected)
  })
})

describe('authenticate', () => {
  it('accepts a board member with the right password', async () => {
    const user = await member()

    const result = await authenticate(fakeDirectory([user]), {
      email: user.email,
      password: 'correct-passphrase',
    })

    expect(result).toEqual({
      kind: 'authenticated',
      user: { id: user.id, email: user.email, associationId: 'association-a' },
    })
  })

  /**
   * The association travels with the identity, so a caller cannot hold one
   * without the other. A separate lookup keyed on the id would be a second
   * question with a window between the two answers, and nothing failing when
   * they disagree.
   *
   * `toEqual` above is exact, so this is not the only thing holding the shape —
   * but that test reads as "sign-in works" and would be relaxed by someone who
   * did not know the association was load-bearing. This one says why.
   */
  it('answers with the association the member belongs to', async () => {
    const user = await member({ associationId: 'association-b' })

    const result = await authenticate(fakeDirectory([user]), {
      email: user.email,
      password: 'correct-passphrase',
    })

    expect(result.kind === 'authenticated' && result.user.associationId).toBe('association-b')
  })

  it('accepts an address typed with different capitalisation', async () => {
    const user = await member()

    const result = await authenticate(fakeDirectory([user]), {
      email: 'Director@Association.EXAMPLE',
      password: 'correct-passphrase',
    })

    expect(result.kind).toBe('authenticated')
  })

  it('rejects the wrong password', async () => {
    const user = await member()

    const result = await authenticate(fakeDirectory([user]), {
      email: user.email,
      password: 'not-the-passphrase',
    })

    expect(result).toEqual({ kind: 'rejected' })
  })

  it('rejects an unknown address', async () => {
    const result = await authenticate(fakeDirectory([]), {
      email: 'stranger@example.com',
      password: 'anything',
    })

    expect(result).toEqual({ kind: 'rejected' })
  })

  /**
   * A member who has left the board keeps their audit trail and loses access.
   * Checked *after* the password so that a disabled account is indistinguishable
   * from a wrong password to anyone who does not already know the password.
   */
  it('rejects a disabled member even with the right password', async () => {
    const user = await member({ disabledAt: new Date('2026-01-01T00:00:00Z') })

    const result = await authenticate(fakeDirectory([user]), {
      email: user.email,
      password: 'correct-passphrase',
    })

    expect(result).toEqual({ kind: 'rejected' })
  })

  it.each([
    ['a missing email', { email: undefined, password: 'x' }],
    ['a missing password', { email: 'a@b.example', password: undefined }],
    ['a non-string email', { email: 42, password: 'x' }],
    ['a non-string password', { email: 'a@b.example', password: {} }],
    ['an empty email', { email: '   ', password: 'x' }],
    ['an empty password', { email: 'a@b.example', password: '' }],
  ])('rejects %s without consulting the directory', async (_label, credentials) => {
    const directory = fakeDirectory([])
    const spy = vi.spyOn(directory, 'findByEmail')

    const result = await authenticate(directory, credentials)

    expect(result).toEqual({ kind: 'rejected' })
    expect(spy).not.toHaveBeenCalled()
  })

  /**
   * Without a dummy verification on the absent-user path, sign-in answers "does
   * this address belong to a director?" in a few milliseconds to anyone who
   * asks. The assertion is deliberately loose — wall-clock timing is not
   * reliable in a test runner — but a missing-user path that skipped the work
   * entirely would return an order of magnitude faster and fail this.
   */
  it('spends comparable effort on an unknown address as on a wrong password', async () => {
    const user = await member({ passwordHash: await hashPassword('pw', DEFAULT_SCRYPT_PARAMETERS) })

    const startKnown = performance.now()
    await authenticate(fakeDirectory([user]), { email: user.email, password: 'wrong' })
    const knownElapsed = performance.now() - startKnown

    const startUnknown = performance.now()
    await authenticate(fakeDirectory([user]), { email: 'nobody@example.com', password: 'wrong' })
    const unknownElapsed = performance.now() - startUnknown

    expect(unknownElapsed).toBeGreaterThan(knownElapsed / 10)
    // Three real scrypt operations at DEFAULT_SCRYPT_PARAMETERS, which are
    // expensive on purpose. Vitest's 5s default was enough while the suite was
    // smaller; story 2.1 added a test file and the extra parallel load pushed
    // this past it — reproducibly in the full run, never on its own.
    //
    // Raising the bound does not weaken what this asserts. The assertion is a
    // *ratio* between the two paths, so it is unaffected by how slow the machine
    // is; the timeout only decides whether the test gets to finish. Verified by
    // removing the dummy verification from the absent-user path with this
    // timeout in place: the test still fails.
  }, 30_000)

  it('re-hashes a password stored under weaker parameters', async () => {
    const user = await member({ passwordHash: await hashPassword('correct-passphrase', FAST) })
    const directory = fakeDirectory([user])

    await authenticate(directory, { email: user.email, password: 'correct-passphrase' })

    expect(directory.updated).toEqual([user.id])
  })

  it('does not re-hash a password already at current strength', async () => {
    const user = await member({
      passwordHash: await hashPassword('correct-passphrase', DEFAULT_SCRYPT_PARAMETERS),
    })
    const directory = fakeDirectory([user])

    await authenticate(directory, { email: user.email, password: 'correct-passphrase' })

    expect(directory.updated).toEqual([])
  })

  it('still signs the member in when the opportunistic re-hash fails', async () => {
    const user = await member({ passwordHash: await hashPassword('correct-passphrase', FAST) })
    const directory: UserDirectory = {
      findByEmail: async () => user,
      updatePasswordHash: async () => {
        throw new Error('database unavailable')
      },
    }

    const result = await authenticate(directory, {
      email: user.email,
      password: 'correct-passphrase',
    })

    expect(result.kind).toBe('authenticated')
  })

  it('never reports why it rejected — one shape for every failure', async () => {
    const user = await member({ disabledAt: new Date() })
    const directory = fakeDirectory([user])

    const outcomes = await Promise.all([
      authenticate(directory, { email: user.email, password: 'wrong' }),
      authenticate(directory, { email: user.email, password: 'correct-passphrase' }),
      authenticate(directory, { email: 'nobody@example.com', password: 'wrong' }),
    ])

    for (const outcome of outcomes) {
      expect(outcome).toEqual({ kind: 'rejected' })
    }
  })
})
