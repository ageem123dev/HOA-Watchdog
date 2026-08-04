/**
 * CSV text into a rectangle of strings, per RFC 4180.
 *
 * Hand-rolled rather than delegated, because the point of the tabular path is
 * that nothing surprising is involved: this is a character loop with a defined
 * output for every input, and it adds no dependency to the code that reads
 * untrusted uploads.
 *
 * The cases worth the effort are the ones a naive `split(',')` gets *wrong*
 * rather than fails on — a comma inside a quoted vendor name, a newline inside a
 * quoted address, the byte-order mark Excel writes at the front of every UTF-8
 * CSV it saves. Each turns a correct file into a wrong figure, which is worse
 * than an error because nothing reports it.
 */

export const CSV_PROBLEMS = [
  'empty',
  'unterminated-quote',
  'text-after-quote',
  'ragged-rows',
] as const

export type CsvProblem = (typeof CSV_PROBLEMS)[number]

export type CsvResult =
  | { readonly ok: true; readonly rows: readonly (readonly string[])[] }
  | { readonly ok: false; readonly reason: CsvProblem }

const QUOTE = '"'
const DELIMITER = ','
const BOM = '﻿'
const LINE_FEED = '\n'
const CARRIAGE_RETURN = '\r'

const isLineEnding = (character: string | undefined): boolean =>
  character === LINE_FEED || character === CARRIAGE_RETURN

export function parseCsv(text: string): CsvResult {
  const source = text.startsWith(BOM) ? text.slice(BOM.length) : text

  if (source.trim() === '') return { ok: false, reason: 'empty' }

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  // Set when a quoted field closes, so the next character can be checked. A
  // quoted field may be followed only by a delimiter, a line ending, or the end
  // of input — without this, `"ACME"x` silently becomes the field `ACMEx`, which
  // then validates cleanly while saying something the file does not.
  let justClosedQuote = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]

    if (inQuotes) {
      if (character === QUOTE) {
        // A doubled quote is one literal quote; a lone one closes the field.
        if (source[index + 1] === QUOTE) {
          field += QUOTE
          index += 1
        } else {
          inQuotes = false
          justClosedQuote = true
        }
      } else {
        field += character
      }
      continue
    }

    if (justClosedQuote) {
      if (character !== DELIMITER && !isLineEnding(character)) {
        return { ok: false, reason: 'text-after-quote' }
      }
      justClosedQuote = false
    }

    if (character === QUOTE && field === '') {
      // Only opens a quoted field at the start of one. A quote partway through
      // an unquoted field is a literal inch mark: `12" pipe`.
      inQuotes = true
      continue
    }

    if (character === DELIMITER) {
      row.push(field)
      field = ''
      continue
    }

    if (isLineEnding(character)) {
      // Consume CRLF as a single ending. Treated as two, every field in the
      // last column of an Excel-on-Windows export keeps a carriage return.
      if (character === CARRIAGE_RETURN && source[index + 1] === LINE_FEED) index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }

    field += character
  }

  if (inQuotes) return { ok: false, reason: 'unterminated-quote' }

  // A trailing newline leaves nothing pending; anything else is a final row
  // that simply had no newline after it.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  if (rows.length === 0) return { ok: false, reason: 'empty' }

  // A row of a different width means a column has shifted, and a shifted column
  // is a wrong figure rather than a missing one.
  const width = rows[0]!.length
  if (rows.some((candidate) => candidate.length !== width)) {
    return { ok: false, reason: 'ragged-rows' }
  }

  return { ok: true, rows }
}

/** The inverse of `parseCsv`, used by the round-trip tests. */
export function serialiseCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) =>
      row
        .map((field) =>
          /["\r\n,]/.test(field)
            ? `${QUOTE}${field.split(QUOTE).join(QUOTE + QUOTE)}${QUOTE}`
            : field,
        )
        .join(DELIMITER),
    )
    .join(LINE_FEED)
}
