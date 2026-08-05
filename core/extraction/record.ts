/**
 * The vocabulary of an extracted record.
 *
 * One definition, published for both halves of extraction: the deterministic
 * parser and, later, the provider adapter. Whatever produced a record, it is
 * this shape, and these are the values it may carry.
 *
 * Everything here has a counterpart in `migrations/006_extraction.sql`, and a
 * test compares the two by reading that file. The drift being prevented is not
 * cosmetic — a value accepted here and refused by the database fails at INSERT,
 * after the document's bytes are already in object storage.
 */

/** Frozen so a caller cannot widen what the application accepts past what the database will store. */
export const DOCUMENT_KINDS = Object.freeze([
  'invoice',
  'statement',
  'assessment_roll',
  'other',
] as const)

export const SUPPORTED_CURRENCIES = Object.freeze(['USD'] as const)

export type DocumentKind = (typeof DOCUMENT_KINDS)[number]
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

export const VENDOR_NAME_MAX_LENGTH = 200
export const DOCUMENT_NUMBER_MAX_LENGTH = 64

/** `numeric(14,2)` — twelve digits ahead of the point, two behind. */
export const AMOUNT_PRECISION = 14
export const AMOUNT_SCALE = 2

/**
 * The one statement of what a `totalAmount` may look like.
 *
 * It lived in three places before: the validator's regex, the extraction
 * schema sent to the provider, and the connectivity probe. Two were written by
 * hand and one of those was **wrong** — a template literal swallowed every
 * backslash, so the schema the provider received read `^-?d{1,12}(.d{1,2})?$`,
 * which rejects `1450.00` and accepts `d.d`. It went unnoticed because the test
 * asserted the pattern *contained* "12".
 *
 * A plain string, not a `RegExp`, because it has to travel to the provider as
 * JSON as well as compile locally. Anything needing to match calls
 * `new RegExp(AMOUNT_PATTERN)`.
 */
export const AMOUNT_PATTERN = `^-?\\d{1,${AMOUNT_PRECISION - AMOUNT_SCALE}}(\\.\\d{1,${AMOUNT_SCALE}})?$`

/**
 * What a document was read to say.
 *
 * `totalAmount` is a **decimal string**, never a number. A binary float cannot
 * represent 0.10, and this is an association's ledger — the value travels as
 * text from the parser to the `numeric` column without ever passing through a
 * representation that would round it.
 *
 * Most fields are nullable because most documents genuinely lack them: a
 * statement has no vendor. A null means "this document does not have one" — it
 * never means the parser was unsure. Uncertainty is not expressible here, and
 * deliberately so.
 */
export interface ExtractionRecord {
  readonly documentKind: DocumentKind
  readonly vendorName: string | null
  readonly documentNumber: string | null
  /** ISO 8601 calendar date, `YYYY-MM-DD`. */
  readonly issuedOn: string | null
  readonly totalAmount: string | null
  readonly currency: SupportedCurrency
}

/**
 * Membership tested against the list, not by indexing an object.
 *
 * `'toString' in someObject` is true, so an object-keyed lookup accepts every
 * inherited property name as a valid member. `core/auth/sign-in-feedback.ts`
 * carries the same note for the same reason.
 */
export function isDocumentKind(value: unknown): value is DocumentKind {
  return typeof value === 'string' && (DOCUMENT_KINDS as readonly string[]).includes(value)
}

export function isSupportedCurrency(value: unknown): value is SupportedCurrency {
  return typeof value === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(value)
}
