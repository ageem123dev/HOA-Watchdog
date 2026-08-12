import { normaliseVendorName } from '../vendor/name'
import { sameInvoiceNumber } from './invoice-number'

/**
 * Which invoices are duplicates of which (FR-6).
 *
 * > "Exact duplicates (matching amount and date) and fuzzy duplicates (similar
 * > invoice number, identical amount) are flagged."
 *
 * Two rules, and **both require the amount to be identical**. That is what keeps
 * the detector from firing on a vendor's ordinary monthly billing, and it is why
 * the amount is never compared loosely.
 *
 * ## Pure, and deliberately self-sufficient
 *
 * The adapter narrows the candidate set in SQL — same vendor, same amount,
 * earlier document — because that is the cheap way to ask the database. This
 * function re-checks every one of those conditions anyway. A caller that hands
 * it an unfiltered set gets the right answer rather than a plausible one, and
 * the rules stay testable without a database.
 *
 * ## The comparison a mock cannot be wrong about
 *
 * Amounts are compared as the decimal **strings** the database rendered, never
 * as numbers: story 2.2's money decision is exact decimal end to end, and
 * `Number('0.10')` is where that ends. Both sides come from the same
 * `numeric(14,2)` column, so Postgres renders them identically or they are not
 * equal. `250.0` against `250.00` would be a false negative here — it cannot
 * arise from that column, and the SQL that fetches candidates compares with
 * numeric `=` regardless.
 */

/** One invoice as it was read, straight from `extraction`. Every field but the ids can be absent. */
export interface InvoiceReading {
  /** The `extraction` row. **Not stable across re-ingest** — see the story's identity decision. */
  readonly extractionId: string
  /** The document it was read from. Stable, and what a finding is keyed on. */
  readonly documentId: string
  readonly vendorName: string | null
  readonly documentNumber: string | null
  /** `YYYY-MM-DD`, never a `Date`: a date is a calendar day, and a `Date` is an instant. */
  readonly issuedOn: string | null
  /** The decimal string, exactly as the database rendered it. */
  readonly amount: string | null
}

/**
 * Why two invoices were paired.
 *
 * Named rather than boolean because a board member is shown this. UX-DR23
 * forbids implying certainty the system lacks, and *"the same amount on the same
 * date"* is a statement of what was compared — where "duplicate" would be a
 * claim about what happened.
 */
export type DuplicateReason = 'same-amount-and-date' | 'same-amount-and-number'

export interface DuplicateMatch {
  readonly priorExtractionId: string
  readonly priorDocumentId: string
  readonly reason: DuplicateReason
}

/** Absent, or present and empty — the same fact reached two ways. */
function missing(value: string | null): value is null {
  return value === null || value.trim() === ''
}

function sameVendor(left: InvoiceReading, right: InvoiceReading): boolean {
  if (missing(left.vendorName) || missing(right.vendorName)) return false

  // `normaliseVendorName` is the TypeScript half of `vendor_normalised_name`,
  // which `vendor` and `quarantine_item` both generate their keys from. A rule
  // of its own here would let one vendor be two vendors to the detector alone.
  return normaliseVendorName(left.vendorName) === normaliseVendorName(right.vendorName)
}

function sameAmount(left: InvoiceReading, right: InvoiceReading): boolean {
  // A missing amount matches nothing, including another missing one. Without
  // this, every invoice the extractor could not read an amount from pairs with
  // every other, and the board is shown a duplicate that is really two failures
  // to read.
  if (missing(left.amount) || missing(right.amount)) return false

  return left.amount === right.amount
}

function sameDate(left: InvoiceReading, right: InvoiceReading): boolean {
  if (missing(left.issuedOn) || missing(right.issuedOn)) return false

  return left.issuedOn === right.issuedOn
}

/**
 * Every prior invoice that this one appears to duplicate, in the order given.
 *
 * Every match is returned rather than the first: a finding is keyed on the
 * document and its evidence lists the pairs, so stopping early would hide one of
 * them behind another.
 *
 * A reading never matches itself, and never matches another reading of the
 * **same document** — one upload can carry several invoice rows, and two
 * readings of one document are not two payments.
 */
export function duplicatesAmong(
  subject: InvoiceReading,
  priors: readonly InvoiceReading[],
): readonly DuplicateMatch[] {
  const matches: DuplicateMatch[] = []

  for (const prior of priors) {
    if (prior.documentId === subject.documentId) continue
    if (!sameVendor(subject, prior) || !sameAmount(subject, prior)) continue

    // The date rule first, and the reason is what a board member reads. "The
    // same amount on the same day" needs no explanation; "the same reference,
    // spelled differently" needs one. When both hold, show the stronger claim.
    const reason: DuplicateReason | null = sameDate(subject, prior)
      ? 'same-amount-and-date'
      : sameInvoiceNumber(subject.documentNumber, prior.documentNumber)
        ? 'same-amount-and-number'
        : null

    if (reason === null) continue

    matches.push({
      priorExtractionId: prior.extractionId,
      priorDocumentId: prior.documentId,
      reason,
    })
  }

  return matches
}
