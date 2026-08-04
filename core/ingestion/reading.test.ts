/**
 * Reading an uploaded document into records, as part of ingestion.
 *
 * Ordering is as much under test as the outcomes. The bytes must be durable
 * before anything parses them, and a document's existing records must survive a
 * failed re-read — otherwise a bad export costs a treasurer the figures they
 * already had, and nothing says so.
 */

import * as XLSX from 'xlsx'
import { describe, expect, it, vi } from 'vitest'

import { readWorkbook } from '../../adapters/extraction/workbook-sheetjs'

import type { ExtractionRecord } from '../extraction/record'
import type { DocumentRepository, NewDocument } from '../ports/document-repository'
import type { DocumentStore } from '../ports/document-store'
import type { ExtractionRepository } from '../ports/extraction-repository'
import { readTable } from '../extraction/tabular'
import { ingest } from './ingest'

const UPLOADER = '018f3a2b-0000-7000-8000-000000000001'

const CSV = 'date,description,amount\n2026-06-01,Landscaping,1450.00\n2026-06-02,Pool,820.50'
const csvFile = (filename = 'ledger.csv', text = CSV) => ({
  filename,
  contentType: 'text/csv',
  bytes: new TextEncoder().encode(text),
})
const pdfFile = (filename = 'invoice.pdf') => ({
  filename,
  contentType: 'application/pdf',
  bytes: new TextEncoder().encode('%PDF-1.7\nx\ntrailer\n<< /Size 4 >>\n%%EOF'),
})

interface Fakes {
  store: DocumentStore
  repository: DocumentRepository
  extractions: ExtractionRepository
  order: string[]
  replaced: { documentId: string; records: readonly ExtractionRecord[] }[]
  held: Map<string, readonly ExtractionRecord[]>
}

function fakes(
  options: { alreadyHeld?: boolean; failReplace?: boolean } = {},
): Fakes {
  const order: string[] = []
  const replaced: { documentId: string; records: readonly ExtractionRecord[] }[] = []
  const held = new Map<string, readonly ExtractionRecord[]>()

  return {
    order,
    replaced,
    held,
    store: {
      put: vi.fn(async () => {
        order.push('put')
      }),
    },
    repository: {
      record: vi.fn(async (d: NewDocument) => {
        order.push('record')
        return { id: `doc-${d.contentHash.slice(0, 6)}`, alreadyHeld: Boolean(options.alreadyHeld) }
      }),
    },
    extractions: {
      replace: vi.fn(async (documentId: string, records: readonly ExtractionRecord[]) => {
        order.push('replace')
        if (options.failReplace) throw new Error('database said no')
        if (records.length === 0) throw new RangeError('replace requires at least one record')
        replaced.push({ documentId, records })
        held.set(documentId, records)
      }),
      findByDocument: vi.fn(async (documentId: string) => held.get(documentId) ?? []),
    },
  }
}

