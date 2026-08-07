/**
 * Exact conversion between a decimal amount string and a count of minor units.
 *
 * The money convention crosses every boundary as a `numeric(14,2)` decimal
 * string — `numeric` in Postgres, a string in `pg`, a string on every port. That
 * is right for storing and comparing, and useless for dividing an annual figure
 * into instalments. This is where the two representations meet, and it is
 * deliberately the only place they do.
 *
 * **Nothing here goes through a float.** The obvious conversion is one line and
 * wrong:
 *
 *   Math.trunc(Number('0.29') * 100)   // 28
 *
 * `Number('0.29')` is 0.28999999999999998 and multiplying by 100 gives
 * 28.999999999999996. Most amounts survive it — `'1000.00'` and `'1234.56'` both
 * come through unharmed — which is what makes it dangerous: it is correct in
 * testing and wrong in an association's ledger.
 *
 * So both directions work on the digits themselves. The only arithmetic is a
 * single integer parse, and integers below `Number.MAX_SAFE_INTEGER` are exact.
 * `numeric(14,2)` tops out at 99,999,999,999,999 minor units, four orders of
 * magnitude inside that bound.
 *
 * No dependency. A decimal library would do this too, and adding one is a
 * decision that belongs to the person maintaining the project rather than to a
 * story that needed division.
 */

/**
 * An amount as `numeric(14,2)` presents it: optional sign, digits, and at most
 * two decimal places. Deliberately strict — no thousands separators, no
 * exponent, no surrounding whitespace, no leading `+`.
 *
 * Being strict is the point. Every rejected form is one that some other system
 * emits and this one would otherwise misread: `'1,000.00'` parses as 1 under a
 * lenient reading, and `'1e3'` as 1000.
 */
const AMOUNT = /^-?\d+(\.\d{1,2})?$/

const SCALE = 2

/** How much of a rejected value an error message may repeat. */
const ECHO_LIMIT = 40

/**
 * A rejected value, rendered safely enough to put in an error message.
 *
 * Three separate hazards, all raised by review and all reproduced before this
 * was written:
 *
 * - **Newlines.** This project logs structured JSON, so a raw newline in a
 *   message is a forged log line. `JSON.stringify` escapes it. Story 2.4 feeds
 *   amounts read off uploaded documents through here, which makes the input
 *   untrusted in the strict sense rather than the theoretical one.
 * - **Length.** An unbounded echo turns one bad field into a megabyte log line.
 * - **Values that cannot be stringified at all.** `${aSymbol}` throws, and so
 *   does `String(Object.create(null))` — so a naive message replaces the error
 *   the caller should see with one raised by the error path itself.
 */
const echo = (value: unknown): string => {
  try {
    const text = typeof value === 'symbol' ? value.toString() : String(value)
    return JSON.stringify(text.slice(0, ECHO_LIMIT))
  } catch {
    return `[unprintable ${typeof value}]`
  }
}

export function toMinorUnits(amount: string): number {
  if (typeof amount !== 'string' || !AMOUNT.test(amount)) {
    throw new TypeError(`not a decimal amount with at most ${SCALE} decimal places: ${echo(amount)}`)
  }

  const negative = amount.startsWith('-')
  const [whole = '', fraction = ''] = (negative ? amount.slice(1) : amount).split('.')

  // Concatenated, not multiplied: `'1000' + '00'` parsed once as `100000`. There
  // is no intermediate value for a float to round.
  const minorUnits = Number(whole + fraction.padEnd(SCALE, '0'))

  if (!Number.isSafeInteger(minorUnits)) {
    throw new RangeError(`amount cannot be represented exactly in minor units: ${amount}`)
  }

  return negative ? -minorUnits : minorUnits
}

export function fromMinorUnits(minorUnits: number): string {
  if (!Number.isSafeInteger(minorUnits)) {
    // Catches a fractional count as well as NaN, Infinity and anything past
    // exact integer representation. A fractional minor unit means someone
    // divided without deciding where the remainder goes, and formatting it
    // would bury that decision rather than surface it.
    throw new RangeError(`not an exact count of minor units: ${echo(minorUnits)}`)
  }

  const negative = minorUnits < 0
  // Padded so the slice below always has something to take: `4` becomes `'004'`,
  // which is `'0'` and `'04'` rather than `''` and `'4'`.
  const digits = String(Math.abs(minorUnits)).padStart(SCALE + 1, '0')

  return `${negative ? '-' : ''}${digits.slice(0, -SCALE)}.${digits.slice(-SCALE)}`
}
