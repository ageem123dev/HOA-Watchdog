/**
 * Which role the queue adapter connects as.
 *
 * This is the one property no behavioural test can catch. `watchdog_writer` can
 * do everything `watchdog_reader` can, so an adapter that quietly built its pool
 * from the writer URL would satisfy every assertion in
 * `quarantine-queue-postgres.test.ts` and leave migration 010's `grant select
 * … to watchdog_reader` true but unexercised — which is how AD-4's separation
 * becomes a comment rather than a constraint.
 *
 * Asserted by mocking the configuration module rather than by reaching into the
 * adapter for its pool. A test that has to open up the thing it tests is
 * describing an implementation, not a contract, and it pins the internals in
 * place so they cannot be refactored.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readReaderDatabaseUrl = vi.fn(() => 'postgres://watchdog_reader@localhost:5432/watchdog')
const readWriterDatabaseUrl = vi.fn(() => 'postgres://watchdog_writer@localhost:5432/watchdog')

vi.mock('../auth/env', () => ({
  READER_DATABASE_URL_VAR: 'WATCHDOG_READER_DATABASE_URL',
  WRITER_DATABASE_URL_VAR: 'WATCHDOG_WRITER_DATABASE_URL',
  readReaderDatabaseUrl: () => readReaderDatabaseUrl(),
  readWriterDatabaseUrl: () => readWriterDatabaseUrl(),
}))

// `pg` is mocked so building a pool performs no I/O; the connection string it
// was handed is the whole subject here.
const poolConstructor = vi.fn()

vi.mock('pg', () => ({
  Pool: class {
    on = vi.fn()
    end = vi.fn(async () => {})
    query = vi.fn(async () => ({ rows: [] }))

    constructor(config: unknown) {
      poolConstructor(config)
    }
  },
}))

describe('the queue adapter connection', () => {
  beforeEach(async () => {
    // The pools are shared process-wide and cached on `globalThis`, so
    // `resetModules` alone does not clear them: the second case in this file
    // would find the pool the first one opened, never re-read the credential,
    // and pass on test order rather than on the adapter. Raised by Argus.
    const { closeAllPools } = await import('./pool')
    await closeAllPools()
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('builds its pool from the reader URL', async () => {
    const { createQuarantineQueue } = await import('./quarantine-queue-postgres')

    await createQuarantineQueue().held()

    expect(readReaderDatabaseUrl).toHaveBeenCalled()
    expect(poolConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgres://watchdog_reader@localhost:5432/watchdog',
      }),
    )
  })

  it('never reads the writer URL', async () => {
    // Stated separately from the assertion above, because "used the reader" and
    // "did not also reach for the writer" are different facts. An adapter that
    // built both pools would satisfy the first.
    const { createQuarantineQueue } = await import('./quarantine-queue-postgres')

    await createQuarantineQueue().held()

    expect(readWriterDatabaseUrl).not.toHaveBeenCalled()
  })
})

describe('the query states its own order', () => {
  /**
   * A behavioural test cannot settle this one. Ties in `order by created_at` may
   * come back in any order the planner likes — including the correct one — so
   * removing the `id` tiebreak was caught in only two runs out of three, with
   * generated ids and again with explicit ones. A detector that is usually right
   * is exactly the kind of guard this project keeps finding in its own tests.
   *
   * So the rule is asserted where it is deterministic: in the text of the query.
   * The database test proves the order is real; this proves it was asked for.
   * Neither is sufficient alone.
   */
  const source = () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), 'quarantine-queue-postgres.ts')
    try {
      return readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
    } catch {
      return ''
    }
  }

  it('breaks created_at ties by id', () => {
    expect(source().replace(/\s+/g, ' ')).toContain(
      'order by quarantine_item.created_at asc, quarantine_item.id asc',
    )
  })

  it('does not select the normalised name or the storage key', () => {
    // `select *` would take both: one sits on the quarantine row, the other on
    // the document being joined. AD-10 keeps storage keys out of every caller.
    const sql = source()

    expect(sql).not.toMatch(/select\s+\*/i)
    expect(sql).not.toContain('normalised_name')
    expect(sql).not.toContain('storage_key')
  })
})
