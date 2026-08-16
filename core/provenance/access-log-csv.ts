import { cell } from '../csv/cell'
import type { QueryLogRecord } from '../ports/query-log-reader'

/**
 * The access log as a CSV a treasurer can open (story 3.8, UX-DR16).
 *
 * ## The escaping lives in `core/csv/cell.ts`
 *
 * It was written here for story 3.8 and paid for twice in review — the
 * full-width formula characters, then leading whitespace. Story 4.7 needed the
 * same neutralisation for the register's export, and two copies of it would be
 * two answers to "is this cell dangerous", only one of which stays correct. So
 * it moved, and this file is now what it always described itself as: the
 * *shape* of the access log, not the escaping.
 */

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
