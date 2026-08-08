import {
  AMOUNT_PATTERN,
  DOCUMENT_NUMBER_MAX_LENGTH,
  UNIT_REFERENCE_MAX_LENGTH,
  type ExtractionRecord,
  VENDOR_NAME_MAX_LENGTH,
  isDocumentKind,
  isSupportedCurrency,
} from './record'

/**
 * Whether a candidate may become a record.
 *
 * The bias is **refusal over repair**. A validator that strips a currency
 * symbol, truncates an over-long name, or rounds a third decimal place produces
 * a record that looks clean and says something the document did not — and on an
 * association's ledger nobody goes looking for that later. Refusing is loud;
 * quietly altering a figure is not.
 *
 * Two coercions are allowed, and only because neither can change a meaning:
 * surrounding whitespace on a text field, and the case of a currency code.
 * Everything else is accepted as written or refused.
 *
 * Pure by design rather than by convenience: a function with nothing to write to
 * cannot leave a partial record behind, so "no partial or best-effort record is
 * stored" holds by construction instead of by a cleanup path.
 */

export const PROBLEM_REASONS = [
  'missing',
  'wrong-type',
  'unknown-value',
  'blank',
  'too-long',
  'malformed',
] as const

export type ProblemReason = (typeof PROBLEM_REASONS)[number]

export interface RecordProblem {
  readonly field: string
  readonly reason: ProblemReason
}

export type Validation =
  | { readonly ok: true; readonly record: ExtractionRecord }
  | { readonly ok: false; readonly problems: readonly RecordProblem[] }

/**
 * FR-3 requires a structured "Document Unreadable" error and, unlike FR-1,
 * dictates no wording.
 *
 * Deliberately not FR-1's sentence: that one is about a file that would not
 * open, this one about a file that opened and could not be read into figures.
 * The next step differs — an unlocked copy versus a clearer scan or a different
 * export — so the words differ too.
 */
export const UNREADABLE_MESSAGE =
  'This document opened, but its figures could not be read reliably. ' +
  'Upload a clearer scan, or export it as a spreadsheet.'

/** `numeric(14,2)` leaves twelve digits ahead of the point. */

/**
 * A decimal amount as written: no thousands separators, no currency symbol, no
 * exponent, anchored at both ends so nothing may trail.
 *
 * The decimal places are capped here because they cannot be capped anywhere
 * else. `numeric(14,2)` *rounds* rather than errors, so a third place becomes a
 * cent the document never stated — and no database constraint can see it,
 * because the column has already coerced the value before any constraint runs.
 */
const AMOUNT = new RegExp(AMOUNT_PATTERN)

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

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

function checkText(
  value: unknown,
  field: string,
  maxLength: number,
  problems: RecordProblem[],
): string | null {
  if (value === null || value === undefined) return null

  if (typeof value !== 'string') {
    problems.push({ field, reason: 'wrong-type' })
    return null
  }

  const trimmed = value.trim()

  if (trimmed === '') {
    // Not converted to null. `null` means "this document has no vendor", and a
    // failed parse silently wearing that value would be indistinguishable from
    // the truth.
    problems.push({ field, reason: 'blank' })
    return null
  }

  if (trimmed.length > maxLength) {
    // Refused, not truncated: a truncated name is a different vendor than the
    // document names, stored in a way that reads as a successful extraction.
    problems.push({ field, reason: 'too-long' })
    return null
  }

  return trimmed
}

export function validate(candidate: unknown): Validation {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return { ok: false, problems: [{ field: 'record', reason: 'wrong-type' }] }
  }

  const source = candidate as Record<string, unknown>
  const problems: RecordProblem[] = []

  const documentKind = source.documentKind
  if (documentKind === undefined || documentKind === null) {
    problems.push({ field: 'documentKind', reason: 'missing' })
  } else if (!isDocumentKind(documentKind)) {
    problems.push({ field: 'documentKind', reason: 'unknown-value' })
  }

  const vendorName = checkText(source.vendorName, 'vendorName', VENDOR_NAME_MAX_LENGTH, problems)
  const documentNumber = checkText(
    source.documentNumber,
    'documentNumber',
    DOCUMENT_NUMBER_MAX_LENGTH,
    problems,
  )
  const unitReference = checkText(
    source.unitReference,
    'unitReference',
    UNIT_REFERENCE_MAX_LENGTH,
    problems,
  )

  let issuedOn: string | null = null
  const rawDate = source.issuedOn
  if (rawDate !== null && rawDate !== undefined) {
    if (typeof rawDate !== 'string') {
      problems.push({ field: 'issuedOn', reason: 'wrong-type' })
    } else if (!isRealDate(rawDate)) {
      problems.push({ field: 'issuedOn', reason: 'malformed' })
    } else {
      issuedOn = rawDate
    }
  }

  let totalAmount: string | null = null
  const rawAmount = source.totalAmount
  if (rawAmount !== null && rawAmount !== undefined) {
    if (typeof rawAmount !== 'string') {
      // A number has already lost precision by the time it arrives. Accepting
      // one means trusting a figure that was rounded before validation ran.
      problems.push({ field: 'totalAmount', reason: 'wrong-type' })
    } else if (!AMOUNT.test(rawAmount)) {
      problems.push({ field: 'totalAmount', reason: 'malformed' })
    } else {
      totalAmount = rawAmount
    }
  }

  const rawCurrency = source.currency
  const currency = typeof rawCurrency === 'string' ? rawCurrency.toUpperCase() : rawCurrency
  if (currency === undefined || currency === null) {
    problems.push({ field: 'currency', reason: 'missing' })
  } else if (!isSupportedCurrency(currency)) {
    problems.push({ field: 'currency', reason: 'unknown-value' })
  }

  if (problems.length > 0) return { ok: false, problems }

  return {
    ok: true,
    record: {
      documentKind: documentKind as ExtractionRecord['documentKind'],
      vendorName,
      documentNumber,
      issuedOn,
      totalAmount,
      unitReference,
      currency: currency as ExtractionRecord['currency'],
    },
  }
}
