/**
 * A workbook into the same rectangle of strings the CSV parser produces.
 *
 * The fixtures are written by SheetJS itself rather than committed as binary
 * blobs, so every test reads a real `.xlsx` and the round trip is genuine.
 *
 * The failure this file cares most about is money. A numeric cell is a double in
 * the file format, and asking the library for "the text" returns whatever Excel
 * was displaying — `$1,450.00` for a currency-formatted cell, which the
 * validator rightly refuses. Reading the presentation instead of the value would
 * report a correct spreadsheet as unreadable.
 */

import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'

import { readWorkbook } from './workbook-sheetjs'

type Cell = string | number | Date | null

/** A real .xlsx in memory, optionally with a number format applied to a column. */
function workbook(rows: Cell[][], options: { numberFormat?: string; sheets?: string[] } = {}) {
  const book = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: true })

  if (options.numberFormat) {
    for (const address of Object.keys(sheet)) {
      if (address.startsWith('!')) continue
      const cell = sheet[address] as XLSX.CellObject
      if (cell.t === 'n') cell.z = options.numberFormat
    }
  }

  for (const name of options.sheets ?? ['Sheet1']) {
    XLSX.utils.book_append_sheet(book, name === 'Sheet1' ? sheet : XLSX.utils.aoa_to_sheet([['other']]), name)
  }

  return new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
}

const rowsOf = (bytes: Uint8Array) => {
  const result = readWorkbook(bytes)
  if (!result.ok) throw new Error(`expected rows, got ${result.reason}`)
  return result.rows
}

describe('readWorkbook', () => {
  describe('the ordinary case', () => {
    it('reads a header and its rows as strings', () => {
      const bytes = workbook([
        ['date', 'description', 'amount'],
        ['2026-06-01', 'Landscaping', '1450.00'],
      ])

      expect(rowsOf(bytes)).toEqual([
        ['date', 'description', 'amount'],
        ['2026-06-01', 'Landscaping', '1450.00'],
      ])
    })

    it('pads a short row so a missing cell cannot shift the columns after it', () => {
      const bytes = workbook([['a', 'b', 'c'], ['1']])

      expect(rowsOf(bytes)[1]).toHaveLength(3)
    })
  })

  describe('money', () => {
    it('reads the value of a numeric cell, not its display format', () => {
      // The cell holds 1450.5 and Excel is told to show it as $1,450.50. The
      // record must carry the value; the presentation is Excel's opinion.
      const bytes = workbook(
        [
          ['amount'],
          [1450.5],
        ],
        { numberFormat: '"$"#,##0.00' },
      )

      const value = rowsOf(bytes)[1]?.[0]

      expect(value).toBe('1450.5')
      expect(value).not.toContain('$')
      expect(value).not.toContain(',')
    })

    it('reads a whole-number amount without a spurious decimal part', () => {
      expect(rowsOf(workbook([['amount'], [1450]]))[1]?.[0]).toBe('1450')
    })

    it('reads a negative amount as a credit', () => {
      expect(rowsOf(workbook([['amount'], [-250.25]]))[1]?.[0]).toBe('-250.25')
    })
  })

  describe('dates', () => {
    it('reads a real date cell as an ISO calendar date', () => {
      // Left alone this arrives as the Excel serial 46174, which would reach
      // the record as a five-digit number where a date belongs.
      const bytes = workbook([['date'], [new Date(Date.UTC(2026, 5, 1))]])

      expect(rowsOf(bytes)[1]?.[0]).toBe('2026-06-01')
    })

    it('leaves a text date alone', () => {
      expect(rowsOf(workbook([['date'], ['2026-06-01']]))[1]?.[0]).toBe('2026-06-01')
    })
  })

  describe('what it refuses', () => {
    it.each([
      ['bytes that are not a workbook', new Uint8Array([0x4d, 0x5a, 0x90, 0x00])],
      ['empty bytes', new Uint8Array(0)],
      ['a truncated file', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])],
    ])('refuses %s without throwing', (_label, bytes) => {
      expect(() => readWorkbook(bytes)).not.toThrow()
      expect(readWorkbook(bytes).ok).toBe(false)
    })

    it('refuses a workbook whose first sheet has no rows', () => {
      expect(readWorkbook(workbook([])).ok).toBe(false)
    })
  })

  describe('multiple sheets', () => {
    it('reads the first sheet, which is the documented pilot behaviour', () => {
      const bytes = workbook([['date', 'description', 'amount']], {
        sheets: ['Sheet1', 'Cover'],
      })

      expect(rowsOf(bytes)[0]).toEqual(['date', 'description', 'amount'])
    })
  })

  describe('formulas', () => {
    it('reads a formula cell by its cached value rather than evaluating it', () => {
      const book = XLSX.utils.book_new()
      const sheet = XLSX.utils.aoa_to_sheet([['amount'], [0]])
      sheet.A2 = { t: 'n', v: 1450.5, f: 'SUM(B1:B9)' } as XLSX.CellObject
      XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')
      const bytes = new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))

      expect(rowsOf(bytes)[1]?.[0]).toBe('1450.5')
    })
  })

  describe('round trip', () => {
    it('returns what SheetJS was given, for a realistic table', () => {
      const table = [
        ['date', 'description', 'amount', 'reference'],
        ['2026-06-01', 'Evergreen Landscaping', '1450.00', 'INV-4471'],
        ['2026-06-02', 'Bay Area Pool Service', '-250.00', ''],
      ]

      expect(rowsOf(workbook(table))).toEqual(table)
    })
  })
})
