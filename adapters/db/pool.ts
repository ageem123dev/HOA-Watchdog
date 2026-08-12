import { Pool } from 'pg'

import { readReaderDatabaseUrl, readWriterDatabaseUrl } from '../auth/env'

/**
 * The process's two connection pools — one per credential.
 *
 * ## Why this exists
 *
 * Fourteen adapter modules each built their own `Pool` at `max: 5`: **seventy
 * potential connections against `max_connections` 100**, before `test:db` runs
 * forty files. Every one of the fourteen was configured identically apart from
 * which credential it read, so there was never a reason for more than two.
 *
 * It was raised at the Epic 1 retrospective with six pools, again on story 2.1,
 * again on 3.1, again by Argus on 3.8 — and it stopped being latent on story
 * 3.2, where widening `test:db` to `app/tools/` put two more pools in parallel
 * with the rest and `roll-ingestion.test.ts` began timing out at 5s on roughly
 * one run in three. `package.json` carried a workaround for that until this
 * change: two sequential vitest invocations instead of one. **It is now one
 * again**, verified over six consecutive clean runs of the combined form.
 *
 * ## Two pools, not one
 *
 * The separation is AD-4's, and it is the reason this module has two functions
 * rather than one taking a URL. A single pool serving both credentials would
 * hand every reader the writer's privileges, and the five `*-connection.test.ts`
 * files exist precisely because that failure is invisible at runtime — the
 * writer can do everything the reader can.
 *
 * ## The registry lives on `globalThis`
 *
 * A module-scoped pool is discarded on every Next.js HMR reload in dev, and its
 * sockets are not: connections leak until the server reaches the limit. That was
 * the second half of the finding raised on story 2.1. `globalThis` outlives the
 * module graph, so a reload finds the pool it already opened.
 */

/** Every pool gets this. They were identical in all fourteen adapters. */
const SETTINGS = {
  /**
   * Five per pool, now that there are two pools rather than fourteen.
   *
   * Ten against `max_connections` 100 leaves room for migrations, `psql`, and
   * whatever else holds a connection while the suite runs.
   */
  max: 5,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 10_000,
} as const

type Role = 'reader' | 'writer'

/**
 * The registry, on `globalThis` so a dev reload reuses rather than orphans.
 *
 * A `Symbol.for` key rather than a string property: it cannot collide with
 * anything another package puts on the global object, and it is greppable.
 */
const REGISTRY = Symbol.for('watchdog.db.pools')

interface GlobalWithPools {
  [REGISTRY]?: Map<Role, Pool>
}

function registry(): Map<Role, Pool> {
  const holder = globalThis as GlobalWithPools
  holder[REGISTRY] ??= new Map()

  return holder[REGISTRY]
}

function poolFor(role: Role, connectionString: () => string): Pool {
  const open = registry()
  const existing = open.get(role)
  if (existing !== undefined) return existing

  // The credential is read here rather than at module scope, deliberately.
  // `next build` imports every module without the environment set, so reading it
  // at import time turns a missing variable into a build failure rather than a
  // request failure — the note `../auth/env.ts` carries.
  const pool = new Pool({ ...SETTINGS, connectionString: connectionString() })

  pool.on('error', (error) => {
    // An idle client failing has no request to reject. Without a listener Node
    // treats it as unhandled and takes the process down.
    //
    // **Logged, not merely swallowed.** Two of the fourteen adapters this
    // replaced — document-repository and extraction-repository — printed this,
    // and consolidating them into one silent handler quietly removed the only
    // record that Postgres had restarted or the network had dropped. Raised by
    // Argus, and correct: the loss is worse here than it was there, because one
    // pool now serves every adapter, so a single idle failure is broader.
    //
    // The handler must not rethrow. A listener that throws converts the
    // recoverable failure into the crash it was added to prevent.
    console.error(`[db/pool:${role}] idle client error; the pool will discard it`, error)
  })

  open.set(role, pool)

  return pool
}

/** The `watchdog_reader` pool. Read-only by grant, not by convention. */
export function readerPool(): Pool {
  return poolFor('reader', readReaderDatabaseUrl)
}

/** The `watchdog_writer` pool. */
export function writerPool(): Pool {
  return poolFor('writer', readWriterDatabaseUrl)
}

/**
 * Close every open pool.
 *
 * Nothing in this codebase could release a connection before, which Argus raised
 * on story 3.8: a process with no way to close its pools cannot shut down
 * cleanly, and a test suite cannot isolate itself from a previous file's
 * sockets.
 *
 * The registry is cleared first, so a caller after this opens a fresh pool
 * rather than reaching for one that is closing. Closing must not be a trap that
 * leaves the process unable to reach the database again.
 */
export async function closeAllPools(): Promise<void> {
  const open = registry()
  const pools = [...open.values()]
  open.clear()

  // `allSettled`, not `all`, for two reasons — neither of which is unhandled
  // rejections. `Promise.all` subscribes to every promise it is given, so a
  // later failure is handled and warns about nothing; an earlier version of
  // this comment claimed otherwise and was wrong. Verified with a probe.
  //
  // What `all` actually does here is **reject on the first failure and return
  // immediately**, so a caller awaiting `closeAllPools` resumes while the other
  // pools are still closing — during a shutdown that is the difference between
  // closed and closing. And it throws, when this is cleanup: one pool refusing
  // must not make the caller's teardown fail. Raised by Argus, corrected by
  // CodeRabbit.
  await Promise.allSettled(pools.map((pool) => pool.end()))
}
