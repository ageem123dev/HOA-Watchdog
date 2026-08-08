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
import { deriveSchedule, expectedBy } from './schedule'

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
  // Twelve instalments of exactly 0.29 — see the float note in `expectedBy`.
  '3.48',
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

  it.each(['__proto__', 'constructor', 'toString', 'quarterly'])(
    'refuses a billing cycle of %s rather than crashing on it',
    (cycle) => {
      // Story 1.6d shipped this exact defect: `suggestions[key] ?? []` returned
      // `Object.prototype` members for a name that folded to `constructor`.
      // Indexing a plain object with an unvalidated key is the same mistake —
      // `DUE_MONTHS.constructor` is a function with a `length` of 1 and no
      // `map`, so the failure arrives as "months.map is not a function" from
      // three lines later, naming nothing useful. Verified before fixing.
      // Asserted on the **message**, not just the type. The crash throws a
      // `TypeError` of its own — "months.map is not a function" — so
      // `toThrow(TypeError)` alone passes whether the cycle was validated or
      // whether the function fell over three lines later. It did exactly that
      // before this was tightened, which makes it the third time in two stories
      // that a `toThrow(SomeType)` assertion could not tell the contract from
      // the crash.
      expect(() => deriveSchedule(anAssessment('1200.00', cycle as BillingCycle))).toThrow(
        /not a billing cycle/,
      )
    },
  )

  it('zero-pads a year shorter than four digits', () => {
    // `'999-01-01' < '2024-01-01'` is **false**, so an unpadded year breaks the
    // string ordering that is the entire reason these dates are strings.
    // Checked, not assumed.
    expect(deriveSchedule(anAssessment('1200.00', 'annual', 999))[0]?.dueOn).toBe('0999-01-01')
    expect('0999-01-01' < '2024-01-01').toBe(true)
  })

  it.each([2024.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses a year of %s', (year) => {
    // A fractional year produces '2024.5-01-01', which is not a date and sorts
    // nowhere sensible. The database constrains the year to 1900-2200; that
    // range is deliberately *not* restated here, because a second statement of a
    // rule is only safe when something fails on disagreement — migration 007's
    // lesson — and nothing would.
    expect(() => deriveSchedule(anAssessment('1200.00', 'monthly', year))).toThrow(RangeError)
  })

  it('does not repeat a rejected billing cycle raw in its error message', () => {
    // Two things were wrong with the first version, both raised by review and
    // both verified before changing anything.
    //
    // It asserted only inside a `catch`, so if the throw ever stopped happening
    // the block would not run and the test would pass with zero assertions.
    //
    // And it aimed at an unreachable path. It passed an amount carrying a
    // newline — but `AMOUNT` rejects that, so `toMinorUnits` threw first and the
    // `describeValue` call in *this* module was never reached. A well-formed
    // amount cannot contain a newline, so that path cannot be exercised at all.
    //
    // The cycle is the input that actually arrives unvalidated, which makes it
    // the one worth sanitising. This project logs structured JSON, and a raw
    // newline in a message is a forged log line.
    const forged = 'monthly\nlevel=info msg=\"all clear\"'

    expect(() => deriveSchedule(anAssessment('1200.00', forged as BillingCycle))).toThrow(TypeError)

    try {
      deriveSchedule(anAssessment('1200.00', forged as BillingCycle))
    } catch (error) {
      expect((error as Error).message).not.toContain('\n')
      expect((error as Error).message).toContain('monthly')
    }
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

  it.each(['new Date(', 'Date.parse', 'Date.now(', 'performance.now(', 'process.hrtime'])(
    'does not call %s',
    (forbidden) => {
      // AC3 says the evaluation date is a parameter. A behavioural test cannot
      // catch a clock read that happens to agree with the expected answer, so
      // the rule is asserted where it is deterministic — in the source.
      expect(source()).not.toContain(forbidden)
    },
  )
})