describe('reading during ingestion', () => {
  describe('a tabular document', () => {
    it('reports it as read', async () => {
      const [outcome] = await ingest([csvFile()], UPLOADER, fakes())

      expect(outcome).toMatchObject({ outcome: 'read' })
    })

    it('stores one record per data row', async () => {
      const f = fakes()

      await ingest([csvFile()], UPLOADER, f)

      expect(f.replaced[0]?.records).toHaveLength(2)
    })

    it('stores exactly what the reader produced for those bytes', async () => {
      // Cross-check: the expected records are recomputed here from the same
      // text, independently of whatever ingestion passed along.
      const f = fakes()
      const expected = readTable(CSV)

      await ingest([csvFile()], UPLOADER, f)

      expect(expected.ok).toBe(true)
      expect(f.replaced[0]?.records).toEqual(expected.ok ? expected.records : [])
    })

    it('stores the bytes and records the document before parsing anything', async () => {
      // A parse failure must never cost the upload. The document has to be
      // durable first, so a corrected re-read is possible without re-uploading.
      const f = fakes()

      await ingest([csvFile()], UPLOADER, f)

      expect(f.order).toEqual(['put', 'record', 'replace'])
    })

    it('replaces against the document it just recorded', async () => {
      const f = fakes()

      const [outcome] = await ingest([csvFile()], UPLOADER, f)

      expect(f.replaced[0]?.documentId).toBe(
        outcome && 'documentId' in outcome ? outcome.documentId : undefined,
      )
    })
  })

  describe('a spreadsheet', () => {
    // The workbook decoder is a port precisely so `core/` never imports the
    // vendor library. A test may, and this one uses the real adapter — a fake
    // decoder would prove only that the fake agrees with itself.
    const xlsxOf = (rows: (string | number)[][]) => {
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
      return new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
    }
    const xlsxFile = (rows: (string | number)[][]) => ({
      filename: 'ledger.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: xlsxOf(rows),
    })
    const withDecoder = (f: Fakes) => ({ ...f, workbooks: { decode: readWorkbook } })

    it('is read through the decoder port', async () => {
      const f = fakes()

      const [outcome] = await ingest(
        [xlsxFile([
          ['date', 'description', 'amount'],
          ['2026-06-01', 'Landscaping', 1450],
        ])],
        UPLOADER,
        withDecoder(f),
      )

      expect(outcome).toMatchObject({ outcome: 'read' })
      expect(f.replaced[0]?.records).toHaveLength(1)
    })

    it('produces the same records as the identical table expressed as CSV', async () => {
      // Cross-check across two entirely separate decoding paths.
      const rows: (string | number)[][] = [
        ['date', 'description', 'amount'],
        ['2026-06-01', 'Landscaping', 1450.5],
        ['2026-06-02', 'Pool', -250],
      ]
      const asCsv = rows.map((row) => row.join(',')).join('\n')

      const fromSheet = fakes()
      const fromText = fakes()
      await ingest([xlsxFile(rows)], UPLOADER, withDecoder(fromSheet))
      await ingest([csvFile('same.csv', asCsv)], UPLOADER, fromText)

      expect(fromSheet.replaced[0]?.records).toEqual(fromText.replaced[0]?.records)
    })

    it('is held unread when no decoder is wired, rather than failing', async () => {
      const f = fakes()

      const [outcome] = await ingest([xlsxFile([['date', 'description', 'amount']])], UPLOADER, f)

      expect(outcome).toMatchObject({ outcome: 'stored-not-read' })
    })

    it('is unreadable when the bytes are not a workbook', async () => {
      const f = fakes()
      const notAWorkbook = {
        filename: 'fake.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
      }

      const [outcome] = await ingest([notAWorkbook], UPLOADER, withDecoder(f))

      expect(outcome).toMatchObject({ outcome: 'unreadable' })
    })
  })

  describe('a document with no reader yet', () => {
    it('reports a PDF as stored but not read', async () => {
      // Not `read` — nothing read it. Not `failed` — nothing went wrong. The
      // bytes are held so 1.5c can read them without a re-upload.
      const [outcome] = await ingest([pdfFile()], UPLOADER, fakes())

      expect(outcome).toMatchObject({ outcome: 'stored-not-read' })
    })

    it('stores no records for it', async () => {
      const f = fakes()

      await ingest([pdfFile()], UPLOADER, f)

      expect(f.replaced).toEqual([])
    })

    it('still stores the bytes and the document row', async () => {
      const f = fakes()

      await ingest([pdfFile()], UPLOADER, f)

      expect(f.order).toEqual(['put', 'record'])
    })
  })

  describe('a document that cannot be read', () => {
    it.each([
      ['a missing required header', 'description,amount\nLandscaping,1450.00'],
      ['a malformed amount', 'date,description,amount\n2026-06-01,L,$1450.00'],
      ['an impossible date', 'date,description,amount\n2026-02-30,L,1450.00'],
      ['a header-only file', 'date,description,amount'],
      ['an unterminated quote', 'date,description,amount\n"oops'],
    ])('reports %s as unreadable', async (_label, text) => {
      const [outcome] = await ingest([csvFile('x.csv', text)], UPLOADER, fakes())

      expect(outcome).toMatchObject({ outcome: 'unreadable' })
    })

    it('stores nothing for it', async () => {
      const f = fakes()

      await ingest([csvFile('bad.csv', 'date,description,amount\n2026-06-01,L,$1')], UPLOADER, f)

      expect(f.replaced).toEqual([])
    })

    it('never calls replace with an empty set', async () => {
      // Task 1 refuses an empty set. Reaching it would surface a content problem
      // as an infrastructure failure and blame the wrong thing.
      const f = fakes()

      await ingest([csvFile('empty.csv', 'date,description,amount')], UPLOADER, f)

      expect(f.extractions.replace).not.toHaveBeenCalled()
    })

    it('keeps the document, so a corrected export needs no re-upload', async () => {
      const f = fakes()

      await ingest([csvFile('bad.csv', 'date,description,amount\n2026-06-01,L,$1')], UPLOADER, f)

      expect(f.order).toEqual(['put', 'record'])
    })
  })

  describe('a document already held', () => {
    it('is read again, so identical bytes refresh their records', async () => {
      const f = fakes({ alreadyHeld: true })

      await ingest([csvFile()], UPLOADER, f)

      expect(f.replaced).toHaveLength(1)
    })

    it('reports already-held rather than read', async () => {
      const [outcome] = await ingest([csvFile()], UPLOADER, fakes({ alreadyHeld: true }))

      expect(outcome).toMatchObject({ outcome: 'already-held' })
    })

    it('destroys nothing when the re-read fails', async () => {
      // The whole point of replacing only after a complete validated set exists.
      const f = fakes({ alreadyHeld: true })

      await ingest([csvFile('bad.csv', 'date,description,amount\n2026-06-01,L,$1')], UPLOADER, f)

      expect(f.extractions.replace).not.toHaveBeenCalled()
    })
  })

  describe('when the repository fails', () => {
    it('does not report it as unreadable', async () => {
      // The file was fine. Blaming it would send the treasurer to fix an export
      // that has nothing wrong with it.
      const f = fakes({ failReplace: true })

      const [outcome] = await ingest([csvFile()], UPLOADER, f)

      expect(outcome).not.toMatchObject({ outcome: 'unreadable' })
    })

    it('does not report it as failed either, because the document was stored', async () => {
      // `failed` means nothing was kept, and its copy tells the treasurer to
      // upload the file again. Here the bytes and the document row are already
      // durable, so that instruction is wrong twice over: nothing is lost, and
      // re-uploading identical bytes returns already-held and still leaves no
      // figures. Only the extraction write failed.
      const f = fakes({ failReplace: true })

      const [outcome] = await ingest([csvFile()], UPLOADER, f)

      expect(outcome).toMatchObject({ outcome: 'figures-not-stored' })
    })

    it('still hands the error to the reporter', async () => {
      const reported: unknown[] = []
      const f = fakes({ failReplace: true })

      await ingest([csvFile()], UPLOADER, { ...f, onError: (error) => reported.push(error) })

      expect(reported).toHaveLength(1)
    })

    it('names the document, so the figures can be retried without a re-upload', async () => {
      const f = fakes({ failReplace: true })

      const [outcome] = await ingest([csvFile()], UPLOADER, f)

      expect(outcome && 'documentId' in outcome ? outcome.documentId : undefined).toBeTruthy()
    })
  })

  describe('the batch', () => {
    it('carries on past an unreadable file', async () => {
      const f = fakes()
      const files = [
        csvFile('1.csv'),
        csvFile('bad.csv', 'date,description,amount\n2026-06-01,L,$1'),
        csvFile('3.csv'),
        pdfFile('4.pdf'),
        csvFile('5.csv'),
      ]

      const outcomes = await ingest(files, UPLOADER, f)

      expect(outcomes.map((o) => o.outcome)).toEqual([
        'read',
        'unreadable',
        'read',
        'stored-not-read',
        'read',
      ])
    })

    it('returns one outcome per file, in order', async () => {
      const files = ['a.csv', 'b.csv', 'c.csv'].map((n) => csvFile(n))

      const outcomes = await ingest(files, UPLOADER, fakes())

      expect(outcomes.map((o) => o.filename)).toEqual(['a.csv', 'b.csv', 'c.csv'])
    })
  })
})
