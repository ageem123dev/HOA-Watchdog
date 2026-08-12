/**
 * One reader pool and one writer pool for the whole process.
 *
 * Before this, fourteen adapter modules each built their own `Pool` at
 * `max: 5` — **seventy potential connections against `max_connections` 100**,
 * before `test:db` runs forty files. It was raised at the Epic 1 retrospective
 * with six pools, again on story 2.1, again on 3.1, and again by Argus on 3.8.
 * It stopped being latent on story 3.2: widening `test:db` to `app/tools/` put
 * two more pools in parallel with the rest and `roll-ingestion.test.ts` began
 * timing out at 5s on roughly one run in three.
 *
 * The two halves of the defect, both fixed here:
 *
 * 1. **Count.** Fourteen pools become two, because all fourteen were configured
 *    identically apart from which credential they read.
 * 2. **Orphaning.** A module-scoped pool is discarded on every Next.js HMR
 *    reload in dev, and its sockets are not — connections leak until the server
 *    hits the limit. The registry lives on `globalThis`, which survives a module
 *    reload, so the same pool is reused.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const readReaderDatabaseUrl = vi.fn(() => 'postgres://watchdog_reader@localhost:5432/watchdog')
const readWriterDatabaseUrl = vi.fn(() => 'postgres://watchdog_writer@localhost:5432/watchdog')

vi.mock('../auth/env', () => ({
  READER_DATABASE_URL_VAR: 'WATCHDOG_READER_DATABASE_URL',
  WRITER_DATABASE_URL_VAR: 'WATCHDOG_WRITER_DATABASE_URL',
  readReaderDatabaseUrl: () => readReaderDatabaseUrl(),
  readWriterDatabaseUrl: () => readWriterDatabaseUrl(),
}))

const constructed = vi.fn()
const ended = vi.fn()

vi.mock('pg', () => ({
  Pool: class {
    on = vi.fn()
    end = vi.fn(async () => {
      ended()
    })

    constructor(config: unknown) {
      constructed(config)
    }
  },
}))

async function load() {
  return import('./pool')
}

beforeEach(async () => {
  vi.clearAllMocks()
  const { closeAllPools } = await load()
  await closeAllPools()
  vi.clearAllMocks()
})

afterEach(async () => {
  const { closeAllPools } = await load()
  await closeAllPools()
})

describe('there is one pool per credential, not one per adapter', () => {
  it('builds the reader pool once however many callers ask', async () => {
    const { readerPool } = await load()

    const first = readerPool()
    const second = readerPool()
    const third = readerPool()

    expect(first).toBe(second)
    expect(second).toBe(third)
    expect(constructed).toHaveBeenCalledTimes(1)
  })

  it('builds the writer pool once however many callers ask', async () => {
    const { writerPool } = await load()

    expect(writerPool()).toBe(writerPool())
    expect(constructed).toHaveBeenCalledTimes(1)
  })

  it('keeps the reader and the writer separate', async () => {
    // The whole credential separation rests on this. One pool serving both would
    // silently give every reader the writer's privileges — AD-4's boundary
    // becoming a comment.
    const { readerPool, writerPool } = await load()

    expect(readerPool()).not.toBe(writerPool())
    expect(constructed).toHaveBeenCalledTimes(2)
  })

  it('asks for the right credential for each', async () => {
    const { readerPool, writerPool } = await load()

    readerPool()
    expect(constructed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        connectionString: 'postgres://watchdog_reader@localhost:5432/watchdog',
      }),
    )

    writerPool()
    expect(constructed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        connectionString: 'postgres://watchdog_writer@localhost:5432/watchdog',
      }),
    )
  })

  it('reads the credential lazily, never at import', async () => {
    // `next build` imports every module without the environment set. A pool
    // constructed at import time turns a missing variable into a build failure
    // rather than a request failure — the note `../auth/env.ts` carries.
    await load()

    expect(readReaderDatabaseUrl).not.toHaveBeenCalled()
    expect(readWriterDatabaseUrl).not.toHaveBeenCalled()
  })
})

describe('surviving a dev reload', () => {
  it('reuses the pool across a module reload rather than orphaning it', async () => {
    // The second half of the defect. A module-scoped pool is discarded on every
    // Next.js HMR reload and its sockets are not, so connections leak until the
    // server hits the limit. `vi.resetModules()` reproduces exactly that: the
    // module graph is rebuilt while the process lives on.
    const { readerPool } = await load()
    const before = readerPool()

    vi.resetModules()

    const { readerPool: reloaded } = await load()
    const after = reloaded()

    expect(after).toBe(before)
    expect(constructed).toHaveBeenCalledTimes(1)
  })
})

describe('closing them', () => {
  it('ends every open pool', async () => {
    // Not only for tests. Nothing in this codebase could close a pool before,
    // which Argus raised on story 3.8 — a process with no way to release its
    // connections cannot shut down cleanly.
    const { readerPool, writerPool, closeAllPools } = await load()
    readerPool()
    writerPool()

    await closeAllPools()

    expect(ended).toHaveBeenCalledTimes(2)
  })

  it('is safe to call when nothing was ever opened', async () => {
    const { closeAllPools } = await load()

    await expect(closeAllPools()).resolves.toBeUndefined()
    expect(ended).not.toHaveBeenCalled()
  })

  it('lets a later caller open a fresh pool', async () => {
    // Otherwise closing once would leave the process unable to reach the
    // database again, which turns a graceful shutdown into a trap.
    const { readerPool, closeAllPools } = await load()
    readerPool()
    await closeAllPools()

    readerPool()

    expect(constructed).toHaveBeenCalledTimes(2)
  })
})