describe('expectedBy', () => {
  const monthly = deriveSchedule(anAssessment('1200.00', 'monthly'))

  it('expects nothing before the first instalment falls due', () => {
    expect(expectedBy(monthly, '2023-12-31')).toBe('0.00')
  })

  it('expects an instalment on the very day it falls due', () => {
    // Due in advance: the instalment for January is owed *on* 1 January, not
    // after it. This is the boundary the whole due-date decision turns on.
    expect(expectedBy(monthly, '2024-01-01')).toBe('100.00')
  })

  it('still expects only that instalment the day after', () => {
    expect(expectedBy(monthly, '2024-01-02')).toBe('100.00')
  })

  it('expects the next instalment once its own day arrives', () => {
    expect(expectedBy(monthly, '2024-02-01')).toBe('200.00')
  })

  it('expects the whole amount once the last instalment is due', () => {
    expect(expectedBy(monthly, '2024-12-01')).toBe('1200.00')
  })

  it('expects the whole amount for any date after the year', () => {
    // Epic 4 evaluates historical years, so a date years later must not wrap,
    // saturate or under-count.
    expect(expectedBy(monthly, '2031-06-15')).toBe('1200.00')
  })

  it('expects nothing from an empty schedule', () => {
    expect(expectedBy([], '2024-06-01')).toBe('0.00')
  })

  it('sums an uneven schedule exactly', () => {
    // The remainder instalments are 83.34 and the rest 83.33; five of them is
    // 83.34 * 4 + 83.33 = 416.69.
    const uneven = deriveSchedule(anAssessment('1000.00', 'monthly'))

    expect(expectedBy(uneven, '2024-05-01')).toBe('416.69')
    expect(expectedBy(uneven, '2024-12-01')).toBe('1000.00')
  })

  it('sums instalments a float would get wrong', () => {
    // This case exists because the one above does NOT discriminate. Summing via
    // `Number(amount) * 100` was mutated in and every test still passed:
    // `Number('83.34') * 100` is exactly 8334, and so are the other amounts in
    // play. The comment there had claimed "a float sum drifts here", which was
    // simply untrue — a test whose comment asserted a property the values could
    // not exercise.
    //
    // 3.48 over twelve months is twelve instalments of exactly 0.29, and
    // `Number('0.29') * 100` is 28.999999999999996. Five of them sum to
    // 144.99999999999997 rather than 145, which is not an exact count of minor
    // units and cannot be formatted. Verified before this test was written.
    const schedule = deriveSchedule(anAssessment('3.48', 'monthly'))

    expect(schedule[0]?.amount).toBe('0.29')
    expect(expectedBy(schedule, '2024-05-01')).toBe('1.45')
    expect(expectedBy(schedule, '2024-12-01')).toBe('3.48')
  })

  it.each(['', '2024-6-01', '01/06/2024', '2024-06-01T00:00:00Z', 'yesterday'])(
    'refuses an evaluation date of %s',
    (on) => {
      // The comparison is a string comparison, which is only a date comparison
      // while the format holds. '2024-6-01' sorts after '2024-12-01'.
      expect(() => expectedBy(monthly, on)).toThrow(/not a calendar date/)
    },
  )

})

describe('AC2 - a cycle changes when money is owed, never how much', () => {
  it('expects different amounts to date, from schedules that sum the same', () => {
    // Both halves, because either alone is satisfied by a wrong implementation.
    // "Same annual total" alone passes against a function that expects the full
    // amount immediately for every cycle. "Different to date" alone passes
    // against one that scales the annual figure by the cycle.
    const monthly = deriveSchedule(anAssessment('1200.00', 'monthly'))
    const annual = deriveSchedule(anAssessment('1200.00', 'annual'))
    const on = '2024-07-01'

    expect(expectedBy(monthly, on)).toBe('700.00')
    expect(expectedBy(annual, on)).toBe('1200.00')

    expect(expectedBy(monthly, '2024-12-31')).toBe(expectedBy(annual, '2024-12-31'))
    expect(expectedBy(monthly, '2024-12-31')).toBe('1200.00')
  })

  it('holds for every cycle at the end of the year', () => {
    // The general form: whatever the cycle, the year's total is the annual
    // amount. A cycle that scaled the figure would fail here for at least one.
    for (const cycle of BILLING_CYCLES) {
      const schedule = deriveSchedule(anAssessment('1000.00', cycle))

      expect(expectedBy(schedule, '2024-12-31')).toBe('1000.00')
    }
  })
})
