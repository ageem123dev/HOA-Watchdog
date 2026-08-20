/**
 * Migration 013: what a unit owes for a year, and on what cadence.
 *
 * The assertion this story turns on is the money one. `annual_amount` is
 * `numeric(14,2)` and crosses every boundary as a **decimal string**, matching
 * `extraction.total_amount` exactly — because story 2.4 compares an extracted
 * payment against a stored assessment, and two representations would put a
 * rounding conversion inside the comparison that produces arrears findings.
 *
 * The other one worth naming: `annual_amount` is the **annual** figure, never
 * the instalment. No check constraint can tell 500 from 6000, so what guards it
 * is the column name, the migration comment, and the AC2 test below.
 */

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { executable } from './executable-sql'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  assessment migration tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL must both be set.\n',
  )
}

const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'
const NUMERIC_OVERFLOW = '22003'
const INSUFFICIENT_PRIVILEGE = '42501'

/**
 * Every row this file creates carries this prefix, and its cleanup deletes only
 * rows carrying it. Vitest runs test files in parallel and this one writes to
 * `unit`, which three other files also use — see the note in `unit.test.ts`
 * about the run where two of them deleted each other's rows.
 */
const RUN_PREFIX = `a${randomBytes(4).toString('hex')}`

const MIGRATION = readFileSync(join(__dirname, '013_assessment.sql'), 'utf8')

