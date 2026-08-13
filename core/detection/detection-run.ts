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
  /**
   * How many subjects were compared, whether or not anything was found.
   *
   * *Subjects*, not invoices. Story 4.4 added a detector whose subject is a
   * unit, and a shared field named `invoicesChecked` holding a count of units
   * is the kind of quiet lie this codebase keeps finding in review. The
   * evidence key inside each finding keeps its own detector-specific name —
   * that one is stored JSON which stories 4.5 and 4.8 read back, and renaming
   * it would rewrite the meaning of findings already raised.
   */
  readonly subjectsChecked: number
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

/**
 * A whole assessment year as a half-open range, `[Jan 1, next Jan 1)`.
 *
 * Story 4.4's period. Here rather than in the dues detector for the reason the
 * month rule is here: a period is half of a finding's identity, and two
 * detectors spelling a year two ways would file the same year under two keys.
 *
 * Padded to four digits, as `monthRange` is. `999-01-01` sorts before every
 * sensible date and Postgres accepts it as a year, so the padding is what stops
 * a short year quietly becoming a different period.
 */
export function yearRange(year: number): FindingPeriod {
  // Four digits, and the range migration 013 already constrains an assessment
  // year to. `Number.isSafeInteger` alone let `-100` and `99999` through:
  // `padStart` does not truncate, so those became `-100-01-01` and
  // `99999-01-01` — a period key nobody would ever match again, built three
  // layers from whatever produced the number. A fractional year yields
  // `2026.5-01-01`, which is not a date at all. Raised by CodeRabbit.
  if (!Number.isSafeInteger(year) || year < 1900 || year > 2200) {
    throw new RangeError(`not a calendar year: ${String(year)}`)
  }

  return {
    from: `${String(year).padStart(4, '0')}-01-01`,
    until: `${String(year + 1).padStart(4, '0')}-01-01`,
  }
}
