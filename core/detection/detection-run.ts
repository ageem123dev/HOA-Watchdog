import type { FindingPeriod } from '../ports/finding'
import type { InvoiceReading } from './duplicate-invoice'

/**
 * What one detection run over one document produces, and how its findings are
 * dated.
 *
 * Shared by every detector rather than copied into each, because the month rule
 * is a *key* — `finding_identity` is `(finding_type, subject_id, period)` — and
 * two detectors computing a period two ways would file the same month under two
 * ranges. Story 1.6 exists because one vendor became two vendors that way.
 */

export interface DetectionOutcome {
  /** Findings this run put on the register for the first time. */
  readonly raised: number
  /** Findings that were already there and had their evidence amended. */
  readonly amended: number
  /** How many invoices were compared, whether or not anything was found. */
  readonly invoicesChecked: number
}

/** `YYYY-MM` for the month a finding is filed under. */
export function monthOf(invoice: InvoiceReading): string {
  // The invoice's own date when it has one. When it does not, the month the
  // document arrived — FR-6's fuzzy rule names no date, so requiring one would
  // narrow the criterion, and "when this was noticed" is an honest answer for a
  // window the invoice refuses to state.
  return (invoice.issuedOn ?? invoice.documentUploadedAt).slice(0, 7)
}

/**
 * The month as a half-open range, `[first, first-of-next)`.
 *
 * Arithmetic on the string, never through a `Date`: `new Date('2026-03-01')` is
 * midnight UTC, and formatting it west of Greenwich gives February — a March
 * finding filed under the wrong month in the column it is keyed on.
 */
export function monthRange(month: string): FindingPeriod {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(5, 7))
  const nextYear = index === 12 ? year + 1 : year
  const nextIndex = index === 12 ? 1 : index + 1

  return {
    from: `${month}-01`,
    until: `${String(nextYear).padStart(4, '0')}-${String(nextIndex).padStart(2, '0')}-01`,
  }
}
