/**
 * The instalments an annual assessment is actually paid in.
 *
 * Two properties carry this file. The instalments must sum to **exactly** the
 * annual amount — AC1 — and the derivation must be a pure function with no clock
 * of its own — AC3.
 *
 * Both are the kind that a single worked example fails to test. `1200.00` over
 * twelve months divides evenly and passes against an implementation that drops
 * the remainder entirely; `1000.00` does not. The amounts below are chosen for
 * that reason, and the sum is asserted as a property across all of them rather
 * than demonstrated once.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { BILLING_CYCLES, type BillingCycle } from './billing-cycle'
import { fromMinorUnits, toMinorUnits } from './minor-units'
import { deriveSchedule } from './schedule'

const anAssessment = (annualAmount: string, billingCycle: BillingCycle, assessmentYear = 2024) => ({
  annualAmount,
  billingCycle,
  assessmentYear,
})

/** Amounts chosen to include ones that do not divide evenly by 12, 2 or 1. */
const AMOUNTS = [
  '1200.00',
  '1000.00',
  '0.05',
  '0.01',
  '999999999999.99',
  '83.33',
  '1234.56',
  '7.77',
]

describe('deriveSchedule', () => {
  it('divides an annual amount evenly when it divides evenly', () => {
    const schedule = deriveSchedule(anAssessment('1200.00', 'monthly'))

    expect(schedule).toHaveLength(12)
    expect(schedule[0]).toEqual({ dueOn: '2024-01-01', amount: '100.00' })
    expect(schedule[11]).toEqual({ dueOn: '2024-12-01', amount: '100.00' })
  })

  it('places the remainder on the earliest instalments', () => {
    // The decision recorded in the story: 1000.00 over twelve months is 83.33
    // with 0.04 left, so the first four carry the extra cent. Asserted as the
    // whole schedule rather than a spot check, because "where the remainder
    // went" is the entire content of this test.
    const schedule = deriveSchedule(anAssessment('1000.00', 'monthly'))

    expect(schedule.map((i) => i.amount)).toEqual([
      '83.34',
      '83.34',
      '83.34',
      '83.34',
      '83.33',
      '83.33',
      '83.33',
      '83.33',
      '83.33',
      '83.33',
      '83.33',
      '83.33',
    ])
  })

  it.each(AMOUNTS.flatMap((amount) => BILLING_CYCLES.map((cycle) => [amount, cycle] as const)))(
    'instalments for %s on a %s cycle sum to exactly the annual amount',
    (amount, cycle) => {
      // AC1, as a property. This is the assertion the task exists for: an
      // implementation that divides and rounds each instalment independently
      // passes every evenly-divisible case and fails here.
      const schedule = deriveSchedule(anAssessment(amount, cycle))
      const total = schedule.reduce((sum, i) => sum + toMinorUnits(i.amount), 0)

      expect(fromMinorUnits(total)).toBe(fromMinorUnits(toMinorUnits(amount)))
    },
  )

  it('handles an amount smaller than the number of instalments', () => {
    // Five cents over twelve months. Seven instalments are genuinely zero, and
    // the sum is still exact — the fencepost case for "spread the remainder".
    const schedule = deriveSchedule(anAssessment('0.05', 'monthly'))

    expect(schedule.map((i) => i.amount)).toEqual([
      '0.01',
      '0.01',
      '0.01',
      '0.01',
      '0.01',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
    ])
  })

  it.each([
    ['monthly', 'monthly', 12, ['2024-01-01', '2024-12-01']],
    ['six-monthly', 'six_monthly', 2, ['2024-01-01', '2024-07-01']],
    ['annual', 'annual', 1, ['2024-01-01', '2024-01-01']],
  ] as const)('gives a %s cycle its due dates', (_label, cycle, count, [first, last]) => {
    // Due at the START of the period each instalment covers — dues in advance,
    // the decision recorded in the story. Every due date is the first of a
    // month, which is why leap years never arise here.
    const schedule = deriveSchedule(anAssessment('1200.00', cycle))

    expect(schedule).toHaveLength(count)
    expect(schedule[0]?.dueOn).toBe(first)
    expect(schedule.at(-1)?.dueOn).toBe(last)
  })

  it('zero-pads the month, so the dates sort and compare as strings', () => {
    // '2024-1-01' would sort after '2024-12-01' and compare wrong against an
    // evaluation date. The whole point of a YYYY-MM-DD string is that ordinary
    // string comparison is date comparison.
    const dueOn = deriveSchedule(anAssessment('1200.00', 'monthly')).map((i) => i.dueOn)

    expect(dueOn).toEqual([...dueOn].sort())
    for (const date of dueOn) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('uses the assessment year it was given', () => {
    const schedule = deriveSchedule(anAssessment('1200.00', 'annual', 2019))

    expect(schedule[0]?.dueOn).toBe('2019-01-01')
  })

  it('returns the same schedule for the same input, every time', () => {
    // AC3. A function that consulted a clock, or ordered by anything ambient,
    // would drift between these two calls.
    const first = deriveSchedule(anAssessment('1000.00', 'monthly'))
    const second = deriveSchedule(anAssessment('1000.00', 'monthly'))

    expect(first).toEqual(second)
  })

  it.each(['0.00', '-1.00'])('refuses an annual amount of %s', (amount) => {
    // A schedule for nothing owed is not a schedule. The database already
    // forbids these on `assessment.annual_amount`; this refuses to invent an
    // answer if one ever arrives another way.
    expect(() => deriveSchedule(anAssessment(amount, 'monthly'))).toThrow(RangeError)
  })
})

describe('the module reads no clock', () => {
  const source = () =>
    readFileSync(join(process.cwd(), 'core', 'assessment', 'schedule.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')

  it('reads a source file that still has its statements', () => {
    // The control. Asserted on a phrase genuinely in the file before stripping
    // and gone after, because story 2.2 shipped a control that asserted the
    // absence of a phrase never present in the file it read — and so held with
    // the stripping deleted.
    //
    // Single-line, and that is not incidental: the docblock wraps, so a sentence
    // spanning two lines is broken by a newline and a ` * ` and never matches.
    // The first version of this picked "dues are collected in advance", which
    // wraps, and failed for that reason rather than a real one — the same
    // mistake 2.2 made when fixing its own version of this control.
    const COMMENT_ONLY = /leap years and short months never arise/

    expect(readFileSync(join(process.cwd(), 'core', 'assessment', 'schedule.ts'), 'utf8')).toMatch(
      COMMENT_ONLY,
    )
    expect(source()).not.toMatch(COMMENT_ONLY)
    expect(source()).toMatch(/export function deriveSchedule/)
  })

  it.each(['new Date(', 'Date.now(', 'performance.now(', 'process.hrtime'])(
    'does not call %s',
    (forbidden) => {
      // AC3 says the evaluation date is a parameter. A behavioural test cannot
      // catch a clock read that happens to agree with the expected answer, so
      // the rule is asserted where it is deterministic — in the source.
      expect(source()).not.toContain(forbidden)
    },
  )
})
