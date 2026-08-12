/**
 * Which role the unit directory connects as, and what its queries ask for.
 *
 * Both are properties no behavioural test can catch. `watchdog_writer` can do
 * everything `watchdog_reader` can, so an adapter that quietly built its pool
 * from the writer URL would satisfy every assertion in
 * `unit-directory-postgres.test.ts` and leave migration 012's
 * `grant select … to watchdog_reader` true but unexercised — which is how AD-4's
 * separation becomes a comment rather than a constraint.
 *
 * The order clause is the same kind of thing. Ties and small result sets come
 * back in whatever order the planner likes, including the correct one, so a
 * behavioural test for ordering is a detector that is usually right. The
 * database test proves the order is real; this proves it was asked for.
 *
 * The structure is `quarantine-queue-connection.test.ts`'s, which established
 * both halves.
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

describe('the unit directory connection', () => {
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
    const { createUnitDirectory } = await import('./unit-directory-postgres')

    await createUnitDirectory().heldBy('4B', '2024-07-01')

    expect(readReaderDatabaseUrl).toHaveBeenCalled()
    expect(poolConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgres://watchdog_reader@localhost:5432/watchdog',
      }),
    )
  })

  it('never reads the writer URL', async () => {
    // Stated separately, because "used the reader" and "did not also reach for
    // the writer" are different facts. An adapter that built both pools would
    // satisfy the first.
    const { createUnitDirectory } = await import('./unit-directory-postgres')

    await createUnitDirectory().heldBy('4B', '2024-07-01')
    await createUnitDirectory().historyFor('4B')

    expect(readWriterDatabaseUrl).not.toHaveBeenCalled()
  })

  it('builds no pool until something is asked of it', async () => {
    // E8. `next build` runs this module on a machine with no database. A pool
    // constructed at import time fails the build; `../auth/env.ts` records why
    // the lazy shape exists.
    await import('./unit-directory-postgres')

    expect(poolConstructor).not.toHaveBeenCalled()
  })
})

describe('the queries state their own terms', () => {
  const source = () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), 'unit-directory-postgres.ts')
    // No `catch` returning ''. The queue adapter's version has one, and it turns
    // a path that stops resolving into an empty string — every assertion below
    // then fails with "expected '' to match /select/i", which names the wrong
    // cause. Letting `readFileSync` throw names the real one, with the path in
    // the message. Raised by review, and correctly: nothing could make that catch
    // fire in a test, so it was an unproven guard.
    return readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
  }

  const flat = () => source().replace(/\s+/g, ' ')

  it('reads a source file that still has its statements', () => {
    // The control. Every assertion below is on stripped source, and a stripper
    // that ate the file — or a path that no longer resolves — would make all of
    // them pass by matching nothing. Story 1.6c shipped two of these controls
    // that could not fail either way.
    expect(flat()).toMatch(/select/i)
    expect(flat()).not.toMatch(/Which role the unit directory connects as/)
  })

  it('orders the history by when each tenure began', () => {
    // E5.
    expect(flat()).toContain('order by lower(unit_membership.held_during) asc')
  })

  it('matches the unit on its normalised number', () => {
    // E1. Matching the raw column passes every database test that uses a
    // consistently-typed number, which is most of them.
    expect(flat()).toContain('unit.normalised_number = unit_normalised_number($1)')
  })

  it('asks the database whether the range contains the date', () => {
    // E2. `@>` on a half-open daterange is what makes the day of sale belong to
    // exactly one tenure. Comparing `lower(...) <= d and upper(...) >= d` in
    // application code would include both.
    expect(flat()).toContain('unit_membership.held_during @> $2::date')
  })

  it('interpolates nothing into its SQL but a fixed column list', () => {
    // E9. The first version of this forbade `${` anywhere, which the shared
    // `TENURE_COLUMNS` constant trips. Loosening it to "no interpolation of the
    // unit number" would have been a test weakened to fit the code, so it is
    // narrowed instead: exactly one interpolation is allowed, by name, and the
    // thing it names is proved to be a literal.
    //
    // The constant is shared deliberately. Spelling the columns out twice would
    // let the two queries drift — and the `to_char` assertion below matches the
    // whole file, so it would stay green with only one of them casting.
    const sql = flat()

    expect(sql).toContain('$1')
    expect(sql.split('${TENURE_COLUMNS}').join('')).not.toMatch(/\$\{/)
  })

  it('declares that column list as a literal, so it can carry no value', () => {
    // The other half of the test above: allowing one interpolation by name is
    // only safe if the name resolves to something fixed. A `TENURE_COLUMNS`
    // built from an argument would satisfy every assertion here.
    const declaration = /const TENURE_COLUMNS = `([\s\S]*?)`/.exec(source())

    expect(declaration).not.toBeNull()
    expect(declaration?.[1]).not.toMatch(/\$\{/)
  })

  it('does not select the normalised number or use select star', () => {
    // E7. The folded number is a comparison key a treasurer has no use for, and
    // `select *` across this join would carry it plus three ids.
    const sql = source()

    expect(sql).not.toMatch(/select\s+\*/i)
    expect(sql).not.toMatch(/as\s+"normalisedNumber"/i)
  })

  it('returns the dates as text rather than letting pg build a Date', () => {
    // D2. `pg` maps a Postgres `date` to a JS `Date` at local midnight, which
    // moves the day for anyone west of UTC. Casting in SQL keeps the calendar
    // date a calendar date. Asserted on both bounds — casting only `lower`
    // would leave `heldUntil` shifting, and every test in the sibling file that
    // checks `heldUntil` uses a null or a date that would still stringify
    // plausibly.
    const sql = flat()

    expect(sql).toContain('to_char(lower(unit_membership.held_during)')
    expect(sql).toContain('to_char(upper(unit_membership.held_during)')
  })
})