describe('the migration says what it does', () => {
  it('creates the assessment table', () => {
    expect(executable(MIGRATION)).toMatch(/create\s+table\s+assessment\s*\(/i)
  })

  it('stores the amount as numeric with the same precision and scale as extraction', () => {
    // AC3. Matched on the declared type, because that is the decision: a float
    // cannot represent 0.10 and this is an association's ledger. 14,2 is
    // migration 006's choice for `total_amount`, and 2.4 compares the two.
    expect(executable(MIGRATION)).toMatch(/annual_amount\s+numeric\s*\(\s*14\s*,\s*2\s*\)/i)
  })

  it('never declares the amount as a floating-point type', () => {
    // Beside the case above: `numeric` appearing somewhere would not stop a
    // second column being `double precision`, and a review that skimmed would
    // not catch it.
    expect(executable(MIGRATION)).not.toMatch(/\b(real|double\s+precision|float\d*)\b/i)
  })

  it('constrains the billing cycle to the closed vocabulary', () => {
    // The style migration 007 established: a check constraint, not a Postgres
    // enum, so adding a cycle is a one-line change rather than a migration.
    expect(executable(MIGRATION)).toMatch(
      /billing_cycle\s+in\s*\(\s*'monthly'\s*,\s*'six_monthly'\s*,\s*'annual'\s*\)/i,
    )
  })

  it('grants select on assessment to watchdog_reader', () => {
    expect(executable(MIGRATION)).toMatch(/grant\s+select\s+on\s+assessment\s+to\s+watchdog_reader/i)
  })

  it('grants the reader nothing that writes', () => {
    expect(executable(MIGRATION)).not.toMatch(
      /grant\s+[^;]*\b(insert|update|delete|truncate|all)\b[^;]*\bto\s+watchdog_reader/i,
    )
  })

  it('strips comments without eating this migration statements', () => {
    // The positive control for the shared instrument, applied to this file's
    // migration. `executable-sql.test.ts` covers the stripper's own edge cases.
    const stripped = executable(MIGRATION)

    expect(stripped).toMatch(/create\s+table\s+assessment\s*\(/i)
    expect(stripped).toMatch(/grant\s+select/i)
    expect(stripped.length).toBeLessThan(MIGRATION.length)
  })
})

describeWithDatabase('what a unit owes for a year', () => {
  let writer: Client
  let reader: Client
  let scope = ''

  const named = (suffix: string) => `${RUN_PREFIX}-${scope}-${suffix}`

  const givenAUnit = async () => {
    const { rows } = await writer.query<{ id: string }>(
      'insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\') returning id',
      [named('4B')],
    )
    return rows[0]!.id
  }

  const assess = (unitId: string, year: number, amount: string, cycle: string) =>
    writer.query(
      'insert into assessment (unit_id, assessment_year, annual_amount, billing_cycle, association_id) values ($1, $2, $3, $4, \'00000000-0000-7000-8000-000000000001\')',
      [unitId, year, amount, cycle],
    )

  const amountFor = async (unitId: string, year: number) => {
    const { rows } = await writer.query<{ annual_amount: string }>(
      'select annual_amount from assessment where unit_id = $1 and assessment_year = $2',
      [unitId, year],
    )
    return rows[0]?.annual_amount
  }

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    reader = new Client({ connectionString: readerUrl })
    await writer.connect()
    await reader.connect()
  })

  beforeEach(() => {
    scope = randomBytes(4).toString('hex')
  })

  afterAll(async () => {
    await writer.query(
      'delete from assessment where unit_id in (select id from unit where unit_number like $1)',
      [`${RUN_PREFIX}-%`],
    )
    await writer.query('delete from unit where unit_number like $1', [`${RUN_PREFIX}-%`])
    await writer.end()
    await reader.end()
  })

  describe('the amount', () => {
    it('reads back as the exact decimal it was given', async () => {
      // AC3, and the reverse-it pair: insert then read. Asserted as a *string*,
      // because that is the contract — a float would come back
      // 1234.5599999999999 and a `number` would erase the distinction between
      // 1234.5 and 1234.50.
      const unitId = await givenAUnit()

      await assess(unitId, 2024, '1234.56', 'monthly')

      expect(await amountFor(unitId, 2024)).toBe('1234.56')
    })

    it('keeps the trailing zero that the scale implies', async () => {
      // `1200` and `1200.00` are the same money and must present identically.
      // A `number` at the boundary would return 1200 and lose this.
      const unitId = await givenAUnit()

      await assess(unitId, 2024, '1200', 'annual')

      expect(await amountFor(unitId, 2024)).toBe('1200.00')
    })

    it('accepts the smallest amount above zero', async () => {
      // Boundary: min+1 side of the `> 0` check.
      const unitId = await givenAUnit()

      await assess(unitId, 2024, '0.01', 'annual')

      expect(await amountFor(unitId, 2024)).toBe('0.01')
    })

    it('refuses an amount of zero', async () => {
      // A6, the boundary itself. A unit owing nothing is an absent assessment,
      // not a zero one.
      const unitId = await givenAUnit()

      await expect(assess(unitId, 2024, '0', 'annual')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      })
    })

    it('refuses a negative amount', async () => {
      // A6, min-1 side.
      const unitId = await givenAUnit()

      await expect(assess(unitId, 2024, '-0.01', 'annual')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      })
    })

    it('accepts the largest amount the column can hold', async () => {
      // Boundary: max. 14 digits with scale 2 leaves 12 before the point.
      const unitId = await givenAUnit()

      await assess(unitId, 2024, '999999999999.99', 'annual')

      expect(await amountFor(unitId, 2024)).toBe('999999999999.99')
    })

    it('refuses an amount larger than the column can hold', async () => {
      // Boundary: max+1. Postgres raises 22003 rather than truncating.
      const unitId = await givenAUnit()

      await expect(assess(unitId, 2024, '1000000000000.00', 'annual')).rejects.toMatchObject({
        code: NUMERIC_OVERFLOW,
      })
    })

    it('rounds an amount carrying more decimals than the scale, rather than rejecting it', async () => {
      // A9, PROPAGATE and documented rather than guarded. `numeric(14,2)` does
      // not reject 1234.567 -- it rounds it, half away from zero. Inherent to
      // the type, and `extraction.total_amount` behaves identically. Pinned here
      // so that a caller relying on it, or surprised by it, finds the answer in
      // a test rather than in production.
      const unitId = await givenAUnit()

      await assess(unitId, 2024, '1234.567', 'monthly')

      expect(await amountFor(unitId, 2024)).toBe('1234.57')
    })

    it('carries the declared column type, not merely a value that looks right', async () => {
      // Cross-check, by an independent route. The round trip above passes
      // against numeric(20,4) too; this pins the declaration. Read from the
      // catalog rather than from the migration text, so it proves what the
      // database actually has.
      const { rows } = await writer.query<{
        data_type: string
        numeric_precision: number
        numeric_scale: number
      }>(
        `select data_type, numeric_precision, numeric_scale
           from information_schema.columns
          where table_name = 'assessment' and column_name = 'annual_amount'`,
      )

      expect(rows[0]).toMatchObject({ data_type: 'numeric', numeric_precision: 14, numeric_scale: 2 })
    })
  })

  describe('the cycle', () => {
    it.each(['monthly', 'six_monthly', 'annual'])('accepts %s and stores it', async (cycle) => {
      // Reads back the *cycle*, which is the value under test. The first version
      // asserted the amount — the same constant for all three cases — so an
      // implementation that mapped or defaulted `billing_cycle` on the way in
      // would have passed all three: the insert would not throw and the amount
      // would still match. Raised by review.
      const unitId = await givenAUnit()

      await assess(unitId, 2024, '1200.00', cycle)

      const { rows } = await writer.query<{ billing_cycle: string }>(
        'select billing_cycle from assessment where unit_id = $1 and assessment_year = $2',
        [unitId, 2024],
      )
      expect(rows[0]?.billing_cycle).toBe(cycle)
    })

    it('refuses a cycle outside the vocabulary', async () => {
      // A5. `quarterly` is a plausible cycle this system does not support, which
      // is exactly the value most likely to be typed.
      const unitId = await givenAUnit()

      await expect(assess(unitId, 2024, '1200.00', 'quarterly')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      })
    })

    it('refuses a cycle that differs only in case', async () => {
      // Beside the case above. The application constant is lower-case, so
      // `Monthly` would be a row every comparison in 2.3 silently misses.
      const unitId = await givenAUnit()

      await expect(assess(unitId, 2024, '1200.00', 'Monthly')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      })
    })

    it('refuses an empty cycle', async () => {
      const unitId = await givenAUnit()

      await expect(assess(unitId, 2024, '1200.00', '')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      })
    })
  })

  describe('the unit and the year', () => {
    it('refuses a second assessment for the same unit and year', async () => {
      // A3. Two answers to "what does 4B owe for 2024", neither looking wrong.
      const unitId = await givenAUnit()
      await assess(unitId, 2024, '1200.00', 'monthly')

      await expect(assess(unitId, 2024, '1500.00', 'annual')).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
      })
    })

    it('accepts the same unit in a different year', async () => {
      // Beside the case above: a unique constraint on `unit_id` alone would
      // satisfy it and make the table useless after year one.
      const unitId = await givenAUnit()
      await assess(unitId, 2024, '1200.00', 'monthly')
      await assess(unitId, 2025, '1300.00', 'monthly')

      expect(await amountFor(unitId, 2025)).toBe('1300.00')
    })

    it('accepts the same year for a different unit', async () => {
      // And the other direction: a unique constraint on `assessment_year` alone
      // would allow exactly one unit in the whole association.
      const first = await givenAUnit()
      const { rows } = await writer.query<{ id: string }>(
        'insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\') returning id',
        [named('5B')],
      )

      await assess(first, 2024, '1200.00', 'monthly')
      await assess(rows[0]!.id, 2024, '1400.00', 'annual')

      expect(await amountFor(rows[0]!.id, 2024)).toBe('1400.00')
    })

    it('refuses an assessment for a unit that does not exist', async () => {
      // A4.
      await expect(
        assess('00000000-0000-0000-0000-000000000000', 2024, '1200.00', 'monthly'),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION })
    })

    it('refuses an implausible year', async () => {
      // A7. A typo'd 20024 becomes a row nobody can find.
      const unitId = await givenAUnit()

      await expect(assess(unitId, 20024, '1200.00', 'monthly')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      })
    })

    it('accepts a plausible year', async () => {
      // Beside the case above: a range check nobody can satisfy is worse than
      // none at all.
      const unitId = await givenAUnit()

      await assess(unitId, 2026, '1200.00', 'monthly')

      expect(await amountFor(unitId, 2026)).toBe('1200.00')
    })
  })

  describe('AC2 - the annual figure is the annual figure', () => {
    it('stores the same amount for two units owing the same for the year on different cycles', async () => {
      // AC2, and the guard against the one modelling error this table invites:
      // recording the *instalment*. A monthly payer owing 1200 for the year is
      // stored as 1200.00, not 100.00. If the amount were ever scaled by the
      // cycle these two would differ, and 2.3 would divide an already-divided
      // number.
      const monthlyUnit = await givenAUnit()
      const { rows } = await writer.query<{ id: string }>(
        'insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\') returning id',
        [named('7C')],
      )
      const annualUnit = rows[0]!.id

      await assess(monthlyUnit, 2024, '1200.00', 'monthly')
      await assess(annualUnit, 2024, '1200.00', 'annual')

      expect(await amountFor(monthlyUnit, 2024)).toBe(await amountFor(annualUnit, 2024))
      expect(await amountFor(monthlyUnit, 2024)).toBe('1200.00')
    })
  })

  describe('the reader', () => {
    it('lets watchdog_reader read it but not write it', async () => {
      // A10. AD-4: the role the LLM-driven query path runs under cannot invent
      // an assessment, and an assessment that exists because a model asked for
      // it would carry dues nobody owes.
      const unitId = await givenAUnit()
      await assess(unitId, 2024, '1200.00', 'monthly')

      const { rows } = await reader.query<{ annual_amount: string }>(
        'select annual_amount from assessment where unit_id = $1',
        [unitId],
      )
      expect(rows[0]?.annual_amount).toBe('1200.00')

      await expect(
        reader.query(
          'insert into assessment (unit_id, assessment_year, annual_amount, billing_cycle, association_id) values ($1, $2, $3, $4, \'00000000-0000-7000-8000-000000000001\')',
          [unitId, 2027, '1.00', 'annual'],
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
    })
  })
})
