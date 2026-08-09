/**
 * One row of an assessment roll.
 *
 * A roll row states four things a deposit line does not: which unit, who holds
 * it, from when, and what it owes for a year on what cadence. That is why it is
 * its own type rather than four more nullable fields on `ExtractionRecord`.
 *
 * **The reason is `holdUnknownVendors`, not tidiness.** `ExtractionRecord`
 * already carries a plausible home for every value here — the unit in
 * `unitReference`, the amount in `totalAmount`, the date in `issuedOn`, the
 * holder's name in `vendorName` — so on field count alone, widening would have
 * been cheaper. But every distinct non-null `vendorName` a reading produces is
 * resolved against the vendor directory and quarantined when nobody knows it. A
 * holder routed through that field would ask a treasurer whether each of their
 * owners is a vendor they recognise, once per name, on every roll upload.
 * Nothing in the type system would have caught it: the field is `string | null`
 * either way.
 *
 * Pure, like everything beside it here. The database decides which unit a
 * spelling names; this decides only whether the roll said something storable.
 */

import { BILLING_CYCLES, type BillingCycle } from '../assessment/billing-cycle'
import { AMOUNT_PATTERN, UNIT_REFERENCE_MAX_LENGTH } from './record'

/**
 * `unit_holder.full_name` in migration 012.
 *
 * Deliberately its own constant even though `VENDOR_NAME_MAX_LENGTH` is also
 * 200. They are two constraints on two tables that happen to agree today, and
 * borrowing one to bound the other would make a later change to vendor names
 * silently change which owners a roll can name.
 */
export const HOLDER_NAME_MAX_LENGTH = 200

/**
 * `assessment_year_plausible` in migration 013.
 *
 * Loose on purpose — a sanity check against a typo'd `20024` or a pasted cell,
 * not a business rule about which years an association may bill.
 */
export const MIN_ASSESSMENT_YEAR = 1900
export const MAX_ASSESSMENT_YEAR = 2200

/** The two columns a roll needs and no other document kind does. */
export const ROLL_HEADERS = ['cycle', 'year'] as const

const AMOUNT = new RegExp(AMOUNT_PATTERN)
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const WHOLE_NUMBER = /^\d+$/

export interface RollRow {
  /**
   * As the roll spelled it, not folded.
   *
   * Migration 011 stores `unit_number` as the treasurer typed it and compares on
   * a generated `normalised_number`. Folding here would store the comparison key
   * as though it were the name.
   */
  readonly unitNumber: string
  readonly holderName: string
  /** The first day of the tenure, `YYYY-MM-DD`. */
  readonly heldFrom: string
  /** The **annual** figure as a decimal string, never the instalment. */
  readonly annualAmount: string
  readonly billingCycle: BillingCycle
  readonly assessmentYear: number
}

/** What a roll row was asked to be built from, one cell each. */
export interface RollCandidate {
  readonly unitNumber: string | null
  readonly holderName: string
  readonly heldFrom: string
  readonly annualAmount: string
  readonly cycle: string | null
  readonly year: string | null
}

export type RollRowResult = { readonly ok: true; readonly row: RollRow } | { readonly ok: false }

/** `text` cannot store a NUL, and a parameter carrying one aborts the transaction. */
const hasNul = (value: string): boolean => value.includes('\u0000')

/**
 * More than `max` code points?
 *
 * Code points, because `char_length` counts those and `.length` counts UTF-16
 * units — 64 astral characters are 128 by the wrong measure, and guarding on it
 * would refuse a unit number the table stores happily.
 *
 * Counted with an early exit rather than `[...value].length`. The spread
 * allocates one array element per code point *before* anything is compared, and
 * the value reaching here is an untrusted cell bounded only by the 25 MiB upload
 * limit — so a single hostile cell would allocate hundreds of megabytes to
 * answer a question settled after 65 characters. Raised by review.
 *
 * The UTF-16 length is a free upper bound: a string can never hold more code
 * points than units, so anything at or under `max` units is at or under `max`
 * code points and needs no counting at all.
 */
