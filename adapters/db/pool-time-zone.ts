import { writerPool } from './pool'

/**
 * Set the session timezone on **every** connection in the writer pool.
 *
 * ## Why not just `pool.query('set time zone …')`
 *
 * Because that sets it on *one* connection, and the next `pool.query` may well
 * get a different one. A test written that way looks like it pins the session
 * and does not: it passes whether or not the code under test depends on the
 * timezone, which is the shape of a guard that proves nothing. Story 4.4 shipped
 * exactly that version and CodeRabbit caught it.
 *
 * Checking out `max` clients at once forces every connection in the pool to
 * exist, so setting the timezone on each of them leaves nothing unset. The pool
 * will not open a sixth, so whichever one the adapter takes afterwards is one of
 * these.
 *
 * ## This lives in `adapters/db/` and not in a test file
 *
 * Two test files need it — `dues-reader-postgres.test.ts` and
 * `invoice-reader-postgres.test.ts` — and both are asserting the same property
 * about the same pool. Copying it would mean a fix to the checkout logic landing
 * in one and not the other.
 *
 * **It is test scaffolding and nothing in `app/` may call it.** Changing the
 * session timezone of a shared pool underneath a running application would move
 * every rendered calendar day at once. It is exported for tests, guarded by the
 * boundary tests that already forbid `adapters/` reaching into `app/`, and named
 * so that its purpose is obvious in an import list.
 */
export async function setPoolTimeZone(timeZone: string): Promise<void> {
  if (!/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(timeZone)) {
    // `set time zone` takes no bound parameter, so the value is interpolated and
    // has to be proven safe first. AD-8's rule with no way to apply its usual
    // remedy: the allowed shape is an IANA zone name, and nothing else runs.
    throw new RangeError(`not a timezone name: ${timeZone}`)
  }

  const pool = writerPool()
  const clients = await Promise.all(
    Array.from({ length: pool.options.max ?? 1 }, () => pool.connect()),
  )

  try {
    for (const client of clients) {
      await client.query(`set time zone '${timeZone}'`)
    }
  } finally {
    // Released whatever happened: holding every connection in the pool would
    // deadlock the next query rather than fail it.
    for (const client of clients) client.release()
  }
}
