/**
 * The acceptance gate — what gets in, and what a treasurer is told when it does not.
 *
 * Every rejection here is read by a volunteer at the moment their upload failed.
 * A wrong one is not a log line; it is a person told their valid document is
 * invalid, or told nothing useful about one that is. So the tests care as much
 * about the false rejections (a CSV with a charset parameter, a PDF whose text
 * contains the word Encrypt) as about the true ones.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ACCEPTED_CONTENT_TYPES,
  ACCEPTED_FORMAT_LABELS,
  MAX_DOCUMENT_BYTES,
  REJECTION_REASONS,
  assess,
} from './acceptance'

const PDF = 'application/pdf'
const CSV = 'text/csv'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const XLS = 'application/vnd.ms-excel'

const bytesOf = (...parts: Array<string | number[]>): Uint8Array => {
  const chunks = parts.map((part) =>
    typeof part === 'string' ? Array.from(new TextEncoder().encode(part)) : part,
  )
  return new Uint8Array(chunks.flat())
}

/** A minimal but structurally honest PDF: signature, a body, and a trailer. */
const pdfBytes = (body = 'content', trailer = 'trailer\n<< /Size 4 /Root 1 0 R >>\n%%EOF') =>
  bytesOf(`%PDF-1.7\n${body}\n${trailer}`)

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_MAGIC = [0xff, 0xd8, 0xff]
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

const pad = (bytes: number[], toLength: number): Uint8Array =>
  new Uint8Array([...bytes, ...new Array(Math.max(0, toLength - bytes.length)).fill(0x20)])

