/**
 * Which role the held-payment queue connects as, and what its query asks for.
 *
 * Both are properties no behavioural test can catch. `watchdog_writer` can do
 * everything `watchdog_reader` can, so an adapter that quietly built its pool
 * from the writer URL would satisfy every behavioural assertion and leave
 * migration 016's `grant select … to watchdog_reader` true but unexercised —
 * which is how AD-4's separation becomes a comment rather than a constraint.
 *
 * The structure is `unit-directory-connection.test.ts`'s.
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

const poolConstructor = vi.fn()

vi.mock('pg', () => ({
  Pool: class {
    on = vi.fn()
    query = vi.fn(async () => ({ rows: [] }))

    constructor(config: unknown) {
      poolConstructor(config)
    }
  },
}))

describe('the held payment queue connection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('builds its pool from the reader URL', async () => {
    const { createHeldPaymentQueue } = await import('./held-payment-queue-postgres')

    await createHeldPaymentQueue().held()

    expect(readReaderDatabaseUrl).toHaveBeenCalled()
    expect(poolConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgres://watchdog_reader@localhost:5432/watchdog',
      }),
    )
  })

  it('never reads the writer URL', async () => {
    // Stated separately: "used the reader" and "did not also reach for the
    // writer" are different facts, and an adapter building both pools would
    // satisfy the first.
    const { createHeldPaymentQueue } = await import('./held-payment-queue-postgres')

    await createHeldPaymentQueue().held()

    expect(readWriterDatabaseUrl).not.toHaveBeenCalled()
  })

  it('builds no pool until something is asked of it', async () => {
    await import('./held-payment-queue-postgres')

    expect(poolConstructor).not.toHaveBeenCalled()
  })
})

describe('the query states its own terms', () => {
  const adapterPath = join(
    dirname(fileURLToPath(import.meta.url)),
    'held-payment-queue-postgres.ts',
  )

  const source = () =>
    readFileSync(adapterPath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')

  const flat = () => source().replace(/\s+/g, ' ')

  /** A phrase present only in the adapter's comments, verified to sit on one line. */
  const COMMENT_ONLY = /a grant nothing exercises is a comment/

  it('actually removes the comments, and leaves the statements standing', () => {
    // Asserts a phrase genuinely present before stripping and gone after, so
    // deleting the stripping fails this. Story 2.2 shipped a control that named
    // a phrase from its own docblock — never present in the file it read — and
    // so held with the stripping deleted.
    expect(readFileSync(adapterPath, 'utf8')).toMatch(COMMENT_ONLY)
    expect(source()).not.toMatch(COMMENT_ONLY)
    expect(flat()).toMatch(/select/i)
  })

  it('breaks created_at ties by id', () => {
    // Rows written by one replacement share `now()` to the microsecond. Without
    // the tiebreak the order is whatever the plan produced, and two renders of
    // an unchanged queue would disagree. A behavioural test cannot settle this —
    // the queue adapter found a missing order clause was caught in only two runs
    // of three.
    expect(flat()).toContain('order by held_payment.created_at asc, held_payment.id asc')
  })

  it('does not select star, and does not carry the folded reference or the storage key out', () => {
    const sql = source()

    expect(sql).not.toMatch(/select\s+\*/i)
    expect(sql).not.toContain('normalised_reference')
    expect(sql).not.toContain('storage_key')
  })

  it('returns the date as text rather than letting pg build a Date', () => {
    // `pg` maps a Postgres `date` to a JS `Date` at local midnight, which moves
    // the day for anyone west of UTC. Story 2.1 recorded this for membership
    // dates and story 2.3 for instalment dates.
    expect(flat()).toContain("to_char(held_payment.paid_on, 'YYYY-MM-DD')")
  })

  it('does not cast or coerce the amount on its way out', () => {
    // `numeric` arrives from `pg` as a decimal string, which is the contract. A
    // cast or a `Number(` here would undo the money decision story 2.2 made.
    const sql = source()

    expect(sql).not.toMatch(/amount\s*::/i)
    expect(sql).not.toMatch(/Number\(|parseFloat\(/)
  })
})
