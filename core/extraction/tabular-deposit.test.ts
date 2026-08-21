/**
 * The unit a deposit line names, read off a spreadsheet.
 *
 * Story 2.4 added `unitReference` to the record and taught `validate` to accept
 * it on a deposit and refuse it anywhere else. It did not teach anything to
 * *produce* one — so the field was null on every row a real upload ever made.
 * This is the producer for the format the pilot actually ingests.
 *
 * **A new `unit` column, not the existing `reference` one.** `reference` already
 * means the transaction reference and lands in `documentNumber`; a deposit can
 * carry both, and one column with two meanings depending on a sibling cell is
 * a decision nobody can read off the header row.
 */

import { describe, expect, it } from 'vitest'

import { OPTIONAL_HEADERS, readRows, readTable } from './tabular'

/** A deposit table, header row first. `type` is what makes it a deposit. */
const deposit = (rows: readonly (readonly string[])[]) => [
  ['date', 'description', 'amount', 'unit', 'reference'],
  ...rows,
]

const recordsOf = (result: ReturnType<typeof readRows>) => {
  if (!result.ok) throw new Error(`expected a readable table, got ${JSON.stringify(result.problems)}`)
  return result.records
}

describe('reading the unit off a deposit row', () => {
  it('carries the unit column into the record', () => {
    const records = recordsOf(
      readRows(deposit([['2026-03-01', 'March dues', '250.00', '4B', 'DEP-1']]), 'deposit'),
    )

    expect(records[0]!.unitReference).toBe('4B')
  })

  it('keeps the transaction reference and the unit apart', () => {
    // The whole reason for a new column. If `reference` were reused, this row
    // could not say both things, and `DEP-1` would be looked up as a unit.
    const records = recordsOf(
      readRows(deposit([['2026-03-01', 'March dues', '250.00', '4B', 'DEP-1']]), 'deposit'),
    )

    expect(records[0]!.unitReference).toBe('4B')
    expect(records[0]!.documentNumber).toBe('DEP-1')
  })

  it('reads a blank unit cell as absent rather than as an empty reference', () => {
    // `resolveLine` holds a blank reference as `missing-reference`, which is the
    // right outcome. It gets there from null just as well, and null is what the
    // column genuinely is.
    const records = recordsOf(
      readRows(deposit([['2026-03-01', 'March dues', '250.00', '   ', '']]), 'deposit'),
    )

    expect(records[0]!.unitReference).toBeNull()
  })

  it('reads a deposit with no unit column at all', () => {
    // Optional means optional: a bank export that names no units is still a
    // readable document whose lines will all be held.
    const result = readRows([
      ['date', 'description', 'amount'],
      ['2026-03-01', 'March dues', '250.00'],
    ],
    'deposit')

    expect(recordsOf(result)[0]!.unitReference).toBeNull()
  })

  it('does not attach a unit to a document that is not a deposit', () => {
    // `validate` refuses `unitReference` on any kind but `deposit`, so reading
    // this column unconditionally would turn a stray `unit` column into a
    // document-wide refusal — one bad row fails the whole table here.
    //
    // Ignored rather than refused: a unit means nothing on an invoice, and
    // rejecting the upload over a column nobody asked about helps no treasurer.
    const records = recordsOf(
      readRows(
        [
          ['date', 'description', 'amount', 'unit'],
          ['2026-03-01', 'Acme Plumbing', '250.00', '4B'],
        ],
        'invoice',
      ),
    )

    expect(records[0]!.unitReference).toBeNull()
    expect(records[0]!.documentKind).toBe('invoice')
  })

  it('reads the unit for every row, not only the first', () => {
    // Zero-one-many. A per-document variable assigned in a loop passes the
    // single-row cases above and puts the first unit on all three of these.
    const records = recordsOf(
      readRows(
        deposit([
          ['2026-03-01', 'March dues', '250.00', '4B', 'DEP-1'],
          ['2026-03-01', 'March dues', '250.00', '5C', 'DEP-2'],
          ['2026-03-02', 'March dues', '250.00', '', 'DEP-3'],
        ]),
        'deposit',
      ),
    )

    expect(records.map((record) => record.unitReference)).toEqual(['4B', '5C', null])
  })

  it('reads a whole deposit file, text in and records out', () => {
    // The fixture the task asks for, through `readTable` rather than
    // `readRows`: the parsing, the header matching and the record building are
    // all between a treasurer's file and the ledger, and testing only the last
    // of the three is how a story ships a producer nothing can reach.
    const csv = [
      'date,description,amount,unit,reference',
      '2026-03-01,March dues,250.00,4B,DEP-1',
      '2026-03-02,March dues,250.00,5C,DEP-2',
    ].join('\n')

    const records = recordsOf(readTable(csv, 'deposit'))

    expect(records).toHaveLength(2)
    expect(records.map((record) => record.unitReference)).toEqual(['4B', '5C'])
    expect(records.map((record) => record.documentKind)).toEqual(['deposit', 'deposit'])
    expect(records.map((record) => record.totalAmount)).toEqual(['250.00', '250.00'])
  })

  it('matches the unit header however it is capitalised or padded', () => {
    // Headers are normalised for every other column; a treasurer's export
    // writes `Unit`, and a column matched only in lower case is a column that
    // silently is not there.
    const csv = 'date,description,amount, Unit \n2026-03-01,March dues,250.00,4B'

    expect(recordsOf(readTable(csv, 'deposit'))[0]!.unitReference).toBe('4B')
  })

  it('declares unit as an optional header', () => {
    // Stated in one place. A column read by `readRows` but missing from this
    // list is a column no refusal message would ever mention.
    expect(OPTIONAL_HEADERS).toContain('unit')
  })
})
