/**
 * Which role the access-log reader connects as, and why it is the writer.
 *
 * This inverts the instinct every other read adapter follows, so it is the one
 * most likely to be "corrected" by a well-meaning refactor. Migration 020:
 *
 * > "Nothing is granted to `watchdog_reader`, and the silence is the decision.
 * > […] The role the LLM-driven query path executes under has no business
 * > reading the audit trail of its own queries."
 *
 * `watchdog_writer` may `insert` and `select` on `query_log`; `watchdog_reader`
 * may do nothing with it at all. So an adapter built on the reader URL fails
 * with a `42501` — at runtime, in production, on a page a board member has just
 * opened. There is no build-time signal and no behavioural test that catches it,
 * because a mocked pool answers happily either way.
 *
 * Asserted by mocking the configuration module rather than reaching into the
 * adapter for its pool, per `quarantine-queue-connection.test.ts`: a test that
 * opens up the thing it tests describes an implementation rather than a
 * contract.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const readReaderDatabaseUrl = vi.fn(() => 'postgres://watchdog_reader@localhost:5432/watchdog')
const readWriterDatabaseUrl = vi.fn(() => 'postgres://watchdog_writer@localhost:5432/watchdog')

vi.mock('../auth/env', () => ({
  READER_DATABASE_URL_VAR: 'WATCHDOG_READER_DATABASE_URL',
  WRITER_DATABASE_URL_VAR: 'WATCHDOG_WRITER_DATABASE_URL',
  readReaderDatabaseUrl: () => readReaderDatabaseUrl(),
  readWriterDatabaseUrl: () => readWriterDatabaseUrl(),
}))

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

beforeEach(async () => {
  // The pools are shared process-wide and cached on `globalThis`, so without
  // this the second case in this file finds the pool the first one opened and
  // never re-reads the credential — the assertion would pass or fail on test
  // order rather than on the adapter.
  const { closeAllPools } = await import('./pool')
  await closeAllPools()
  vi.clearAllMocks()
  vi.resetModules()
})

describe('the access-log reader', () => {
  it('connects as the writer, because the reader is denied this table', async () => {
    const { createQueryLogReader } = await import('./query-log-reader-postgres')

    await createQueryLogReader().recent({ limit: 10 })

    expect(poolConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ connectionString: 'postgres://watchdog_writer@localhost:5432/watchdog' }),
    )
  })

  it('never asks for the reader credential', async () => {
    // The other direction, and not redundant: an adapter that read both URLs and
    // used the writer's would satisfy the assertion above while still handing
    // the reader credential to a module that must not hold it.
    const { createQueryLogReader } = await import('./query-log-reader-postgres')

    await createQueryLogReader().recent({ limit: 10 })

    expect(readReaderDatabaseUrl).not.toHaveBeenCalled()
    expect(readWriterDatabaseUrl).toHaveBeenCalled()
  })
})
