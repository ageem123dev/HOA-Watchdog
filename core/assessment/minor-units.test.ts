/**
 * Exact conversion between a decimal amount string and a count of minor units.
 *
 * The money convention crosses every boundary as a `numeric(14,2)` decimal
 * string, and dividing one into instalments needs integer arithmetic. This is
 * the only place the two representations meet, so it is the only place the
 * conversion can go wrong.
 *
 * The defect it exists to prevent is one line long:
 *
 *   Math.trunc(Number('0.29') * 100)   // 28, not 29
 *
 * `Number('0.29')` is 0.28999999999999998, and multiplying by 100 gives
 * 28.999999999999996. A whole cent, gone. Verified before this file was written,
 * and `'0.29'` is used below precisely because it discriminates — `'1000.00'`
 * and `'1234.56'` both survive the float route unharmed, so a test built from
 * those would pass against the broken implementation.
 */

import { describe, expect, it } from 'vitest'

import { fromMinorUnits, toMinorUnits } from './minor-units'

describe('toMinorUnits', () => {
  it('converts an ordinary amount', () => {
    expect(toMinorUnits('1000.00')).toBe(100000)
  })

  it('converts an amount the float route gets wrong', () => {
    // The case this module exists for. An implementation going through
    // `Number()` returns 28 here and is correct on almost every other amount.
    expect(toMinorUnits('0.29')).toBe(29)
  })

  it('is used with a value that the float route actually breaks on', () => {
    // The control for the case above, asserting a fact about JavaScript rather
    // than about this module: it shows the chosen value *can* fail, instead of
    // claiming so in a comment. Story 2.2 learned this the hard way — a
    // beside-case whose value survived the broken path proved nothing.
    expect(Math.trunc(Number('0.29') * 100)).toBe(28)
    expect(Math.trunc(Number('1000.00') * 100)).toBe(100000)
  })

  it.each([
    ['no decimal part at all', '1200', 120000],
    ['a single decimal place', '1200.5', 120050],
    ['the smallest amount above zero', '0.01', 1],
    ['zero', '0.00', 0],
    ['zero with no decimal part', '0', 0],
  ])('converts %s', (_label, amount, expected) => {
    expect(toMinorUnits(amount)).toBe(expected)
  })

  it('converts a negative amount, which extraction produces for a credit', () => {
    // `extraction.total_amount` is documented as negative for a credit to the
    // association, so this conversion must not assume amounts are positive.
    // `assessment.annual_amount` separately forbids them, in the database.
    expect(toMinorUnits('-12.34')).toBe(-1234)
  })

  it('converts the largest amount the column can hold', () => {
    // numeric(14,2) tops out at 12 digits before the point. The result is well
    // inside Number.MAX_SAFE_INTEGER, which is what makes integer arithmetic
    // safe here at all.
    expect(toMinorUnits('999999999999.99')).toBe(99999999999999)
    expect(Number.isSafeInteger(toMinorUnits('999999999999.99'))).toBe(true)
  })

  it.each([
    ['an empty string', ''],
    ['whitespace', '   '],
    ['a word', 'abc'],
    ['a thousands separator', '1,000.00'],
    ['more decimals than the scale', '1.234'],
    ['two decimal points', '1.2.3'],
    ['a leading plus', '+1.00'],
    ['leading whitespace', ' 1.00'],
    ['trailing whitespace', '1.00 '],
    ['exponent notation', '1e3'],
    ['a bare decimal point', '.50'],
    ['a trailing decimal point', '1.'],
  ])('refuses %s rather than coercing it', (_label, amount) => {
    // A silent NaN here becomes a wrong instalment several functions away, where
    // nothing remembers this input existed.
    expect(() => toMinorUnits(amount)).toThrow(TypeError)
  })

  it('refuses a non-string', () => {
    expect(() => toMinorUnits(null as unknown as string)).toThrow(TypeError)
    expect(() => toMinorUnits(12.34 as unknown as string)).toThrow(TypeError)
  })

  it('does not carry a newline from the rejected input into the message', () => {
    // Story 2.4 feeds *extracted* amounts through here — read off an uploaded
    // document, so untrusted in the strict sense. This project logs structured
    // JSON, and a raw newline in a message is a forged log line. Raised by
    // review and verified: the first version reproduced the input verbatim.
    const forged = '1.00\nlevel=info msg="payment cleared"'

    expect(() => toMinorUnits(forged)).toThrow(TypeError)

    try {
      toMinorUnits(forged)
    } catch (error) {
      expect((error as Error).message).not.toContain('\n')
      // And the input is still identifiable, which is the whole reason to
      // include it at all.
      expect((error as Error).message).toContain('1.00')
    }
  })

  it('bounds how much of the rejected input it repeats', () => {
    // An unbounded echo turns one bad field into a megabyte log line.
    const huge = '9'.repeat(10_000)

    try {
      toMinorUnits(`${huge}.999`)
    } catch (error) {
      expect((error as Error).message.length).toBeLessThan(200)
    }
  })

  it('still reports a TypeError for a value that cannot be stringified', () => {
    // `String(Object.create(null))` throws, so describing the input naively
    // replaces the intended error with a confusing one from inside the error
    // path itself.
    // Asserted on the *message*, not just the type. `String()` throws a
    // `TypeError` of its own, so `toThrow(TypeError)` alone passes whether the
    // error came from this function's contract or from its error path falling
    // over — which is what it did before the fix, silently.
    for (const hostile of [Object.create(null), Symbol('nope')]) {
      expect(() => toMinorUnits(hostile as string)).toThrow(/not a decimal amount/)
    }
  })
})

