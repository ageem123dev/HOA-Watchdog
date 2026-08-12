import type { QueryLogRecord } from '../ports/query-log-reader'

/**
 * The access log as a CSV a treasurer can open (story 3.8, UX-DR16).
 *
 * ## Formula injection is the reason this is a module and not a template string
 *
 * The destination is Excel or Numbers on a board member's laptop, and a cell
 * beginning `=`, `+`, `-` or `@` is a **formula**, not text. Spreadsheets have
 * executed those on open for decades, and `=cmd|'/c calc'!A1` is the standard
 * demonstration.
 *
 * That matters here more than in most exports, because this file is built from
 * text people outside the board influenced. `parameters` holds the values bound
 * into a query — a unit number a member typed, a year they asked about — and the
 * whole point of the audit trail is that it records what *other people* did.
 * Quoting alone does not help: a spreadsheet strips the quotes and then reads
 * the formula.
 *
 * So a leading formula character is prefixed with a tab, which spreadsheets
 * treat as text and which a reader does not see as a stray quote mark.
 */

/** What a spreadsheet reads as the start of a formula. */
const FORMULA_LEADERS = new Set(['=', '+', '-', '@'])

/**
 * One CSV cell: neutralised, then quoted.
 *
 * The order matters. Neutralising after quoting would put the tab outside the
 * quotes, where it is a delimiter rather than part of the value.
 */
export function cell(value: unknown): string {
  const text = stringify(value)
  // A tab, not an apostrophe. The apostrophe trick is more common and it is
  // worse: Excel hides it but LibreOffice and every plain-text reader show a
  // stray quote in front of every affected value, and this is a document people
  // read as a record.
  const safe = FORMULA_LEADERS.has(text.charAt(0)) ? `\t${text}` : text

  return `"${safe.replaceAll('"', '""')}"`
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)

  return String(value)
}

/** The header row, which is also the column order. */
export const COLUMNS = [
  'id',
  'executedAt',
  'actorId',
  'entryId',
  'entryVersion',
  'parameters',
  'sqlText',
] as const

/**
 * The whole file.
 *
 * CRLF line endings, because that is what RFC 4180 specifies and what Excel
 * expects; a lone LF is read as one enormous row by some versions.
 */
export function accessLogCsv(records: readonly QueryLogRecord[]): string {
  const header = COLUMNS.map((column) => cell(column)).join(',')
  const rows = records.map((record) =>
    [
      record.id,
      record.executedAt,
      record.actorId,
      record.entryId,
      record.entryVersion,
      record.parameters,
      record.sqlText,
    ]
      .map((value) => cell(value))
      .join(','),
  )

  return [header, ...rows].join('\r\n')
}
