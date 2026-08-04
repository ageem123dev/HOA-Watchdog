import * as XLSX from 'xlsx'

/**
 * A workbook into the same rectangle of strings the CSV parser produces.
 *
 * This is an adapter because SheetJS is a vendor library and `core/` imports
 * nothing outward. Everything above this file sees a rectangle, which is also
 * what lets the tabular contract treat a spreadsheet and a CSV identically.
 *
 * **Values are read, never presentations.** A numeric cell in a workbook is a
 * number with a display format attached, and asking the library for the cell's
 * text returns what Excel was showing — `$1,450.00` for a currency-formatted
 * cell, which the validator refuses on sight. Reading the format instead of the
 * value would report a perfectly correct spreadsheet as unreadable, so each cell
 * type is converted explicitly below.
 */

export const WORKBOOK_PROBLEMS = ['unreadable-file', 'no-sheets', 'no-rows'] as const

export type WorkbookProblem = (typeof WORKBOOK_PROBLEMS)[number]

export type WorkbookResult =
  | { readonly ok: true; readonly rows: readonly (readonly string[])[] }
  | { readonly ok: false; readonly reason: WorkbookProblem }

/** `Date` → `YYYY-MM-DD`, the only date shape the record vocabulary accepts. */
function isoDate(value: Date): string {
  return [
    String(value.getUTCFullYear()).padStart(4, '0'),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

/**
 * One cell as text.
 *
 * `String(number)` is exact for every value this pipeline admits: JavaScript
 * prints the shortest representation that round-trips, and the record's twelve
 * integer digits sit well inside what a double represents precisely. A value
 * carrying more than two decimals still arrives faithfully and is refused later
 * by the validator, which is the intended outcome.
 */
function asText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return isoDate(value)
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return String(value)
  return String(value)
}

/**
 * `.xlsx` is a ZIP; `.xls` is an OLE compound file. Nothing else is a workbook.
 *
 * Checked here rather than left to the library. SheetJS sniffs formats and falls
 * back to text parsers, so it reads the four bytes of a renamed executable as a
 * one-cell sheet rather than refusing them — verified, not assumed. Gating on
 * the container keeps those fallbacks away from arbitrary uploaded bytes.
 *
 * The upload gate in `core/ingestion/acceptance.ts` checks the same signatures
 * against the declared media type. This is the second lock, at the point where
 * bytes actually meet a parser.
 */
const CONTAINERS: readonly (readonly number[])[] = [
  [0x50, 0x4b, 0x03, 0x04], // ZIP — .xlsx
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], // OLE compound file — .xls
]

function isWorkbookContainer(bytes: Uint8Array): boolean {
  return CONTAINERS.some(
    (signature) =>
      bytes.length >= signature.length &&
      signature.every((byte, index) => bytes[index] === byte),
  )
}

/**
 * The width of the widest row.
 *
 * A reduce rather than `Math.max(...rows.map(...))`: spreading turns every row
 * into a function argument, and the argument list overflows well below the row
 * count a real spreadsheet can hold. Exported so the overflow can be tested
 * against a large array instead of a large workbook.
 */
export function widestRow(rows: readonly (readonly unknown[])[]): number {
  let widest = 0
  for (const row of rows) if (row.length > widest) widest = row.length
  return widest
}

export function readWorkbook(bytes: Uint8Array): WorkbookResult {
  if (!isWorkbookContainer(bytes)) return { ok: false, reason: 'unreadable-file' }

  let book: XLSX.WorkBook

  try {
    book = XLSX.read(bytes, {
      type: 'array',
      // Real dates rather than the Excel serial number, which would otherwise
      // reach the record as a five-digit integer where a date belongs.
      cellDates: true,
      // Formulas are not carried or evaluated. Cached values are what a
      // spreadsheet last computed, and this code parses untrusted uploads.
      cellFormula: false,
      cellHTML: false,
    })
  } catch {
    // Anything that is not a workbook — a renamed executable, a truncated
    // download — is an outcome, not an exception for the caller to handle.
    return { ok: false, reason: 'unreadable-file' }
  }

  const firstSheet = book.SheetNames[0]
  if (firstSheet === undefined) return { ok: false, reason: 'no-sheets' }

  const sheet = book.Sheets[firstSheet]
  if (sheet === undefined) return { ok: false, reason: 'no-sheets' }

  // The first sheet, deliberately. Refusing multi-sheet workbooks would refuse
  // the many real exports that carry a cover sheet; the limitation is recorded
  // rather than hidden.
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  })

  if (raw.length === 0) return { ok: false, reason: 'no-rows' }

  // Pad to a consistent width. A short row would otherwise shift every column
  // after it, and a shifted column is a wrong figure rather than a missing one.
  const width = widestRow(raw)
  const rows = raw.map((row) =>
    Array.from({ length: width }, (_, column) => asText(row[column])),
  )

  return { ok: true, rows }
}
