import { parseCsv } from './csv'
import type { ExtractionRecord } from './record'
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

/** Present or absent; a file without them is still within contract. */
export const OPTIONAL_HEADERS = ['reference', 'type'] as const

/** A tabular upload with no `type` column is a bank statement, which is what the pilot ingests. */
const DEFAULT_DOCUMENT_KIND = 'statement'

export const TABULAR_PROBLEMS = [
  'unreadable-file',
  'missing-headers',
  'duplicate-headers',
  'no-rows',
  'invalid-row',
] as const

export type TabularProblem = (typeof TABULAR_PROBLEMS)[number]

export interface TableProblem {
  readonly reason: TabularProblem
  /** 1-based index among the data rows, so a treasurer can find it in the file. */
  readonly row?: number
  readonly expected?: readonly string[]
}

export type TableResult =
  | { readonly ok: true; readonly records: readonly ExtractionRecord[] }
  | { readonly ok: false; readonly problems: readonly TableProblem[] }

const normalise = (header: string): string => header.trim().toLowerCase()

export function readTable(text: string): TableResult {
  const parsed = parseCsv(text)
  if (!parsed.ok) {
    // The CSV problem is not restated as a contract problem: the file was never
    // a table, so it has no headers to be missing.
    return { ok: false, problems: [{ reason: 'unreadable-file' }] }
  }

  const [headerRow, ...dataRows] = parsed.rows
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

  const records: ExtractionRecord[] = []
  const problems: TableProblem[] = []

  dataRows.forEach((row, index) => {
    const candidate = {
      documentKind: optional(row, 'type') ?? DEFAULT_DOCUMENT_KIND,
      vendorName: required(row, 'description'),
      documentNumber: optional(row, 'reference'),
      issuedOn: required(row, 'date'),
      totalAmount: required(row, 'amount'),
      currency: 'USD',
    }

    const validation = validate(candidate)
    if (validation.ok) {
      records.push(validation.record)
    } else {
      problems.push({ reason: 'invalid-row', row: index + 1 })
    }
  })

  // One bad row fails the document. Storing the other 199 is precisely how "no
  // partial or best-effort record is stored" gets violated in practice, and a
  // ledger missing one line without saying so is worse than one that was
  // refused outright.
  if (problems.length > 0) return { ok: false, problems }

  return { ok: true, records }
}
