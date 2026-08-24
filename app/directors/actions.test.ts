/**
 * Provisioning a director from inside the product (story 5.9).
 *
 * ## The value this file exists to protect
 *
 * Every other server action here handles data. This one produces a **secret** —
 * a password shown once and never recoverable. Two of its failure modes are
 * unique to that:
 *
 * - the password reaching a log, where it outlives the page and the session
 * - the *plaintext* being stored instead of the hash, which is one letter apart
 *   from correct and leaves a working account with a readable password
 *
 * Both are asserted directly rather than inferred from the happy path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { verifyPassword } from '@/core/auth/password'

const auth = vi.fn()
const add = vi.fn<
  (invitedBy: string, email: string, displayName: string | null, hash: string) => Promise<boolean>
>(async () => true)
const logged: unknown[][] = []

vi.mock('@/adapters/auth/auth', () => ({ auth: () => auth() }))
vi.mock('@/adapters/db/director-roster-postgres', () => ({
  createDirectorRoster: () => ({
    add: (invitedBy: string, email: string, name: string | null, hash: string) =>
      add(invitedBy, email, name, hash),
  }),
}))

const SIGNED_IN = { user: { id: 'director-1' } }

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const provision = async (fields: Record<string, string>) => {
  const { addDirector } = await import('./actions')
  return addDirector({ status: 'idle' }, form(fields))
}

beforeEach(() => {
  vi.clearAllMocks()
  logged.length = 0
  auth.mockResolvedValue(SIGNED_IN)
  // `clearAllMocks` clears calls but keeps implementations.
  add.mockResolvedValue(true)
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args)
  })
})

describe('provisioning a colleague', () => {
  it('returns a password the new director can actually sign in with', async () => {
    /**
     * The cross-check, and the only assertion that proves the hand-off works.
     * Showing *a* password and storing *a* hash is not enough — they have to be
     * the same secret, or the account exists and nobody can use it.
     */
    const state = await provision({ email: 'New.Director@example.com', displayName: 'New Director' })

    expect(state.status).toBe('added')

    const shown = (state as { password: string }).password
    const storedHash = add.mock.calls[0]?.[3] ?? ''

    expect(shown.length).toBeGreaterThan(12)
    await expect(verifyPassword(shown, storedHash)).resolves.toBe(true)
  })

  it('stores a hash, never the password itself', async () => {
    // 2d. One letter apart from correct, and it leaves a working account whose
    // password is readable by anyone with the database.
    const state = await provision({ email: 'new@example.com', displayName: '' })

    const shown = (state as { password: string }).password
    const storedHash = add.mock.calls[0]?.[3] ?? ''

    expect(storedHash).not.toBe(shown)
    expect(storedHash).not.toContain(shown)
  })

  it('adds on behalf of the signed-in director, never anyone else', async () => {
    await provision({ email: 'new@example.com', displayName: '' })

    const invitedBy = add.mock.calls[0]?.[0]

    expect(invitedBy).toBe('director-1')
  })

  it('refuses an address already on a board, without showing a password', async () => {
    /**
     * 2e. Reporting success here hands the director a password that works for
     * nobody and leaves them believing a colleague was added.
     */
    add.mockResolvedValue(false)

    const state = await provision({ email: 'already@example.com', displayName: '' })

    expect(state.status).toBe('error')
    expect(JSON.stringify(state)).not.toMatch(/password/i)
  })
})

describe('the ways it must refuse', () => {
  it('refuses without a session', async () => {
    // A server action is its own entry point; the page's protection guards
    // nothing here.
    auth.mockResolvedValue(null)

    const state = await provision({ email: 'new@example.com', displayName: '' })

    expect(state.status).toBe('error')
    expect(add).not.toHaveBeenCalled()
  })

  it('refuses an empty address rather than letting the constraint do it', async () => {
    const state = await provision({ email: '   ', displayName: '' })

    expect(state.status).toBe('error')
    expect(add).not.toHaveBeenCalled()
  })

  it('reports a failure instead of throwing out of the action', async () => {
    // 2f. An unhandled rejection is a generic 500 with the form gone and
    // nothing said about whether the account exists.
    add.mockRejectedValue(new Error('the database said no'))

    const state = await provision({ email: 'new@example.com', displayName: '' })

    expect(state.status).toBe('error')
    expect(JSON.stringify(state)).not.toContain('the database said no')
  })
})

describe('the password never reaches a log', () => {
  it('logs the failure without the secret', async () => {
    /**
     * 2a, and the reason this file exists. A password in the log store outlives
     * the page, the session and the person who was handed it — and this is the
     * one action in the project that has a secret to leak.
     *
     * The failure path is where it would happen: a `console.error(error,
     * formData)` written for debugging would carry the whole submission.
     */
    add.mockRejectedValue(new Error('the database said no'))

    const state = await provision({ email: 'new@example.com', displayName: '' })

    expect(state.status).toBe('error')

    /**
     * The exact permitted shape, not the absence of one word.
     *
     * `not.toMatch(/password/i)` passes for a log line carrying the whole
     * submission, or the generated secret under a different name, or anything
     * else that happens not to spell "password" - and the risk here is a
     * `console.error(error, formData)` written while debugging. Asserting the
     * shape means any extra argument fails, whatever it contains. Raised by
     * CodeRabbit.
     */
    expect(logged).toHaveLength(1)

    const [message, thrown, ...extra] = logged[0] as [string, Error, ...unknown[]]

    expect(message).toBe('[directors] a director could not be added')
    expect(thrown).toBeInstanceOf(Error)
    expect(extra).toEqual([])
  })

  it('logs nothing at all on the happy path', async () => {
    // The control: if this path logged, the assertion above would be measuring
    // the wrong run.
    await provision({ email: 'new@example.com', displayName: '' })

    expect(logged).toEqual([])
  })
})
