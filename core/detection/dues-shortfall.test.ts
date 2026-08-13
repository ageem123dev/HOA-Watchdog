/**
 * What a unit owed against what arrived (story 4.4).
 *
 * The criterion this file exists for is AC2, and it is not the obvious one. A
 * monthly payer and an annual payer owing the same figure for the year must
 * never differ in findings *because* their cycles differ — get that wrong and
 * every annual payer is delinquent for eleven months. It is asserted here with
 * the two cycles side by side rather than one at a time, because two tests that
 * each pass alone are exactly how that regression would survive.
 */

import { describe, expect, it } from 'vitest'

import { shortfallAgainst, type ReceivedPayment } from './dues-shortfall'
import type { AssessmentTerms } from '../assessment/schedule'

const YEAR = 2026

function terms(billingCycle: AssessmentTerms['billingCycle'], annualAmount = '1200.00'): AssessmentTerms {
  return { annualAmount, billingCycle, assessmentYear: YEAR }
}

function paid(amount: string, paidOn = '2026-01-05'): ReceivedPayment {
  return { paidOn, amount }
}

describe('a unit that has not paid what the schedule expects', () => {
  it('is flagged for the shortfall as of the evaluation date', () => {
    // Monthly, 1200 a year, so 100 a month. By 1 April four instalments have
    // fallen due — dues are collected in advance, so April's counts — and 300
    // has arrived.
    const found = shortfallAgainst(terms('monthly'), [paid('300.00')], '2026-04-01')

    expect(found).toMatchObject({
      kind: 'below-expected',
      expected: '400.00',
      received: '300.00',
      shortfall: '100.00',
      instalmentsDue: 4,
      billingCycle: 'monthly',
      evaluatedOn: '2026-04-01',
    })
  })

  it('separates nothing-arrived from something-arrived-but-short', () => {
    // **AC4.** The two flags the epic asks for are "paid late" and "paid the
    // wrong amount", and at any evaluation date those are exactly these two
    // cases: nothing has been recorded against what was due, or something has
    // and it does not cover it. One test distinguishes them — `received === 0`
    // — so a unit can never be both.
    const nothing = shortfallAgainst(terms('monthly'), [], '2026-04-01')
    const partial = shortfallAgainst(terms('monthly'), [paid('50.00')], '2026-04-01')

    expect(nothing).toMatchObject({ kind: 'not-recorded', received: '0.00', shortfall: '400.00' })
    expect(partial).toMatchObject({ kind: 'below-expected', received: '50.00', shortfall: '350.00' })
  })

  it('sums every payment it is given', () => {
    const found = shortfallAgainst(
      terms('monthly'),
      [paid('100.00'), paid('100.00', '2026-02-03'), paid('0.01', '2026-03-03')],
      '2026-04-01',
    )

    expect(found).toMatchObject({ received: '200.01', shortfall: '199.99' })
  })
})

describe('the cycle changes when money is owed, never how much', () => {
  it('is silent for both cycles when each has paid its own schedule', () => {
    // **The story's headline false positive, as an executable criterion.** The
    // epic's 2026-08-07 amendment: "a difference in cycle must never by itself
    // produce an arrears finding". An annual payer owes the whole year on
    // 1 January because dues are collected in advance; a monthly payer owes
    // four twelfths by 1 April. Each has paid exactly that.
    const monthly = shortfallAgainst(terms('monthly'), [paid('400.00')], '2026-04-01')
    const annual = shortfallAgainst(terms('annual'), [paid('1200.00')], '2026-04-01')

    expect(monthly).toBeNull()
    expect(annual).toBeNull()
  })

  it('expects the whole year from an annual payer from 1 January', () => {
    // The other half of that amendment, and the half that surprises people:
    // under start-of-period an annual payer is *not* given eleven months of
    // grace. Pinned so nobody "fixes" the schedule back to period-end.
    expect(shortfallAgainst(terms('annual'), [], '2026-01-01')).toMatchObject({
      expected: '1200.00',
      instalmentsDue: 1,
    })
  })

  it('expects nothing from a monthly payer before their first instalment', () => {
    const found = shortfallAgainst(terms('monthly'), [], '2025-12-31')

    expect(found).toBeNull()
  })

  it.each([
    { cycle: 'monthly', on: '2026-07-01', expected: '700.00', due: 7 },
    { cycle: 'six_monthly', on: '2026-07-01', expected: '1200.00', due: 2 },
    { cycle: 'annual', on: '2026-07-01', expected: '1200.00', due: 1 },
  ] as const)('expects $expected from a $cycle payer by $on', ({ cycle, on, expected, due }) => {
    const found = shortfallAgainst(terms(cycle), [], on)

    expect(found).toMatchObject({ expected, instalmentsDue: due, billingCycle: cycle })
  })
})

