/**
 * Which role the assessment directory connects as, and what its query asks for.
 *
 * Both are properties no behavioural test can catch. `watchdog_writer` can do
 * everything `watchdog_reader` can, so an adapter that quietly built its pool
 * from the writer URL would satisfy every assertion in
 * `assessment-directory-postgres.test.ts` and leave migration 013's
 * `grant select … to watchdog_reader` true but unexercised — which is how AD-4's
 * separation becomes a comment rather than a constraint.
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

describe('the assessment directory connection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('builds its pool from the reader URL', async () => {
    const { createAssessmentDirectory } = await import('./assessment-directory-postgres')

    await createAssessmentDirectory().forUnitAndYear('4B', 2024)

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
    const { createAssessmentDirectory } = await import('./assessment-directory-postgres')

    await createAssessmentDirectory().forUnitAndYear('4B', 2024)

    expect(readWriterDatabaseUrl).not.toHaveBeenCalled()
  })

  it('builds no pool until something is asked of it', async () => {
    // `next build` runs this module on a machine with no database. A pool
    // constructed at import time fails the build.
    await import('./assessment-directory-postgres')

    expect(poolConstructor).not.toHaveBeenCalled()
  })
})

describe('the query states its own terms', () => {
  const source = () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), 'assessment-directory-postgres.ts')
    // No `catch` returning '' — see the note in `unit-directory-connection.test.ts`.
    return readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
  }

  const flat = () => source().replace(/\s+/g, ' ')

  it('reads a source file that still has its statements', () => {
    // The control. Every assertion below is on stripped source, and a stripper
    // that ate the file — or a path that stopped resolving — would make all of
    // them pass by matching nothing.
    expect(flat()).toMatch(/select/i)
    expect(flat()).not.toMatch(/Which role the assessment directory connects as/)
  })

  it('matches the unit on its normalised number', () => {
    // Matching the raw column passes every database test that uses a
    // consistently-typed number, which is most of them.
    expect(flat()).toContain('unit.normalised_number = unit_normalised_number($1)')
  })

  it('filters by the assessment year', () => {
    // Without it the query answers 2024's question with whichever year the plan
    // reached first, and the row would look perfectly well-formed.
    expect(flat()).toContain('assessment.assessment_year = $2')
  })

  it('does not select star, and does not carry the folded number out', () => {
    const sql = source()

    expect(sql).not.toMatch(/select\s+\*/i)
    expect(sql).not.toMatch(/normalised_number\s+as\b/i)
  })

  it('interpolates nothing into its SQL', () => {
    // The unit number and the year are parameters. See the note on
    // `unit-directory-postgres.ts` about the one interpolation allowed there;
    // this query has none at all.
    const sql = flat()

    expect(sql).toContain('$1')
    expect(sql).toContain('$2')
    expect(sql).not.toMatch(/\$\{/)
  })

  it('does not cast or coerce the amount on its way out', () => {
    // `numeric` arrives from `pg` as a decimal string. A `::float8`, a `Number(`
    // or a `parseFloat` here would undo the entire money decision — and every
    // database test in the sibling file would still pass for values that happen
    // to round-trip, like 1200.
    const sql = source()

    expect(sql).not.toMatch(/::\s*(float|double|numeric\s*\()/i)
    expect(sql).not.toMatch(/Number\(|parseFloat\(|parseInt\(/)
  })
})
