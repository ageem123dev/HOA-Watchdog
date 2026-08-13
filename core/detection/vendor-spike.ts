import type { InvoiceReading } from './duplicate-invoice'

/**
 * When a vendor has charged more than usual (FR-6, story 4.3).
 *
 * > "…as are invoices exceeding a vendor's trailing 6-month average by a defined
 * > threshold."
 *
 * ## The rounding happens once, and not where the decision is made
 *
 * `numeric(14,2)` averaged over six months does not divide evenly, so a
 * percentage computed from a *rounded* average is not the same number as one
 * computed from the exact sum. That difference decides findings near the
 * boundary, so it is settled here rather than left to whichever expression ran
 * first.
 *
 * The average is never computed as an intermediate value. With `n` prior
 * invoices summing to `s`, the average is `s / n`, so
 *
 *     amount / average  =  amount * n / s
 *
 * and the comparison becomes `(amount * n - s) * 100 > threshold * s` — integer
 * arithmetic on cents, in `BigInt`, with **no division and no rounding at all**.
 * Rounding enters only when the percentage is formatted for a board member to
 * read, which cannot change what was flagged.
 *
 * Story 2.2's money decision is exact decimal end to end. `Number('0.10')` is
 * where that would have ended.
 */

/**
 * How far above the trailing average an invoice must be, as a percentage.
 *
 * A named export read once, because the epic's decision of 2026-08-12 says so:
 * *"4.3 should read its threshold through a single named export rather than
 * inlining the number at the query, so the later epic changes where the value
 * comes from and not what reads it."*
 *
 * Changing it is a code change with a review and a diff. On a fiduciary product
 * that is closer to a feature than a limitation — a board can be told exactly
 * what the system compared against on any given date, and prove it.
 */
export const SPIKE_THRESHOLD_PERCENT = 20

/** The trailing window, in whole months, ending at the invoice's own date. */
export const TRAILING_WINDOW_MONTHS = 6

/**
 * The fewest prior invoices that make an average worth comparing against.
 *
 * **The false positive this detector is most likely to ship is a brand-new
 * vendor's second invoice.** With one prior invoice the "average" *is* that
 * invoice, so any first increase over the threshold fires — and a vendor's
 * opening bill is exactly the one least likely to be typical. With two, a single
 * unusual bill still sets half the baseline.
 *
 * Three is the smallest number where no single invoice decides the comparison on
 * its own. It is a judgement, not a derivation, which is why it is named, tested
 * on both sides, and put in the finding's evidence for a board member to weigh.
 */
export const MINIMUM_HISTORY = 3

export interface VendorSpike {
  /** How far above the average, as a decimal string with one place. Display only. */
  readonly percentOverAverage: string
  /** The trailing average, as a decimal string. Display only — see the header. */
  readonly average: string
  /** UX-DR24's count: reassurance without a denominator is what that rule forbids. */
  readonly invoicesAveraged: number
}

/** `'250.00'` to `25000n`. Null when the amount is absent, unreadable, or not positive. */
function cents(amount: string | null): bigint | null {
  if (amount === null) return null

  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim())
  if (match === null) return null

  const [, sign, whole, fraction = ''] = match
  // `padEnd` always returns two characters here, so no fallback is needed for
  // an absent fraction — `''` becomes `'00'`. Raised by Argus.
  const value = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))

  // **Nothing but a positive charge counts.** A credit is money coming back —
  // `total_amount` is negative for a credit to the association (migration 006)
  // — and a 0.00 invoice is a document rather than a charge. Averaging either
  // in says the vendor charged less than they did, which drags the average down
  // and makes the next ordinary invoice look like a spike.
  //
  // Zero was returning `0n` here while this function's own summary promised
  // null for anything "not positive". CodeRabbit read the two against each
  // other; the summary was the one that was right.
  return sign === '-' || value === 0n ? null : value
}

/** Rounded half-up to `places`, from an exact numerator and denominator. */
function ratioToDecimal(numerator: bigint, denominator: bigint, places: number): string {
  const scale = 10n ** BigInt(places)
  const scaled = (numerator * scale * 10n) / denominator
  const rounded = (scaled + (scaled < 0n ? -5n : 5n)) / 10n
  const sign = rounded < 0n ? '-' : ''
  const magnitude = rounded < 0n ? -rounded : rounded

  return places === 0
    ? `${sign}${magnitude}`
    : `${sign}${magnitude / scale}.${String(magnitude % scale).padStart(places, '0')}`
}

/**
 * Whether this invoice is above its vendor's trailing average, and by how much.
 *
 * `history` is the vendor's earlier invoices **within the window**; selecting
 * them is the reader's job, the way ordering is in `duplicatesAmong`. What this
 * function owns is the arithmetic and the two refusals: too little history, and
 * anything whose amount could not be read.
 */
export function spikeAgainst(
  invoice: InvoiceReading,
  history: readonly InvoiceReading[],
): VendorSpike | null {
  const amount = cents(invoice.amount)
  if (amount === null) return null

  // An unreadable amount is dropped rather than counted as zero, which would
  // drag the average down and manufacture a spike. Story 4.2's null trap in a
  // new place: an average computed over nulls is not an average.
  const priors = history.map((prior) => cents(prior.amount)).filter((value) => value !== null)
  if (priors.length < MINIMUM_HISTORY) return null

  // No guard on the sum, and that is deliberate. `cents` admits nothing below
  // one penny, so a sum of at least `MINIMUM_HISTORY` of them cannot be zero
  // and `ratioToDecimal` below cannot divide by it. The guard that used to
  // stand here was unreachable the moment zero stopped parsing — and what
  // keeps it unnecessary is a test, not a comment: *refuses a history of
  // nothing but zero-value invoices* fails loudly if `cents` is ever loosened.
  const sum = priors.reduce((total, value) => total + value, 0n)
  const count = BigInt(priors.length)
  const excess = amount * count - sum

  // The decision, in integers: no division, so no rounding can move it.
  if (excess * 100n <= BigInt(SPIKE_THRESHOLD_PERCENT) * sum) return null

  return {
    percentOverAverage: ratioToDecimal(excess * 100n, sum, 1),
    average: ratioToDecimal(sum, count * 100n, 2),
    // The threshold is not repeated here. It is a property of the run, not of
    // each spike, and `detect-vendor-spikes.ts` records it once per finding —
    // a document with three spikes was storing the same constant four times.
    // Found by the acceptance-criteria audit, which is what that audit is for.
    invoicesAveraged: priors.length,
  }
}