function tooLong(value: string, max: number): boolean {
  if (value.length <= max) return false

  // The string iterator walks code points; stepping it by hand keeps the count
  // allocation-free and lets it stop at `max + 1`.
  const codePoints = value[Symbol.iterator]()
  let counted = 0

  while (!codePoints.next().done) {
    counted += 1
    if (counted > max) return true
  }

  return false
}

/** A calendar date that exists — `2026-02-30` matches the format and is not a day. */
function isRealDate(value: string): boolean {
  const parts = ISO_DATE.exec(value)
  if (parts === null) return false

  const year = Number(parts[1])
  const month = Number(parts[2])
  const day = Number(parts[3])
  const asDate = new Date(Date.UTC(year, month - 1, day))

  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  )
}

/**
 * Greater than zero, decided without a float.
 *
 * `assessment_amount_positive` refuses zero and negatives, and it refuses them
 * by aborting the transaction the whole roll is written in — so one `0.00` cell
 * would cost the document rather than the row. `AMOUNT_PATTERN` admits both.
 *
 * The shape is already known to be `-?digits(.digits)?` by the time this runs,
 * so any digit other than zero means the value exceeds zero. No `Number()`, no
 * rounding, no representation that could disagree with `numeric(14,2)`.
 */
function isPositiveAmount(amount: string): boolean {
  if (amount.startsWith('-')) return false

  return /[1-9]/.test(amount)
}

/**
 * A candidate into a roll row, or a refusal.
 *
 * **Refusal over repair**, the bias `validate` states and for the same reason: a
 * roll row that has been quietly mended reads as a successful upload and puts a
 * figure on an association's ledger that the document did not state.
 *
 * Two coercions are allowed, and neither can change a meaning: the ends of
 * `cycle` and `year` are trimmed, and `cycle` is case-folded. Migration 013's
 * check constraint is lower-case only, so `Monthly` is a row the database
 * rejects while naming one of exactly three things — the same argument that lets
 * `validate` upper-case a currency code. `amount` and `heldFrom` are **not**
 * trimmed: they reuse `AMOUNT_PATTERN` and the calendar check unchanged rather
 * than forking the project's single statement of either.
 */
export function readRollRow(candidate: RollCandidate): RollRowResult {
  const { unitNumber, holderName, heldFrom, annualAmount } = candidate

  if (unitNumber === null) return { ok: false }
  if (unitNumber.trim() === '' || hasNul(unitNumber)) return { ok: false }
  if (tooLong(unitNumber, UNIT_REFERENCE_MAX_LENGTH)) return { ok: false }

  const holder = holderName.trim()
  if (holder === '' || hasNul(holder)) return { ok: false }
  if (tooLong(holder, HOLDER_NAME_MAX_LENGTH)) return { ok: false }

  if (!isRealDate(heldFrom)) return { ok: false }

  if (!AMOUNT.test(annualAmount)) return { ok: false }
  if (!isPositiveAmount(annualAmount)) return { ok: false }

  if (candidate.cycle === null) return { ok: false }
  const cycle = candidate.cycle.trim().toLowerCase()
  if (!(BILLING_CYCLES as readonly string[]).includes(cycle)) return { ok: false }

  if (candidate.year === null) return { ok: false }
  const year = candidate.year.trim()
  if (!WHOLE_NUMBER.test(year)) return { ok: false }

  const assessmentYear = Number(year)
  if (assessmentYear < MIN_ASSESSMENT_YEAR || assessmentYear > MAX_ASSESSMENT_YEAR) {
    return { ok: false }
  }

  return {
    ok: true,
    row: {
      unitNumber,
      holderName: holder,
      heldFrom,
      annualAmount,
      billingCycle: cycle as BillingCycle,
      assessmentYear,
    },
  }
}
