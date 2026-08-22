/**
 * An uploaded sample, in; the headings it has, out (story 5.3, AC1 and Task 4).
 *
 * ## What this composes, and what it deliberately is not
 *
 * `toRectangle` decodes; `readHeadings` reports. This is the join, taking the
 * shape an upload actually arrives in — a filename, a content type, some bytes.
 *
 * **It is not `ingest`, and that is the decision Task 4 exists to record.**
 * `ingest` stores the document, hashes it for AD-13 idempotency, writes
 * provenance and resolves vendors. A sample is uploaded so a treasurer can be
 * shown its columns; it is not a document the association is keeping, and one
 * landing in `document` would be a file in the permanent record that nobody
 * asked to keep.
 *
 * It also cannot be `ingest`: story 5.2 made a declared `documentKind`
 * mandatory for ingestion, and a sample has none. The mapping is what the kind
 * is *for*.
 */

import { describe, expect, it, vi } from 'vitest'

import type { WorkbookDecoder } from '../ports/workbook-decoder'
import { readSampleHeadings } from './sample-headings'

const csv = (text: string) => ({
  filename: 'sample.csv',
  contentType: 'text/csv',
  bytes: new TextEncoder().encode(text),
})

const workbookYielding = (rows: readonly (readonly string[])[]): WorkbookDecoder => ({
  decode: vi.fn(() => ({ ok: true as const, rows })),
})

describe('reading the headings of an uploaded sample', () => {
  it('returns the headings of a CSV sample', () => {
    const result = readSampleHeadings(csv('date,description,amount\n2026-01-01,Landscaping,10.00'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.headings.map((h) => h.text)).toEqual(['date', 'description', 'amount'])
    expect(result.problems).toEqual([])
  })

  it('returns the headings of a workbook sample, through the decoder it is given', () => {
    const result = readSampleHeadings(
      { filename: 's.xlsx', contentType: 'application/vnd.ms-excel', bytes: new Uint8Array([1]) },
      { workbooks: workbookYielding([['date', 'amount']]) },
    )

    expect(result.ok && result.headings.map((h) => h.text)).toEqual(['date', 'amount'])
  })

  /**
   * The reporting half survives the composition. A sample with problems still
   * yields its headings — this is the property `readHeadings` exists for, and
   * a join that dropped it would make the whole story pointless.
   */
  it('carries the problems through, alongside the headings', () => {
    const result = readSampleHeadings(csv('amount,,amount\n1,2,3'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.headings).toHaveLength(3)
    expect(result.problems).toEqual([
      { reason: 'duplicate-heading', heading: 'amount', positions: [1, 3] },
      { reason: 'blank-heading', positions: [2] },
    ])
  })

  /**
   * **What a browser actually sends.** `acceptance.ts` has canonicalised
   * content types since story 1.x, with the comment "Browsers send
   * `text/csv; charset=utf-8` and vary the case" — and `ingest` passes the
   * already-canonical value, so `toRectangle` never met a raw one until this
   * story added a second caller.
   *
   * A sample arrives straight from a form. Unnormalised, every CSV a browser
   * labels with a charset would come back `no-reader`: "we cannot read this
   * format", about the format the wizard exists to read. Raised by CodeRabbit.
   */
  it.each([
    ['a charset parameter', 'text/csv; charset=utf-8'],
    ['no space before the parameter', 'text/csv;charset=utf-8'],
    ['upper case', 'TEXT/CSV'],
    ['surrounding space', '  text/csv  '],
  ])('reads a CSV sample whose content type carries %s', (_label, contentType) => {
    const result = readSampleHeadings({
      filename: 'sample.csv',
      contentType,
      bytes: new TextEncoder().encode('date,amount\n2026-01-01,10.00'),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.headings.map((h) => h.text)).toEqual(['date', 'amount'])
  })

  it('reads a workbook sample whose content type carries a parameter', () => {
    const result = readSampleHeadings(
      {
        filename: 's.xls',
        contentType: 'application/vnd.ms-excel; charset=binary',
        bytes: new Uint8Array([1]),
      },
      { workbooks: workbookYielding([['date']]) },
    )

    expect(result.ok && result.headings).toHaveLength(1)
  })

  it.each([
    ['a type nothing reads', 'application/pdf', 'no-reader'],
    ['a workbook with no decoder supplied', 'application/vnd.ms-excel', 'no-reader'],
  ])('refuses %s, saying which', (_label, contentType, reason) => {
    const result = readSampleHeadings({ filename: 'f', contentType, bytes: new Uint8Array([1]) })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe(reason)
  })

  it('refuses bytes that are not a table as unreadable', () => {
    const result = readSampleHeadings(csv('date,"unclosed\n1'))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unreadable-file')
  })

  /**
   * The empty cases travel too, rather than being flattened into
   * `unreadable-file`. A treasurer whose file decoded perfectly and has no
   * headings needs a different sentence from one whose file would not decode.
   */
  it.each([
    ['an empty file', '', 'no-rows'],
    ['a file whose headings are all blank', ',,\n1,2,3', 'no-headings'],
  ])('refuses %s with its own reason', (_label, text, reason) => {
    const result = readSampleHeadings(csv(text))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe(reason)
  })

  /**
   * The property the whole decision rests on: a sample is read without anything
   * being stored.
   *
   * The first version of this asserted `readSampleHeadings.length <= 2`, which
   * proves nothing — `Function.length` counts parameters *before* the first
   * default, so it reads 1 here and would keep reading 1 however many
   * dependencies were added after `deps`. A vacuous assertion written while
   * trying to prevent vacuity. Raised by CodeRabbit.
   *
   * What is observable instead: the call succeeds given nothing but a file.
   * There is no store to inject and no kind to declare, so a version that
   * needed either could not pass this.
   */
  it('reads a sample given nothing but the file itself', () => {
    const result = readSampleHeadings(csv('date,amount\n1,2'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.headings.map((h) => h.text)).toEqual(['date', 'amount'])
  })
})
