import { normaliseUnitNumber } from '../unit/normalised-number'
import { parseCsv } from './csv'
import { normaliseHeading } from './headings'
import {
  KINDS_WITH_UNIT_REFERENCE,
  isDocumentKind,
  type DocumentKind,
  type ExtractionRecord,
} from './record'
import { ROLL_HEADERS, ROLL_REQUIRED_HEADERS, readRollRow, type RollRow } from './roll'
import { validate } from './validate'

/**
 * A tabular upload into candidate records, against a declared contract.
 *
 * The contract exists because "parsed deterministically" needs a defined input
 * and nothing upstream defined one. It is the pilot's contract, matching the
 * PRD's stated use — bank feeds exported by hand — rather than a universal one,
 * so a refusal has to name what was expected. A treasurer whose export is turned
 * away needs to know what to export instead.
 *
 * No model is reachable from here, by construction: this module imports a CSV
 * parser, a record type and a validator, and nothing else.
 */

/** Matched case-insensitively after trimming; neither carries information. */
export const REQUIRED_HEADERS = ['date', 'description', 'amount'] as const

/**
 * Present or absent; a file without them is still within contract.
 *
 * `unit` is its own column and deliberately not a second meaning for
 * `reference`. `reference` is the transaction reference and lands in
 * `documentNumber`; a deposit line commonly carries both, and a column whose
 * meaning depends on the value of a sibling cell is a rule nobody can read off
 * the header row.
 */
export const OPTIONAL_HEADERS = ['reference', 'unit', ...ROLL_HEADERS] as const

/**
 * `type` was one of these until story 5.2, read per row and defaulting to
 * `statement`. The kind is now declared by the upload.
 *
 * **Kept as a name so it can be refused rather than ignored.** A file exported
 * against the old contract still has the column, and dropping it silently would
 * tell a treasurer their `type,deposit` row worked when the upload said
 * `statement`. The same argument refused a body `actorId` in story 5.1c and an
 * `associationId` in 5.1b: a caller that says something is answered, never
 * quietly overruled.
 */
const RETIRED_HEADERS = ['type'] as const

export const TABULAR_PROBLEMS = [
  'unreadable-file',
  'missing-headers',
  'duplicate-headers',
  'no-rows',
  'invalid-row',
  /**
   * Two roll rows for one unit and one year.
   *
   * Its own reason rather than `invalid-row`, because neither row is defective —
   * the pair is. `assessment_one_per_unit_year` would refuse the second and
   * abort the transaction the whole roll is written in, so catching it here
   * turns a failed upload into a sentence naming the unit.
   */
  'duplicate-unit',
  /**
   * The upload declared a kind this contract does not publish, or declared
   * none. Refused before the file is read: reading it first would report every
   * row as defective, which names the wrong thing.
   */
  'unknown-kind',
  /** The file carries a `type` column, which stopped being a column in 5.2. */
  'kind-is-not-a-column',
] as const

export type TabularProblem = (typeof TABULAR_PROBLEMS)[number]

export interface TableProblem {
  readonly reason: TabularProblem
  /** 1-based index among the data rows, so a treasurer can find it in the file. */
  readonly row?: number
  readonly expected?: readonly string[]
}

export type TableResult =
  | {
      readonly ok: true
      readonly records: readonly ExtractionRecord[]
      /**
       * The roll rows this document stated, empty for every other kind.
       *
       * Carried beside the records rather than instead of them: a roll is still
       * a document that said something, and `extraction` still records what it
       * said. These are the additional facts only a roll carries — who holds the
       * unit, from when, and what it owes for the year on what cadence.
       */
      readonly rollRows: readonly RollRow[]
    }
  | { readonly ok: false; readonly problems: readonly TableProblem[] }

// One folding, shared with `readHeadings` — see `normaliseHeading`.
const normalise = normaliseHeading

export function readTable(text: string, documentKind: DocumentKind): TableResult {
  const parsed = parseCsv(text)
  if (!parsed.ok) {
    // The CSV problem is not restated as a contract problem: the file was never
    // a table, so it has no headers to be missing.
    return { ok: false, problems: [{ reason: 'unreadable-file' }] }
  }

  return readRows(parsed.rows, documentKind)
}

/**
 * The contract applied to an already-decoded rectangle.
 *
 * Split out so a spreadsheet and a CSV meet exactly the same rules: the vendor
 * library that decodes a workbook lives in an adapter, and what it produces is
 * the same rectangle `parseCsv` produces.
 */
