/**
 * What `replace` does with the connection when it fails.
 *
 * The sibling file exercises this repository against the real database, which
 * is the right place for everything except this: a rollback that itself fails
 * cannot be provoked from outside, so the branch that destroys the poisoned
 * client was carried by no test at all. Raised by review.
 *
 * Two cases, not one. A single test asserting `release(true)` would pass just as
 * happily against a repository that destroys the client on *every* failure — and
 * that repository would throw away a healthy connection each time a document hit
 * a constraint. Only the pair says the argument tracks the rollback.
 */

import type { Pool, PoolClient } from 'pg'
import { describe, expect, it } from 'vitest'

import type { ResolvedLine } from '../../core/payment/resolve-line'
import { createPaymentRepository } from './payment-repository-postgres'

const DOCUMENT_ID = '00000000-0000-4000-8000-000000000001'

const lines: readonly ResolvedLine[] = [
  {
    kind: 'attributed',
    unitId: '00000000-0000-4000-8000-000000000002',
    paidOn: '2026-03-01',
    amount: '250.00',
  },
]

/** The failure the caller should see — distinct from the rollback's own. */
const INSERT_FAILED = new Error('insert failed')
const ROLLBACK_FAILED = new Error('rollback failed')

type ReleaseCall = boolean | undefined

/**
 * A client that fails the write, and fails the rollback or not as asked.
 *
 * `begin` and the lock succeed, because the point is a failure *inside* an open
 * transaction — that is the state which leaves the connection unusable.
 */
function fakeClient(options: { rollbackFails: boolean }): {
  client: PoolClient
  releases: ReleaseCall[]
} {
  const releases: ReleaseCall[] = []

  const client = {
    query: (text: string) => {
      if (text === 'rollback') {
        return options.rollbackFails ? Promise.reject(ROLLBACK_FAILED) : Promise.resolve({ rows: [] })
      }
      if (text.startsWith('insert into payment')) return Promise.reject(INSERT_FAILED)
      return Promise.resolve({ rows: [] })
    },
    release: (destroy?: boolean) => {
      releases.push(destroy)
    },
  } as unknown as PoolClient

  return { client, releases }
}

const poolOf = (client: PoolClient): Pool =>
  ({ connect: () => Promise.resolve(client) }) as unknown as Pool

describe('releasing the connection when replace fails', () => {
  it('destroys the client when the rollback also fails', async () => {
    const { client, releases } = fakeClient({ rollbackFails: true })
    const repository = createPaymentRepository({ pool: poolOf(client) })

    await expect(repository.replace(DOCUMENT_ID, lines)).rejects.toBe(INSERT_FAILED)

    // `true` is `release`'s destroy flag: the connection is still inside an open
    // transaction, and returning it to the pool hands the next caller a session
    // that will reject everything it is asked to do.
    expect(releases).toEqual([true])
  })

  it('returns the client to the pool when the rollback succeeds', async () => {
    const { client, releases } = fakeClient({ rollbackFails: false })
    const repository = createPaymentRepository({ pool: poolOf(client) })

    await expect(repository.replace(DOCUMENT_ID, lines)).rejects.toBe(INSERT_FAILED)

    // Not destroyed. A document that fails a constraint is ordinary, and burning
    // a connection every time one does would drain a pool of five.
    expect(releases).toEqual([false])
  })

  it('reports the failure that happened, not the rollback that followed it', async () => {
    // The rollback's own error must not replace the caller's. `rollback failed`
    // says nothing about which line the document could not store.
    const { client } = fakeClient({ rollbackFails: true })
    const repository = createPaymentRepository({ pool: poolOf(client) })

    await expect(repository.replace(DOCUMENT_ID, lines)).rejects.toThrow('insert failed')
  })

  it('releases exactly once when the rollback fails', async () => {
    // The `finally` block releases too. Its `released` flag is what stops a
    // second release on this path, and a double release corrupts the pool's
    // accounting — the assertion above would pass with `[true, undefined]`
    // only if it did not check the whole array, so this states the count itself.
    const { client, releases } = fakeClient({ rollbackFails: true })
    const repository = createPaymentRepository({ pool: poolOf(client) })

    await expect(repository.replace(DOCUMENT_ID, lines)).rejects.toBe(INSERT_FAILED)

    expect(releases).toHaveLength(1)
  })
})
