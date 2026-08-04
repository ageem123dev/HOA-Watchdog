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

import { MAX_WORKBOOK_CELLS, readWorkbook, widestRow } from './workbook-sheetjs'

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

  describe('large workbooks', () => {
    it('measures row width without spreading every row into an argument list', () => {
      // The defect this pins: `Math.max(...rows.map(r => r.length))` throws
      // RangeError once the argument list is long enough, and it sat outside
      // the try/catch — so a workbook well inside the 25 MiB upload limit
      // crashed the caller instead of returning a refusal. An Excel sheet holds
      // over a million rows.
      //
      // Tested through the extracted helper rather than a real workbook of this
      // size: writing one would cost seconds and hundreds of megabytes for a
      // property that has nothing to do with the file format.
      const rows = Array.from({ length: 300_000 }, () => [1, 2, 3])

      expect(() => widestRow(rows)).not.toThrow()
      expect(widestRow(rows)).toBe(3)
    })

    it('reads a workbook with several thousand rows end to end', () => {
      const rows: Cell[][] = [['amount']]
      for (let i = 0; i < 5_000; i += 1) rows.push([i])

      const result = readWorkbook(workbook(rows))

      expect(result.ok && result.rows).toHaveLength(5_001)
    }, 60_000)
  })

  describe('a workbook larger than this pipeline will materialise', () => {
    // Story 1.5b is what first makes this reachable: the decoder is now called
    // from an upload. The 25 MiB byte limit bounds the *compressed* file, and a
    // spreadsheet is a ZIP — a small upload can expand into an enormous sheet.
    // Each row also becomes one INSERT, so an unbounded sheet is an unbounded
    // transaction as well.
    it('refuses it rather than materialising every cell', () => {
      const rows = Math.ceil(MAX_WORKBOOK_CELLS / 4) + 10
      const sheet = XLSX.utils.aoa_to_sheet([
        ['date', 'description', 'amount', 'reference'],
        ...Array.from({ length: rows }, (_, i) => ['2026-06-01', 'x', 1, String(i)]),
      ])
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')

      const result = readWorkbook(new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })))

      expect(result).toMatchObject({ ok: false, reason: 'too-many-cells' })
    }, 60_000)

    it('accepts one just inside the bound, so the limit is not merely a refusal', () => {
      // Without this the cap could be zero and the test above would still pass.
      const rows = Math.floor(MAX_WORKBOOK_CELLS / 4) - 10
      const sheet = XLSX.utils.aoa_to_sheet([
        ['date', 'description', 'amount', 'reference'],
        ...Array.from({ length: rows }, () => ['2026-06-01', 'x', 1, 'r']),
      ])
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')

      const result = readWorkbook(new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })))

      expect(result.ok).toBe(true)
    }, 60_000)

    it('refuses on the declared range, before the sheet is materialised', () => {
      // The discriminating case. `sheet_to_json` is what builds the array, so a
      // cap applied to its output has already paid for the allocation it exists
      // to prevent. Here the sheet *declares* an enormous range while holding
      // almost no cells: with `blankrows: false` the converted array is tiny, so
      // the post-conversion guard cannot fire and only a preflight on `!ref`
      // catches it.
      const sheet: XLSX.WorkSheet = {
        '!ref': 'A1:Z400000',
        A1: { t: 's', v: 'date' },
        B1: { t: 's', v: 'description' },
        C1: { t: 's', v: 'amount' },
      }
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')

      const result = readWorkbook(new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })))

      expect(result).toMatchObject({ ok: false, reason: 'too-many-cells' })
    }, 60_000)

    it('has a bound big enough for a real association ledger', () => {
      // A guard nobody can hit is a guard that refuses real work. Twelve years
      // of monthly rows across six columns is well inside it.
      expect(MAX_WORKBOOK_CELLS).toBeGreaterThan(12 * 12 * 6)
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
