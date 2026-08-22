/**
 * Bytes and a content type into the rectangle both readers work on.
 *
 * ## Why this exists rather than a second copy of the dispatch
 *
 * `ingest` already decided how a CSV and a workbook become rows. Story 5.3
 * needs the same decision for a *sample* — the same file types, decoded the
 * same way — but must not go through `ingest`, which stores the document,
 * hashes it for AD-13 idempotency, writes provenance and resolves vendors. **A
 * sample is not a document the association is keeping.**
 *
 * Left as two copies, the content-type list drifts: a format accepted for
 * ingestion but missing from the sample path is one a treasurer can upload and
 * then cannot build a mapping for, with nothing saying why. So the dispatch is
 * one function and both callers use it.
 */

import { describe, expect, it, vi } from 'vitest'

import type { WorkbookDecoder } from '../ports/workbook-decoder'
import { TABULAR_CONTENT_TYPES, toRectangle } from './rectangle'

const CSV = 'date,description,amount\n2026-01-01,Landscaping,1450.00'

const workbookYielding = (rows: readonly (readonly string[])[]): WorkbookDecoder => ({
  decode: vi.fn(() => ({ ok: true as const, rows })),
})

const brokenWorkbook: WorkbookDecoder = { decode: vi.fn(() => ({ ok: false as const })) }

describe('turning an uploaded file into rows', () => {
  it('reads a CSV into its rectangle, header row included', () => {
    const result = toRectangle('text/csv', new TextEncoder().encode(CSV))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toEqual([
      ['date', 'description', 'amount'],
      ['2026-01-01', 'Landscaping', '1450.00'],
    ])
  })

  it.each([
    ['xls', 'application/vnd.ms-excel'],
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ])('reads a %s workbook through the decoder it is given', (_label, contentType) => {
    const rows = [['date', 'amount'], ['2026-01-01', '10.00']]
    const result = toRectangle(contentType, new Uint8Array([1, 2]), workbookYielding(rows))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toEqual(rows)
  })

  /**
   * The distinction `ingest` already draws and must keep drawing: a type with
   * no reader is *held* for a human, while a file that would not decode is
   * refused. Collapsing them would turn "we cannot read PDFs yet" into "your
   * file is corrupt".
   */
  it('reports a type it has no reader for, rather than calling the file unreadable', () => {
    const result = toRectangle('application/pdf', new Uint8Array([1]))

    expect(result).toEqual({ ok: false, reason: 'no-reader' })
  })

  it('reports no reader when a workbook arrives and no decoder was supplied', () => {
    const contentType = 'application/vnd.ms-excel'

    expect(toRectangle(contentType, new Uint8Array([1]))).toEqual({ ok: false, reason: 'no-reader' })
  })

  it('reports a workbook the decoder refuses as unreadable, not as unsupported', () => {
    const result = toRectangle('application/vnd.ms-excel', new Uint8Array([1]), brokenWorkbook)

    expect(result).toEqual({ ok: false, reason: 'unreadable-file' })
  })

  /**
   * `parseCsv` distinguishes empty from malformed, and that distinction has to
   * survive: a treasurer told "could not be read" about an empty file will
   * re-export a file that exported perfectly well.
   */
  it.each([
    ['a file with no content at all', ''],
    ['a file of whitespace', '   \n  '],
  ])('reports %s as empty rather than unreadable', (_label, text) => {
    const result = toRectangle('text/csv', new TextEncoder().encode(text))

    expect(result).toEqual({ ok: false, reason: 'empty-file' })
  })

  it('reports bytes that are not a table as unreadable', () => {
    // An unterminated quote: `parseCsv` refuses it, and the file was never a
    // table, so it has no headers to be missing.
    const result = toRectangle('text/csv', new TextEncoder().encode('date,"unclosed\n1'))

    expect(result).toEqual({ ok: false, reason: 'unreadable-file' })
  })

  /**
   * The list is exported so neither caller can hold its own copy. Asserted
   * against the literal set rather than against itself, or it would pass
   * against an empty list.
   */
  it('publishes exactly the types it can turn into rows', () => {
    expect(new Set(TABULAR_CONTENT_TYPES)).toEqual(
      new Set([
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ]),
    )
  })

  it('reads every type it publishes, so the list is not a claim it cannot honour', () => {
    // Said out loud because a loop over an empty list passes: with no published
    // types this case would report success while checking nothing.
    expect(TABULAR_CONTENT_TYPES.length).toBeGreaterThan(0)

    for (const contentType of TABULAR_CONTENT_TYPES) {
      const bytes =
        contentType === 'text/csv' ? new TextEncoder().encode(CSV) : new Uint8Array([1, 2])
      const result = toRectangle(contentType, bytes, workbookYielding([['date']]))

      expect(result.ok, `${contentType} is published but not read`).toBe(true)
    }
  })
})
