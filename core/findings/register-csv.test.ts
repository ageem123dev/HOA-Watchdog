/**
 * The register as a CSV an auditor opens (AC5).
 *
 * The escaping is `core/csv/cell.ts`'s and is tested there. What is asserted
 * here is what this *file* is: which columns, in what order, carrying which
 * values — and that the columns a board member reads on screen are the ones
 * they get in the file.
 */

import { describe, expect, it } from 'vitest'

import type { FindingDetail } from '@/core/ports/finding-reader'
import { REGISTER_COLUMNS, registerCsv } from './register-csv'

function finding(overrides: Partial<FindingDetail> = {}): FindingDetail {
  return {
    id: '018f3a2b-4c5d-7e8f-9a0b-1c2d3e4f5a6b',
    findingType: 'possible_duplicate_invoice',
    subjectId: 'document-1',
    period: { from: '2026-04-01', until: '2026-05-01' },
    evidence: {
      invoicesChecked: 3,
      pairs: [{ reason: 'same-amount-and-date', vendorName: 'Coastal Landscaping', amount: '1450.00' }],
    },
    raisedOn: '2026-04-14',
    reviewed: { by: 'R. Mbeki', on: '2026-04-20' },
    ...overrides,
  }
}

/** The file split back into rows and cells, quotes removed. */
function parse(csv: string): string[][] {
  return csv
    .split('\r\n')
    .map((line) => line.split('","').map((value) => value.replace(/^"|"$/g, '')))
}

describe('the shape of the file', () => {
  it('opens with a header row naming every column', () => {
    const [header] = parse(registerCsv([finding()]))

    expect(header).toEqual([...REGISTER_COLUMNS])
  })

  it('writes one row per finding, after the header', () => {
    const rows = parse(registerCsv([finding(), finding({ id: 'second' })]))

    expect(rows).toHaveLength(3)
  })

  it('is still a valid file when the register is empty', () => {
    // A header and nothing else. An auditor handed a zero-byte file cannot tell
    // it from a failed download.
    const rows = parse(registerCsv([]))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual([...REGISTER_COLUMNS])
  })

  it('separates rows with CRLF, which is what Excel expects', () => {
    // A lone LF is read as one enormous row by some versions.
    expect(registerCsv([finding()])).toContain('\r\n')
  })
})

describe('what each row carries', () => {
  const rowOf = (record: FindingDetail) => parse(registerCsv([record]))[1] ?? []
  const columnOf = (record: FindingDetail, name: (typeof REGISTER_COLUMNS)[number]) =>
    rowOf(record)[REGISTER_COLUMNS.indexOf(name)]

  it('carries the finding id, so a row can be traced back', () => {
    expect(columnOf(finding(), 'id')).toBe('018f3a2b-4c5d-7e8f-9a0b-1c2d3e4f5a6b')
  })

  it('carries the title a board member read on screen', () => {
    // The same copy, not a second wording. An auditor comparing the export
    // against the page must not find two descriptions of one finding.
    expect(columnOf(finding(), 'finding')).toBe('Possible duplicate invoice — Coastal Landscaping')
  })

  it('carries the evidence sentence', () => {
    expect(columnOf(finding(), 'evidence')).toMatch(/1 of 3 invoices/)
  })

  it('carries the amount as the surface formatted it', () => {
    expect(columnOf(finding(), 'amount')).toBe('$1,450.00')
  })

  it('carries the dates the finding was raised and reviewed', () => {
    expect(columnOf(finding(), 'noticed')).toBe('2026-04-14')
    expect(columnOf(finding(), 'reviewed')).toBe('2026-04-20')
  })

  it('names the reviewer', () => {
    expect(columnOf(finding(), 'reviewedBy')).toBe('R. Mbeki')
  })

  it('leaves the reviewer empty rather than inventing one', () => {
    const record = finding({ reviewed: { by: null, on: '2026-04-20' } })

    expect(columnOf(record, 'reviewedBy')).toBe('')
    expect(columnOf(record, 'reviewed')).toBe('2026-04-20')
  })

  it('leaves an absent amount empty rather than writing a zero', () => {
    // `$0.00` in a board packet is a figure somebody could act on, made up from
    // a record that holds none. The rule the dashboard row set.
    const record = finding({ evidence: { invoicesChecked: 3, pairs: [] } })

    expect(columnOf(record, 'amount')).toBe('')
  })

  it('carries the period the finding concerns', () => {
    expect(columnOf(finding(), 'period')).toBe('2026-04-01 to 2026-04-30')
  })
})

describe('AC5: the file is safe to open in a spreadsheet', () => {
  // **Which cell can actually start with hostile text?** Not the title: it
  // always opens with a fixed phrase, and an unrecognised finding type is
  // constrained by `finding_type_is_verb_noun` to `^[a-z][a-z0-9_]*$`. Not the
  // evidence line, which opens with a count. The reviewer's display name is the
  // one column whose first character is a person's to choose — which is exactly
  // why it is the one asserted.
  //
  // Written after the first version of these tests targeted a vendor name and
  // found it *correctly* unescaped, because it sits mid-title where a
  // spreadsheet reads nothing.

  it('neutralises a reviewer name that would be read as a formula', () => {
    const record = finding({ reviewed: { by: '=cmd|calc', on: '2026-04-20' } })

    expect(registerCsv([record])).toContain('\t=cmd|calc')
  })

  it('neutralises one hidden behind leading whitespace', () => {
    // A leading space makes the first character ordinary, and spreadsheets
    // discard it and read the formula underneath.
    const record = finding({ reviewed: { by: ' =cmd|calc', on: '2026-04-20' } })

    expect(registerCsv([record])).toContain('\t =cmd|calc')
  })

  it('neutralises the full-width form an IME produces', () => {
    const record = finding({ reviewed: { by: '＝cmd|calc', on: '2026-04-20' } })

    expect(registerCsv([record])).toContain('\t＝cmd|calc')
  })

  it('quotes a value containing a comma, so it stays one cell', () => {
    const record = finding({
      evidence: {
        invoicesChecked: 1,
        pairs: [
          { reason: 'same-amount-and-date', vendorName: 'Coastal, Harbour & Co', amount: '1.00' },
        ],
      },
    })

    expect(parse(registerCsv([record]))[1]?.[REGISTER_COLUMNS.indexOf('finding')]).toContain(
      'Coastal, Harbour & Co',
    )
  })
})
