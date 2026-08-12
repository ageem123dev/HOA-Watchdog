import { describe, expect, it } from 'vitest'

import { accessLogCsv, cell, COLUMNS } from './access-log-csv'
import type { QueryLogRecord } from '../ports/query-log-reader'

/**
 * The export, and the reason it needs its own module.
 *
 * This file is built from text people outside the board influenced — a unit
 * number a member typed, a year they asked about — and it lands in Excel on a
 * treasurer's laptop, where a cell beginning `=` is a formula rather than text.
 *
 * The tests that matter here are the planted payloads, not the happy path.
 */

const RECORD: QueryLogRecord = {
  id: '018f-1',
  actorId: 'user-7',
  executedAt: new Date('2026-08-12T01:00:00.000Z'),
  entryId: 'dues_status',
  entryVersion: 1,
  parameters: { unitNumber: '4B', assessmentYear: 2026 },
  sqlText: 'select 1',
}

describe('formula injection', () => {
  it.each(['=cmd|\'/c calc\'!A1', '+1+1', '-1+1', '@SUM(A1)'])(
    'neutralises a cell beginning %s',
    (payload) => {
      // Each of these is executed on open by a spreadsheet. Quoting alone does
      // not help: the spreadsheet strips the quotes and then reads the formula.
      const rendered = cell(payload)

      expect(rendered.startsWith('"\t')).toBe(true)
      expect(rendered).toContain(payload)
    },
  )

  it('neutralises a payload arriving inside the bound parameters', () => {
    // The realistic path, and the reason this is not hypothetical: `parameters`
    // records what somebody asked for. Serialised JSON happens to begin with
    // `{`, so this asserts the value survives rather than that it is prefixed —
    // the point is that the payload cannot reach a cell *unprefixed*.
    const csv = accessLogCsv([
      { ...RECORD, parameters: { unitNumber: '=cmd|\'/c calc\'!A1' } },
    ])

    // Nowhere does a bare formula start a cell: every `=` in the file is
    // preceded by a tab or sits inside a longer value.
    expect(csv).not.toMatch(/(^|,)"=/)
    expect(csv).toContain('cmd')
  })

  it.each([
    [' =cmd|\'/c calc\'!A1', 'a leading space'],
    ['\t=cmd|\'/c calc\'!A1', 'a leading tab'],
    ['\r=cmd|\'/c calc\'!A1', 'a leading carriage return'],
    ['\n=cmd|\'/c calc\'!A1', 'a leading newline'],
    ['   +1+1', 'several leading spaces'],
  ])('neutralises a payload hidden behind %s', (payload) => {
    // The first version of this checked `charAt(0)` and let every one of these
    // through: an ordinary character comes first, so nothing was prefixed, while
    // a spreadsheet discards the whitespace and reads the formula underneath.
    // Raised by Argus.
    expect(cell(payload).startsWith('"\t')).toBe(true)
  })

  it('preserves the value exactly, whitespace and all', () => {
    // The check trims; the value must not. This is an audit trail, and a defence
    // that quietly edited what somebody typed would be its own falsification.
    expect(cell(' =1+1')).toBe('"\t =1+1"')
  })

  it('leaves an ordinary value alone', () => {
    // The positive control. A neutraliser that prefixed everything would pass
    // every test above and produce a file full of stray tabs.
    expect(cell('4B')).toBe('"4B"')
  })
})

describe('the shape of the file', () => {
  it('starts with a header naming every column', () => {
    const csv = accessLogCsv([])

    expect(csv.split('\r\n')[0]).toBe(COLUMNS.map((c) => `"${c}"`).join(','))
  })

  it('writes one row per record, after the header', () => {
    const csv = accessLogCsv([RECORD, { ...RECORD, id: '018f-2' }])

    expect(csv.split('\r\n')).toHaveLength(3)
  })

  it('uses CRLF, which is what RFC 4180 and Excel expect', () => {
    // A lone LF is read as one enormous row by some versions of Excel.
    expect(accessLogCsv([RECORD])).toContain('\r\n')
  })

  it('escapes a quote by doubling it, so a value cannot end its own cell', () => {
    expect(cell('say "hello"')).toBe('"say ""hello"""')
  })

  it('escapes a comma and a newline by keeping them inside the quotes', () => {
    // Un-quoted, either one silently turns one row into two or one cell into
    // two — and in an audit trail that is a record that reads differently from
    // what happened.
    expect(cell('a,b')).toBe('"a,b"')
    expect(cell('a\nb')).toBe('"a\nb"')
  })

  it('renders the timestamp in a form that sorts and travels', () => {
    // ISO 8601, so the column sorts as text and carries its timezone. A locale
    // string would sort wrongly and could be read as a different date abroad.
    expect(cell(RECORD.executedAt)).toBe('"2026-08-12T01:00:00.000Z"')
  })

  it('serialises the bound parameters rather than rendering [object Object]', () => {
    expect(cell(RECORD.parameters)).toContain('"unitNumber"')
  })

  it('writes an empty cell for a missing value', () => {
    expect(cell(null)).toBe('""')
    expect(cell(undefined)).toBe('""')
  })
})