describe('the arithmetic is exact', () => {
  it('carries the remainder the schedule placed, rather than re-dividing', () => {
    // 1000.00 over twelve months is 83.33 with four cents left over, and story
    // 2.3 puts those on January through April. By 1 March the exact expectation
    // is 83.34 + 83.34 + 83.34 = 250.02, not 250.00 and not 249.99. Re-deriving
    // the instalment here as annual/12 would give one of the wrong two.
    const found = shortfallAgainst(terms('monthly', '1000.00'), [paid('250.00')], '2026-03-01')

    expect(found).toMatchObject({ expected: '250.02', received: '250.00', shortfall: '0.02' })
  })

  it('sums payments that a float would not add up', () => {
    // **Chosen because every other amount in this file is float-safe.** A
    // mutation summing `Number(amount) * 100` passed all sixteen cases, which
    // meant the exact-decimal premise was untested at the one step that does
    // the adding.
    //
    // 0.29, 0.57 and 0.14 are exactly 1.00 together. Through a float they are
    // 28.999999999999996, 57.00000000000001 and 14.000000000000002, and the
    // total is not an integer number of cents at all.
    const found = shortfallAgainst(
      terms('annual'),
      [paid('0.29'), paid('0.57', '2026-02-02'), paid('0.14', '2026-03-03')],
      '2026-06-01',
    )

    expect(found).toMatchObject({ received: '1.00', shortfall: '1199.00' })
  })

  it('flags a shortfall of a single cent', () => {
    const found = shortfallAgainst(terms('annual'), [paid('1199.99')], '2026-06-01')

    expect(found).toMatchObject({ kind: 'below-expected', shortfall: '0.01' })
  })
})

describe('what must not be flagged', () => {
  it('is silent when exactly the expected amount has arrived', () => {
    // The boundary, and it is one character away from being wrong in the source.
    expect(shortfallAgainst(terms('monthly'), [paid('400.00')], '2026-04-01')).toBeNull()
  })

  it('is silent when a unit has paid ahead of its schedule', () => {
    // Paying the year up front on a monthly cycle is not a finding. It is a
    // unit doing more than was asked.
    expect(shortfallAgainst(terms('monthly'), [paid('1200.00')], '2026-04-01')).toBeNull()
  })

  it('is silent before anything has fallen due', () => {
    // Nothing is expected, so nothing can be missing. Distinct from "expected
    // zero and received zero" arriving as a shortfall of zero, which would be a
    // finding raised about nothing at all.
    expect(shortfallAgainst(terms('annual'), [], '2025-06-01')).toBeNull()
  })

  it('is silent for an evaluation date after the year, once fully paid', () => {
    expect(shortfallAgainst(terms('monthly'), [paid('1200.00')], '2027-03-01')).toBeNull()
  })

  it('refuses an evaluation date that is not a calendar date', () => {
    // `expectedBy` is strict about this and the refusal is worth keeping rather
    // than catching: a malformed date would otherwise compare as a string
    // against every instalment and silently expect nothing.
    expect(() => shortfallAgainst(terms('monthly'), [], '2026-4-01')).toThrow(RangeError)
  })
})