export function readRows(
  rows: readonly (readonly string[])[],
  documentKind: DocumentKind,
): TableResult {
  // **Checked first, and there is no default.** A missing declaration used to
  // mean `statement`, which is the per-row rule relocated: the file still
  // decides, by omission, and a mapping still cannot say what it is *for*.
  // Validated at runtime as well as in the type, because the value crosses a
  // form submission on its way here.
  if (!isDocumentKind(documentKind)) {
    return { ok: false, problems: [{ reason: 'unknown-kind' }] }
  }

  const [headerRow, ...dataRows] = rows
  const headers = (headerRow ?? []).map(normalise)

  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index)
  if (duplicates.length > 0) {
    // Taking the first or the last is how a figure arrives from the wrong
    // column with nothing to show it happened.
    return { ok: false, problems: [{ reason: 'duplicate-headers' }] }
  }

  const retired = RETIRED_HEADERS.filter((header) => headers.includes(header))
  if (retired.length > 0) {
    return { ok: false, problems: [{ reason: 'kind-is-not-a-column', expected: retired }] }
  }

  const missing = REQUIRED_HEADERS.filter((required) => !headers.includes(required))
  if (missing.length > 0) {
    return {
      ok: false,
      problems: [{ reason: 'missing-headers', expected: [...REQUIRED_HEADERS] }],
    }
  }

  if (dataRows.length === 0) {
    // A file of headers alone produced no figures. Storing nothing and calling
    // it success would tell a treasurer their upload worked.
    return { ok: false, problems: [{ reason: 'no-rows' }] }
  }

  const cell = (row: readonly string[], header: string): string | undefined =>
    row[headers.indexOf(header)]

  /**
   * A required column is passed through as written, blank included.
   *
   * Treating a blank cell in a required column as absent would re-create the
   * distinction the validator exists to keep: a row whose description is empty
   * is a defective row, not a document that has no vendor. The validator refuses
   * it; this must not quietly convert it into something valid first.
   */
  const required = (row: readonly string[], header: string): string =>
    cell(row, header) ?? ''

  /** An optional column that is absent or blank is genuinely absent. */
  const optional = (row: readonly string[], header: string): string | null => {
    const value = cell(row, header)
    return value === undefined || value.trim() === '' ? null : value
  }

  // The roll's two columns are required only of a document that *is* a roll,
  // which is why this is not part of REQUIRED_HEADERS. Checked before any row is
  // read, so a roll exported without them says which columns are missing rather
  // than reporting every one of its rows as defective.
  //
  // This asked the rows until story 5.2 (`dataRows.some(...)`), which meant a
  // file's own contents decided what was demanded of it.
  if (documentKind === 'assessment_roll') {
    const missingRollHeaders = ROLL_REQUIRED_HEADERS.filter((header) => !headers.includes(header))

    if (missingRollHeaders.length > 0) {
      // The ones actually absent, not the whole list. A roll exported with
      // `cycle` but no `year` was being told to add both. Raised by review.
      return {
        ok: false,
        problems: [{ reason: 'missing-headers', expected: missingRollHeaders }],
      }
    }
  }

  const records: ExtractionRecord[] = []
  const rollRows: RollRow[] = []
  const problems: TableProblem[] = []

  /**
   * One roll row per unit per year, keyed the way the database keys it.
   *
   * Folded with `normaliseUnitNumber`, which mirrors `unit_normalised_number()`
   * exactly — **not** with `fold` from the payment path. `fold` collapses
   * JavaScript's whitespace class, which matches U+3000 while migration 011's
   * character set does not, so it merged two unit numbers the database stores
   * separately and refused a roll Postgres would have accepted. Raised by
   * review. Keyed on the year as well, because
   * `assessment_one_per_unit_year` is on the pair: one unit may legitimately
   * appear on rolls for two years in one file.
   */
  const seenUnitYears = new Set<string>()

  dataRows.forEach((row, index) => {
    // Read for the kinds that are about a unit, because `validate` refuses
    // `unitReference` on every other kind — and one invalid row fails the whole
    // document here. Reading it unconditionally would turn a stray `unit` column
    // on an invoice export into a refusal of the entire upload.
    //
    // Ignored rather than refused, which is the choice worth naming: a unit
    // means nothing on an invoice, and turning a column nobody asked about
    // into a rejection helps no treasurer.
    const unitReference = (KINDS_WITH_UNIT_REFERENCE as readonly string[]).includes(documentKind)
      ? optional(row, 'unit')
      : null

    const candidate = {
      documentKind,
      vendorName: required(row, 'description'),
      documentNumber: optional(row, 'reference'),
      issuedOn: required(row, 'date'),
      totalAmount: required(row, 'amount'),
      currency: 'USD',
      unitReference,
    }

    const validation = validate(candidate)
    if (validation.ok) {
      records.push(validation.record)
    } else {
      problems.push({ reason: 'invalid-row', row: index + 1 })
    }

    if (documentKind !== 'assessment_roll') return

    // Built from the same cells, and deliberately not from the record above: the
    // record has already dropped the cycle and the year, and it has trimmed the
    // holder's name into `vendorName`, which is the field a roll must never
    // travel in.
    const roll = readRollRow({
      unitNumber: unitReference,
      holderName: required(row, 'description'),
      heldFrom: required(row, 'date'),
      annualAmount: required(row, 'amount'),
      cycle: optional(row, 'cycle'),
      year: optional(row, 'year'),
    })

    if (!roll.ok) {
      // Not reported twice. `validate` catches most of what makes a roll row
      // defective, and a treasurer told the same row is wrong for two reasons
      // has to work out that it is one fault.
      if (validation.ok) problems.push({ reason: 'invalid-row', row: index + 1 })
      return
    }

    const key = `${normaliseUnitNumber(roll.row.unitNumber)}::${roll.row.assessmentYear}`

    if (seenUnitYears.has(key)) {
      problems.push({ reason: 'duplicate-unit', row: index + 1 })
      return
    }

    seenUnitYears.add(key)
    rollRows.push(roll.row)
  })

  // One bad row fails the document. Storing the other 199 is precisely how "no
  // partial or best-effort record is stored" gets violated in practice, and a
  // ledger missing one line without saying so is worse than one that was
  // refused outright.
  if (problems.length > 0) return { ok: false, problems }

  return { ok: true, records, rollRows }
}
