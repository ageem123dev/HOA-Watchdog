import { fold } from '../payment/resolve-line'
import { parseCsv } from './csv'
import { KINDS_WITH_UNIT_REFERENCE, type ExtractionRecord } from './record'
import { ROLL_HEADERS, readRollRow, type RollRow } from './roll'
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
export const OPTIONAL_HEADERS = ['reference', 'type', 'unit', ...ROLL_HEADERS] as const

/** A tabular upload with no `type` column is a bank statement, which is what the pilot ingests. */
const DEFAULT_DOCUMENT_KIND = 'statement'

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
] as const

export type TabularProblem = (typeof TABULAR_PROBLEMS)[number]

export interface TableProblem {
  readonly reason: TabularProblem
  /** 1-based index among the data rows, so a treasurer can find it in the file. */
  readonly row?: number
  readonly expected?: readonly string[]
  /** The unit two roll rows disagreed about, as the document spelled it. */
  readonly unit?: string
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

const normalise = (header: string): string => header.trim().toLowerCase()

export function readTable(text: string): TableResult {
  const parsed = parseCsv(text)
  if (!parsed.ok) {
    // The CSV problem is not restated as a contract problem: the file was never
    // a table, so it has no headers to be missing.
    return { ok: false, problems: [{ reason: 'unreadable-file' }] }
  }

  return readRows(parsed.rows)
}

/**
 * The contract applied to an already-decoded rectangle.
 *
 * Split out so a spreadsheet and a CSV meet exactly the same rules: the vendor
 * library that decodes a workbook lives in an adapter, and what it produces is
 * the same rectangle `parseCsv` produces.
 */
export function readRows(rows: readonly (readonly string[])[]): TableResult {
  const [headerRow, ...dataRows] = rows
  const headers = (headerRow ?? []).map(normalise)

  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index)
  if (duplicates.length > 0) {
    // Taking the first or the last is how a figure arrives from the wrong
    // column with nothing to show it happened.
    return { ok: false, problems: [{ reason: 'duplicate-headers' }] }
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

  const kindOf = (row: readonly string[]): string =>
    optional(row, 'type') ?? DEFAULT_DOCUMENT_KIND

  // The roll's two columns are required only of a document that has roll rows,
  // which is why this is not part of REQUIRED_HEADERS. Checked before any row is
  // read, so a roll exported without them says which columns are missing rather
  // than reporting every one of its rows as defective.
  if (dataRows.some((row) => kindOf(row) === 'assessment_roll')) {
    const missingRollHeaders = ROLL_HEADERS.filter((header) => !headers.includes(header))

    if (missingRollHeaders.length > 0) {
      return {
        ok: false,
        problems: [{ reason: 'missing-headers', expected: [...ROLL_HEADERS] }],
      }
    }
  }

  const records: ExtractionRecord[] = []
  const rollRows: RollRow[] = []
  const problems: TableProblem[] = []

  /**
   * One roll row per unit per year, keyed the way the database keys it.
   *
   * Folded with core's `fold` — the same folding migration 011 applies to
   * `unit_number` — so `4B` and `4b  ` collide here exactly as the unique index
   * makes them collide there. Keyed on the year as well, because
   * `assessment_one_per_unit_year` is on the pair: one unit may legitimately
   * appear on rolls for two years in one file.
   */
  const seenUnitYears = new Map<string, string>()

  dataRows.forEach((row, index) => {
    const documentKind = kindOf(row)

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

    const key = `${fold(roll.row.unitNumber)}::${roll.row.assessmentYear}`
    const already = seenUnitYears.get(key)

    if (already !== undefined) {
      problems.push({ reason: 'duplicate-unit', row: index + 1, unit: already })
      return
    }

    seenUnitYears.set(key, roll.row.unitNumber)
    rollRows.push(roll.row)
  })

  // One bad row fails the document. Storing the other 199 is precisely how "no
  // partial or best-effort record is stored" gets violated in practice, and a
  // ledger missing one line without saying so is worse than one that was
  // refused outright.
  if (problems.length > 0) return { ok: false, problems }

  return { ok: true, records, rollRows }
}
