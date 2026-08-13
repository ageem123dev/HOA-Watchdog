/**
 * The one place a stored amount becomes a figure on a screen.
 *
 * ## `null` is a rendering instruction, not an error
 *
 * The detectors store `amount` as `string | null` — an invoice whose figure
 * could not be read still raises a finding, because the *document* is the
 * evidence and the missing amount is part of what the board is being told. So
 * this function's job is not "parse or throw"; it is to distinguish an amount
 * the record supports from one it does not, and to say so in a way the row can
 * render as nothing at all.
 *
 * **`$0.00` is what a careless version produces for every one of those cases.**
 * It looks like a figure. On a fiduciary surface, a manufactured zero beside a
 * possible duplicate invoice is worse than no number, because it is a number
 * somebody could act on.
 *
 * ## String work, never arithmetic
 *
 * The amount arrives as a decimal string from `numeric` and leaves as a decimal
 * string. Nothing here converts to `number`, so there is no magnitude at which
 * cents start disappearing — the same reason `core/detection/vendor-spike.ts`
 * compares in `bigint` and `core/assessment/schedule.ts` divides in minor units.
 * A `Number(value).toFixed(2)` implementation passes almost every test that
 * could be written for this; the one that catches it uses 2^53 + 1.
 *
 * No `Intl`, no `toLocaleString`. Both read the ambient locale, so the same
 * finding would render `1.200,00` for one board member and `1,200.00` for
 * another, and the register would stop being one document.
 */

/** Optional sign, digits, and at most two decimal places. Matches `vendor-spike.ts`. */
const AMOUNT = /^(-?)(\d+)(?:\.(\d{1,2}))?$/

/** `9007199254740993` to `9,007,199,254,740,993`, by position rather than by value. */
function grouped(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * The amount as a board member reads it, or `null` when there is not one.
 *
 * Takes `unknown` rather than `string | null` deliberately: every caller is
 * reading a field off a `jsonb` blob, so the type at the call site is a promise
 * nobody checked. Narrowing here means there is exactly one place that decides
 * what counts as an amount, and no caller can skip it.
 */
export function formatAmount(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const match = AMOUNT.exec(value.trim())
  if (match === null) return null

  const [, sign, whole, fraction = ''] = match

  // The sign sits outside the currency mark — `-$250.50`, not `$-250.50`.
  return `${sign}$${grouped(whole!)}.${fraction.padEnd(2, '0')}`
}
