/**
 * What happens to the connection when the rollback itself fails.
 *
 * `replace` wraps a delete and a set of inserts in one transaction, and rolls
 * back if anything inside fails. **If the rollback also fails the connection is
 * still inside that transaction**, and releasing it normally hands the next
 * caller a client that will reject everything it is given.
 *
 * That mattered less when this module owned its own pool. It shares the writer
 * pool with eight other adapters now, so one poisoned client is a fault the
 * whole application inherits — which is why the fix belongs with the
 * consolidation rather than after it.
 *
 * No database: the pool is injected, so this runs in the ordinary suite rather
 * than behind `test:db`. Raised by CodeRabbit, which asked for exactly this
 * assertion — `release(true)` exactly once.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'

import type { ExtractionRecord } from '../../core/extraction/record'
import { createPostgresExtractionRepository } from './extraction-repository-postgres'

const RECORD: ExtractionRecord = {
  documentKind: 'invoice',
  vendorName: 'Rivera Landscaping',
  documentNumber: 'INV-4471',
  issuedOn: '2026-03-01',
  totalAmount: '480.00',
  unitReference: null,
  currency: 'USD',
}

/**
 * A pool whose client fails the work, and optionally fails the rollback too.
 *
 * `begin` and the `select … for update` succeed so the method reaches the part
 * under test; the `delete` is what fails.
 */
function poolThatFails({ rollbackFails }: { rollbackFails: boolean }) {
  const release = vi.fn()
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('delete')) throw new Error('delete failed')
    if (sql === 'rollback' && rollbackFails) throw new Error('rollback failed')
    if (sql.startsWith('select')) return { rowCount: 1, rows: [{ '?column?': 1 }] }

    return { rowCount: 0, rows: [] }
  })

  const pool = {
    connect: async () => ({ query, release }),
  } as unknown as Pool

  return { pool, release, query }
}

describe('a failed rollback must not return the client to the shared pool', () => {
  it('destroys the connection when the rollback fails', async () => {
    // `release(true)` is how `pg` is told to discard rather than reuse. Passing
    // nothing here would hand a client still inside a transaction to whichever
    // of the nine writer-pool adapters asked next.
    const { pool, release } = poolThatFails({ rollbackFails: true })
    const repository = createPostgresExtractionRepository({ pool })

    await expect(repository.replace('doc-1', [RECORD])).rejects.toThrow('delete failed')

    expect(release).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledWith(true)
  })

  it('returns the connection normally when the rollback succeeds', async () => {
    // The positive control. A method that always passed `true` would satisfy the
    // test above while throwing away a healthy connection on every ordinary
    // failure — turning a recoverable error into pool churn.
    const { pool, release } = poolThatFails({ rollbackFails: false })
    const repository = createPostgresExtractionRepository({ pool })

    await expect(repository.replace('doc-1', [RECORD])).rejects.toThrow('delete failed')

    expect(release).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledWith(false)
  })

  it('releases exactly once, never twice', async () => {
    // The `finally` guard. A double release is its own pool corruption — `pg`
    // counts the client back in twice and hands it to two callers at once.
    const { pool, release } = poolThatFails({ rollbackFails: true })
    const repository = createPostgresExtractionRepository({ pool })

    await repository.replace('doc-1', [RECORD]).catch(() => undefined)

    expect(release).toHaveBeenCalledTimes(1)
  })

  it('attempts the rollback at all', async () => {
    // The reason the transaction exists: without the rollback the delete stands
    // and the document is left holding no records where it held a full set.
    const { pool, query } = poolThatFails({ rollbackFails: false })
    const repository = createPostgresExtractionRepository({ pool })

    await repository.replace('doc-1', [RECORD]).catch(() => undefined)

    expect(query).toHaveBeenCalledWith('rollback')
  })
})
