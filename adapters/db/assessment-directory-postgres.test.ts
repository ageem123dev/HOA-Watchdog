/**
 * The `AssessmentDirectory` adapter, against the real database.
 *
 * The assertion this story turns on is the money one: the annual amount must
 * cross this boundary as the exact decimal string it was stored as. Story 2.4
 * compares it against an extracted payment that crosses the same way, and a
 * `number` here would erase `1200.00` into `1200` and lose 0.10 entirely.
 */

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createAssessmentDirectory } from './assessment-directory-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  assessment directory adapter tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL must both be set.\n',
  )
}

/** See the note in `migrations/unit.test.ts`: four files now write to `unit`. */
const RUN_PREFIX = `s${randomBytes(4).toString('hex')}`

describeWithDatabase('the assessment directory', () => {
  let writer: Client
  let scope = ''

  const named = (suffix: string) => `${RUN_PREFIX}-${scope}-${suffix}`

  const givenAnAssessment = async (
    unitSuffix: string,
    year: number,
    amount: string,
    cycle: string,
  ) => {
    const { rows } = await writer.query<{ id: string }>(
      'insert into unit (unit_number) values ($1) returning id',
      [named(unitSuffix)],
    )
    await writer.query(
      'insert into assessment (unit_id, assessment_year, annual_amount, billing_cycle) values ($1, $2, $3, $4)',
      [rows[0]!.id, year, amount, cycle],
    )
    return named(unitSuffix)
  }

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
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
  })

  it('answers what a unit owes for a year', async () => {
    const number = await givenAnAssessment('4B', 2024, '1234.56', 'monthly')

    const owed = await createAssessmentDirectory().forUnitAndYear(number, 2024)

    expect(owed).toEqual({
      unitNumber: number,
      assessmentYear: 2024,
      annualAmount: '1234.56',
      billingCycle: 'monthly',
    })
  })

  it('returns the amount as the exact decimal it was stored as', async () => {
    // AC3 across the boundary. `1200` stored in numeric(14,2) is `1200.00`, and
    // a `number` at this seam would return 1200 and lose the scale — which is
    // the difference story 2.4's comparison rests on.
    const number = await givenAnAssessment('9A', 2024, '1200', 'annual')

    const owed = await createAssessmentDirectory().forUnitAndYear(number, 2024)

    expect(owed?.annualAmount).toBe('1200.00')
    expect(typeof owed?.annualAmount).toBe('string')
  })

  it('returns the unit number as the treasurer typed it, not the folded key', async () => {
    // Migration 011's `normalised_number` is a comparison key and no use to a
    // human. A `select *` would carry it out of here.
    const number = await givenAnAssessment('4b Upper', 2024, '900.00', 'annual')

    const owed = await createAssessmentDirectory().forUnitAndYear(number, 2024)

    expect(owed?.unitNumber).toBe(number)
  })

  it('finds the unit however the number was typed', async () => {
    // The normalisation migration 011 exists for. An adapter matching the raw
    // column passes every other test in this file.
    const number = await givenAnAssessment('4B', 2024, '1200.00', 'monthly')

    const owed = await createAssessmentDirectory().forUnitAndYear(`  ${number.toLowerCase()} `, 2024)

    expect(owed?.annualAmount).toBe('1200.00')
  })

  it('answers nothing for a year with no assessment', async () => {
    const number = await givenAnAssessment('4B', 2024, '1200.00', 'monthly')

    expect(await createAssessmentDirectory().forUnitAndYear(number, 2025)).toBeNull()
  })

  it('answers nothing for a unit that does not exist', async () => {
    expect(await createAssessmentDirectory().forUnitAndYear(named('nosuchunit'), 2024)).toBeNull()
  })

  it('does not return another unit assessment', async () => {
    // Beside the case above: a query that lost its unit filter would return
    // whichever row the plan reached first, and it would look well-formed.
    await givenAnAssessment('4B', 2024, '1200.00', 'monthly')
    const other = await givenAnAssessment('5B', 2024, '3400.00', 'annual')

    const owed = await createAssessmentDirectory().forUnitAndYear(other, 2024)

    expect(owed?.annualAmount).toBe('3400.00')
  })

  it('does not return another year assessment for the same unit', async () => {
    // And the other filter. A query missing its year predicate would answer
    // 2024's question with 2025's figure.
    const { rows } = await writer.query<{ id: string }>(
      'insert into unit (unit_number) values ($1) returning id',
      [named('7C')],
    )
    for (const [year, amount] of [
      [2024, '1200.00'],
      [2025, '1300.00'],
    ] as const) {
      await writer.query(
        'insert into assessment (unit_id, assessment_year, annual_amount, billing_cycle) values ($1, $2, $3, $4)',
        [rows[0]!.id, year, amount, 'monthly'],
      )
    }

    const owed = await createAssessmentDirectory().forUnitAndYear(named('7C'), 2025)

    expect(owed?.annualAmount).toBe('1300.00')
    expect(owed?.assessmentYear).toBe(2025)
  })

  it('carries each cycle through unchanged', async () => {
    // The cycle is a closed vocabulary; the adapter must not normalise, map or
    // default it. A silent default would make every unit look monthly.
    const monthly = await givenAnAssessment('M', 2024, '1200.00', 'monthly')
    const sixMonthly = await givenAnAssessment('S', 2024, '1200.00', 'six_monthly')
    const annual = await givenAnAssessment('A', 2024, '1200.00', 'annual')

    const directory = createAssessmentDirectory()

    expect((await directory.forUnitAndYear(monthly, 2024))?.billingCycle).toBe('monthly')
    expect((await directory.forUnitAndYear(sixMonthly, 2024))?.billingCycle).toBe('six_monthly')
    expect((await directory.forUnitAndYear(annual, 2024))?.billingCycle).toBe('annual')
  })

  it('returns a value a binary float cannot represent, unchanged', async () => {
    // The whole money decision rests on one sentence in migration 006 and in the
    // architecture: "a binary float cannot represent 0.10". This is that value,
    // carried end to end -- stored as numeric(14,2), read by `pg`, and handed
    // across the port.
    //
    // It is chosen because it *discriminates*. The control below shows why: many
    // plausible amounts survive a round trip through a JS number and would leave
    // a coercion here undetected. This one does not.
    const number = await givenAnAssessment('0A', 2024, '0.10', 'annual')

    const owed = await createAssessmentDirectory().forUnitAndYear(number, 2024)

    expect(owed?.annualAmount).toBe('0.10')
  })

  it('uses a value that a number round trip would visibly damage', async () => {
    // The control for the assertion above, and the reason it is not decoration.
    // A test asserting `1234.56` would pass against an adapter that coerced to a
    // number, because that value happens to survive; `0.10` does not, and this
    // proves the difference rather than asserting it in a comment.
    expect(String(Number('1234.56'))).toBe('1234.56')
    expect(String(Number('0.10'))).not.toBe('0.10')
  })

  it('reports the same annual amount for two units on different cycles', async () => {
    // AC2, through the port rather than against the table. This is the assertion
    // that forbids the adapter dividing the annual figure by the cycle on the
    // way out -- an "improvement" that would look reasonable in isolation and
    // would make story 2.3 divide an already-divided number.
    const monthly = await givenAnAssessment('MM', 2024, '1200.00', 'monthly')
    const annual = await givenAnAssessment('AA', 2024, '1200.00', 'annual')

    const directory = createAssessmentDirectory()
    const first = await directory.forUnitAndYear(monthly, 2024)
    const second = await directory.forUnitAndYear(annual, 2024)

    expect(first?.annualAmount).toBe(second?.annualAmount)
    expect(first?.annualAmount).toBe('1200.00')
    expect(first?.billingCycle).not.toBe(second?.billingCycle)
  })
})