describe('fromMinorUnits', () => {
  it.each([
    ['an ordinary amount', 100000, '1000.00'],
    ['a value smaller than one unit', 4, '0.04'],
    ['zero', 0, '0.00'],
    ['a single minor unit', 1, '0.01'],
    ['exactly one whole unit', 100, '1.00'],
    ['a negative fraction', -4, '-0.04'],
    ['a negative whole amount', -100000, '-1000.00'],
  ])('formats %s', (_label, minorUnits, expected) => {
    // `4` must be `'0.04'` — not `'0.4'`, and not `'.04'`. Both are amounts a
    // treasurer would read as something else entirely.
    expect(fromMinorUnits(minorUnits)).toBe(expected)
  })

  it.each([
    ['a fractional count', 83.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a value beyond exact integer representation', Number.MAX_SAFE_INTEGER + 2],
  ])('refuses %s', (_label, minorUnits) => {
    // A fractional minor unit is a bug upstream — someone divided without
    // deciding where the remainder goes — and formatting it would hide that.
    expect(() => fromMinorUnits(minorUnits)).toThrow(RangeError)
  })

  it('reports a RangeError even for a value that cannot be interpolated', () => {
    // `${aSymbol}` throws `TypeError: Cannot convert a Symbol value to a string`,
    // so building the message naively replaces the intended RangeError with one
    // raised by the error path. The caller then sees a failure that has nothing
    // to do with what they did wrong. Raised by review and verified.
    expect(() => fromMinorUnits(Symbol('nope') as unknown as number)).toThrow(RangeError)
    expect(() => fromMinorUnits(Object.create(null) as number)).toThrow(RangeError)
  })
})

describe('the two together', () => {
  it.each([
    '0.00',
    '0.01',
    '0.29',
    '1.00',
    '83.33',
    '1000.00',
    '1200.00',
    '1234.56',
    '-12.34',
    '999999999999.99',
  ])('round-trips %s unchanged', (amount) => {
    // Reverse-it. The trailing zero cases matter most: `'1200.00'` must not come
    // back as `'1200'` or `'1200.0'`, because the scale is part of the value's
    // meaning when it is compared against a payment.
    expect(fromMinorUnits(toMinorUnits(amount))).toBe(amount)
  })

  it('normalises the forms that mean the same amount', () => {
    // Not every input round-trips to itself, and that is correct rather than a
    // gap: `'1200'` and `'1200.5'` are the same money as `'1200.00'` and
    // `'1200.50'`. The round trip is exact in *value*, and canonical in form.
    expect(fromMinorUnits(toMinorUnits('1200'))).toBe('1200.00')
    expect(fromMinorUnits(toMinorUnits('1200.5'))).toBe('1200.50')
  })
})