describe('assess', () => {
  describe('the ordinary case', () => {
    it('accepts a PDF within the limit', () => {
      expect(assess({ contentType: PDF, bytes: pdfBytes() })).toEqual({
        outcome: 'accepted',
        contentType: PDF,
      })
    })

    it.each([
      ['PNG', 'image/png', pad(PNG_MAGIC, 64)],
      ['JPEG', 'image/jpeg', pad(JPEG_MAGIC, 64)],
      ['XLS', XLS, pad(OLE_MAGIC, 64)],
      ['XLSX', XLSX, pad(ZIP_MAGIC, 64)],
    ])('accepts a %s within the limit', (_label, contentType, bytes) => {
      expect(assess({ contentType, bytes })).toMatchObject({ outcome: 'accepted' })
    })

    it('accepts a CSV, which has no container signature to check', () => {
      const bytes = bytesOf('date,description,amount\n2026-06-01,Landscaping,1450.00\n')

      expect(assess({ contentType: CSV, bytes })).toMatchObject({ outcome: 'accepted' })
    })

    it('reports the accepted content type, so the caller never re-derives it', () => {
      const result = assess({ contentType: 'APPLICATION/PDF', bytes: pdfBytes() })

      expect(result).toEqual({ outcome: 'accepted', contentType: PDF })
    })
  })

  describe('the declared content type', () => {
    it.each([
      ['a charset parameter, which browsers send for CSV', 'text/csv; charset=utf-8'],
      ['surrounding whitespace', '  text/csv  '],
      ['upper case', 'TEXT/CSV'],
      ['mixed case with a parameter', 'Text/CSV; Charset=UTF-8'],
    ])('accepts a type carrying %s', (_label, contentType) => {
      const bytes = bytesOf('a,b\n1,2\n')

      expect(assess({ contentType, bytes })).toMatchObject({ outcome: 'accepted' })
    })

    it.each([
      ['an executable', 'application/x-msdownload'],
      ['a Word document', 'application/msword'],
      ['plain text, which is close but not on the list', 'text/plain'],
      ['an empty string', ''],
      ['a nonsense value', 'not-a-media-type'],
    ])('rejects %s as unsupported', (_label, contentType) => {
      expect(assess({ contentType, bytes: bytesOf('anything at all') })).toEqual({
        outcome: 'rejected',
        reason: 'unsupported-type',
      })
    })

    it('rejects an unsupported type before looking at the bytes at all', () => {
      // Type is the cheapest check and the one whose message is most actionable.
      // Running it first also means no unsupported file's bytes are ever scanned.
      const result = assess({ contentType: 'application/zip', bytes: new Uint8Array(0) })

      expect(result).toEqual({ outcome: 'rejected', reason: 'unsupported-type' })
    })
  })

  describe('the size limit', () => {
    const fill = (size: number): Uint8Array => {
      const bytes = new Uint8Array(size).fill(0x20)
      bytes.set(new TextEncoder().encode('%PDF-1.7\n'))
      return bytes
    }

    it('accepts a file one byte under the limit', () => {
      expect(assess({ contentType: PDF, bytes: fill(MAX_DOCUMENT_BYTES - 1) })).toMatchObject({
        outcome: 'accepted',
      })
    })

    it('accepts a file exactly at the limit, because the limit is inclusive', () => {
      expect(assess({ contentType: PDF, bytes: fill(MAX_DOCUMENT_BYTES) })).toMatchObject({
        outcome: 'accepted',
      })
    })

    it('rejects a file one byte over the limit', () => {
      expect(assess({ contentType: PDF, bytes: fill(MAX_DOCUMENT_BYTES + 1) })).toEqual({
        outcome: 'rejected',
        reason: 'too-large',
      })
    })

    it('rejects an empty file as empty, not as too large', () => {
      // 0 <= limit, so a size-only check lets this through to the database,
      // where document_byte_size_positive refuses it and the treasurer sees a
      // crash instead of a sentence.
      expect(assess({ contentType: PDF, bytes: new Uint8Array(0) })).toEqual({
        outcome: 'rejected',
        reason: 'empty',
      })
    })

    it('states a limit in whole mebibytes, so the message can quote a round number', () => {
      // `0 % anything === 0`, so the remainder alone passes for a limit of zero.
      expect(MAX_DOCUMENT_BYTES).toBeGreaterThan(0)
      expect(MAX_DOCUMENT_BYTES % (1024 * 1024)).toBe(0)
    })
  })

  describe('readability at the container level', () => {
    it('rejects a password-protected PDF', () => {
      const encrypted = pdfBytes(
        'stream data',
        'trailer\n<< /Size 4 /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF',
      )

      expect(assess({ contentType: PDF, bytes: encrypted })).toEqual({
        outcome: 'rejected',
        reason: 'unreadable',
      })
    })

    it('accepts a PDF whose body merely contains the word /Encrypt', () => {
      // The inverse of the test above, and the one that matters more: a false
      // "unreadable" refuses a document the board legitimately holds. The scan
      // is scoped to the trailer for exactly this reason.
      const body = `${'x'.repeat(4096)}(This policy describes how we /Encrypt member records)${'x'.repeat(4096)}`

      expect(assess({ contentType: PDF, bytes: pdfBytes(body) })).toMatchObject({
        outcome: 'accepted',
      })
    })

    it('rejects an executable renamed to look like a PDF', () => {
      const mz = pad([0x4d, 0x5a, 0x90, 0x00], 512)

      expect(assess({ contentType: PDF, bytes: mz })).toEqual({
        outcome: 'rejected',
        reason: 'unreadable',
      })
    })

    it('rejects an encrypted xlsx, which is an OLE container rather than a ZIP', () => {
      expect(assess({ contentType: XLSX, bytes: pad(OLE_MAGIC, 512) })).toEqual({
        outcome: 'rejected',
        reason: 'unreadable',
      })
    })

    it('rejects an xls whose bytes are actually a ZIP', () => {
      expect(assess({ contentType: XLS, bytes: pad(ZIP_MAGIC, 512) })).toEqual({
        outcome: 'rejected',
        reason: 'unreadable',
      })
    })

    it('rejects binary mislabelled as CSV', () => {
      // CSV has no signature, so the mismatch check has nothing to compare.
      // A NUL byte is the tell that this is not text at all.
      const bytes = bytesOf('date,amount\n', [0x00, 0x01, 0x02], 'garbage')

      expect(assess({ contentType: CSV, bytes })).toEqual({
        outcome: 'rejected',
        reason: 'unreadable',
      })
    })

    it.each([
      ['a 1-byte file', 1],
      ['a 3-byte file, shorter than the shortest signature', 3],
      ['a 4-byte file, shorter than the PDF signature', 4],
    ])('rejects %s as unreadable rather than reading past its end', (_label, size) => {
      const bytes = new Uint8Array(size).fill(0x25)

      expect(assess({ contentType: PDF, bytes })).toEqual({
        outcome: 'rejected',
        reason: 'unreadable',
      })
    })

    it('accepts a CSV of a single byte, since a one-cell file is still a file', () => {
      expect(assess({ contentType: CSV, bytes: bytesOf('1') })).toMatchObject({
        outcome: 'accepted',
      })
    })
  })

  describe('the shape of a rejection', () => {
    it.each([
      ['unsupported-type', { contentType: 'application/zip', bytes: bytesOf('PK') }],
      ['too-large', { contentType: CSV, bytes: new Uint8Array(MAX_DOCUMENT_BYTES + 1).fill(0x31) }],
      ['empty', { contentType: CSV, bytes: new Uint8Array(0) }],
      ['unreadable', { contentType: PDF, bytes: pad([0x4d, 0x5a], 512) }],
    ])('reports %s as a member of the closed set', (expected, candidate) => {
      const result = assess(candidate)

      expect(result.outcome).toBe('rejected')
      expect(REJECTION_REASONS).toContain(expected)
      expect(result).toEqual({ outcome: 'rejected', reason: expected })
    })

    it('never carries a message, so no exception text can reach the treasurer', () => {
      const result = assess({ contentType: 'application/zip', bytes: bytesOf('PK') })

      expect(Object.keys(result).sort()).toEqual(['outcome', 'reason'])
    })
  })

  describe('parity with migration 004', () => {
    const declaredTypes = (): string[] => {
      const sql = readFileSync(join(process.cwd(), 'migrations', '004_document.sql'), 'utf8')
      const clause = /document_content_type_supported check \(\s*content_type in \(([^)]*)\)/.exec(sql)

      expect(clause, 'migration 004 no longer declares the content-type constraint').not.toBeNull()

      return Array.from(clause![1].matchAll(/'([^']+)'/g), (match) => match[1])
    }

    it('accepts nothing the database will refuse', () => {
      // The direction that costs a treasurer their upload: accepted at the edge,
      // bytes already written to object storage, then refused at INSERT.
      expect([...ACCEPTED_CONTENT_TYPES].sort()).toEqual(declaredTypes().sort())
    })

    it('has a label for every accepted type, so the message can list them as facts', () => {
      // AC3 requires the rejection to state the accepted formats. Rendering them
      // from this map means the list cannot be restated, and so cannot drift.
      //
      // The count assertion is not decoration: a `for` loop over an empty list
      // passes every assertion inside it, which is how this test read green
      // against a stub that exported nothing.
      expect(ACCEPTED_CONTENT_TYPES).toHaveLength(6)

      for (const contentType of ACCEPTED_CONTENT_TYPES) {
        expect(ACCEPTED_FORMAT_LABELS[contentType]).toBeTruthy()
      }
    })
  })
})
