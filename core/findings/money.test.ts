/**
 * Turning a stored amount into the figure a board member reads.
 *
 * The rule this file exists for is AC5, and it has two halves that pull in
 * opposite directions. A real figure must survive intact — every cent, at any
 * magnitude, with no locale in the loop. An amount that is absent or unreadable
 * must come back as *nothing*, because the one thing this function may never do
 * is hand the row a number the record does not support.
 *
 * `$0.00` is the specific danger. It is what every careless implementation
 * produces for a missing amount, it looks like a figure, and it is one a
 * treasurer would act on.
 */

import { describe, expect, it } from 'vitest'

import { formatAmount } from './money'

describe('an amount the record supports', () => {
  it('renders with a currency mark, thousands grouping and two places', () => {
    expect(formatAmount('1200.00')).toBe('$1,200.00')
  })

  it('keeps every cent of an amount no double could hold', () => {
    // **The exactness premise, and the only test that can fail if it is
    // abandoned.** Every other amount in this file survives a round trip
    // through a float, so a `Number(value).toFixed(2)` implementation passes
    // all of them. 9007199254740993 is 2^53 + 1: the first integer a double
    // cannot represent, and it comes back as ...92 through one.
    expect(formatAmount('9007199254740993.01')).toBe('$9,007,199,254,740,993.01')
  })

  it.each([
    { stored: '999.99', shown: '$999.99' },
    { stored: '1000.00', shown: '$1,000.00' },
    { stored: '1000000.00', shown: '$1,000,000.00' },
  ])('groups $stored at the fencepost as $shown', ({ stored, shown }) => {
    // Three and four digits either side of the first separator, then the second
    // separator. Off-by-one in a grouping loop lives at exactly these values.
    expect(formatAmount(stored)).toBe(shown)
  })

  it('supplies the cents when the record stored none', () => {
    // Postgres `numeric` hands back `1200` for a whole amount, not `1200.00`.
    expect(formatAmount('1200')).toBe('$1,200.00')
  })

  it('shows a genuine zero, which is not the same as no amount at all', () => {
    // The distinction the whole file turns on. A stored `0.00` is a fact; an
    // absent amount is the absence of one, and the next block proves they do
    // not render alike.
    expect(formatAmount('0.00')).toBe('$0.00')
  })

  it('puts the sign outside the currency mark on a credit', () => {
    expect(formatAmount('-250.50')).toBe('-$250.50')
  })

  it('can be read back to the digits it was given', () => {
    // Cross-check by inversion: strip the presentation and the original must
    // return. This catches a formatter that drops, reorders or duplicates a
    // digit while still producing something that looks like currency — which
    // is what a grouping loop does when it is wrong.
    const stored = '87654321.09'

    const shown = formatAmount(stored)

    expect(shown).not.toBeNull()
    expect(shown?.replace(/[$,]/g, '')).toBe(stored)
  })
})

describe('what the row must be told is absent', () => {
  it.each([
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
    { label: 'an empty string', value: '' },
    { label: 'blank', value: '   ' },
    { label: 'not a number at all', value: 'unreadable' },
    { label: 'two decimal points', value: '1.2.3' },
    { label: 'a number rather than a decimal string', value: 1200 },
    { label: 'an object', value: { amount: '1200.00' } },
    { label: 'three decimal places', value: '12.345' },
  ])('returns nothing for $label', ({ value }) => {
    // **Every one of these is a `$0.00` in a careless implementation**, and
    // AC5 names that as the failure: a figure a board member would act on,
    // manufactured from a record that has none. `null` is the row's cue to
    // show no amount, which is an assertion in the component tests.
    expect(formatAmount(value)).toBeNull()
  })

  it('refuses a number even when it would round to something plausible', () => {
    // Not a duplicate of the table above. That one asserts the type is
    // rejected; this one names why the tempting fix is wrong — accepting a
    // `number` here would put float arithmetic back in the one place this
    // module exists to keep it out of.
    expect(formatAmount(9007199254740993)).toBeNull()
  })
})
