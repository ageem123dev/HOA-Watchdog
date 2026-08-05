/**
 * Deferred extraction: reading a document that is already held.
 *
 * The most important assertion here is a **negative** one — that a CSV never
 * reaches the provider — and a negative assertion is worth nothing unless the
 * same test would notice a call. The fake extractor counts, so it would.
 *
 * The other shape under test is blame. Telling a treasurer their scan is bad
 * during a provider outage sends them to re-scan a document that was fine.
 * Story 1.5b shipped that mistake once (`failed`, saying "not saved", when the
 * bytes were saved) and 1.5c split the port's refusal into `unavailable` and
 * `invalid` so this story could keep them apart.
 */

import { describe, expect, it, vi } from 'vitest'

import { ACCEPTED_CONTENT_TYPES } from './acceptance'
import type { ExtractionRecord } from '../extraction/record'
import type { DocumentRepository, HeldDocument } from '../ports/document-repository'
import type { DocumentStore } from '../ports/document-store'
import type { ExtractionRepository } from '../ports/extraction-repository'
import type { ExtractionResult, Extractor } from '../ports/extractor'
import { extractDocument, type ExtractDocumentDependencies } from './extract-document'

const DOCUMENT_ID = '018f3a2b-0000-7000-8000-0000000000aa'
const SCAN_BYTES = new TextEncoder().encode('%PDF-1.7 a scanned invoice')

const RECORD: ExtractionRecord = {
  documentKind: 'invoice',
  vendorName: 'Evergreen Landscaping',
  documentNumber: 'INV-4021',
  issuedOn: '2026-06-01',
  totalAmount: '1450.00',
  currency: 'USD',
}

const TABULAR = ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
const PROVIDER_BACKED = ['application/pdf', 'image/png', 'image/jpeg']

interface Fakes extends ExtractDocumentDependencies {
  readonly extracted: { bytes: Uint8Array; mediaType: string }[]
  readonly fetched: string[]
  readonly replaced: { documentId: string; records: readonly ExtractionRecord[] }[]
}

function fakes(
  options: {
    document?: HeldDocument | null
    bytes?: Uint8Array | null
    result?: ExtractionResult
    storeThrows?: boolean
    replaceThrows?: boolean
  } = {},
): Fakes {
  const extracted: { bytes: Uint8Array; mediaType: string }[] = []
  const fetched: string[] = []
  const replaced: { documentId: string; records: readonly ExtractionRecord[] }[] = []

  const held: HeldDocument | null =
    options.document === undefined
      ? { id: DOCUMENT_ID, storageKey: 'documents/ab/cdef', contentType: 'application/pdf' }
      : options.document

  const repository: DocumentRepository = {
    record: vi.fn(async () => ({ id: DOCUMENT_ID, alreadyHeld: false })),
    findById: vi.fn(async () => held),
  }

  const store: DocumentStore = {
    put: vi.fn(async () => undefined),
    get: vi.fn(async (key: string) => {
      fetched.push(key)
      if (options.storeThrows) throw new Error('R2 said no')
      return options.bytes === undefined ? SCAN_BYTES : options.bytes
    }),
  }

  const extractions: ExtractionRepository = {
    replace: vi.fn(async (documentId: string, records: readonly ExtractionRecord[]) => {
      if (options.replaceThrows) throw new Error('database said no')
      if (records.length === 0) throw new RangeError('replace refuses an empty set')
      replaced.push({ documentId, records })
    }),
    findByDocument: vi.fn(async () => []),
  }

  const extractor: Extractor = {
    extract: vi.fn(async (request) => {
      extracted.push({ bytes: request.bytes, mediaType: request.mediaType })
      const fallback: ExtractionResult = { ok: true, records: [RECORD] }
      return options.result ?? fallback
    }),
  }

  return { repository, store, extractions, extractor, extracted, fetched, replaced }
}

describe('extractDocument', () => {
  describe('the ordinary case', () => {
    it('reports the document as read', async () => {
      expect(await extractDocument(DOCUMENT_ID, fakes())).toMatchObject({ outcome: 'read' })
    })

    it('stores every record the provider returned (cross-check)', async () => {
      // Compared against what the injected extractor returned, not read back
      // from the code under test.
      const f = fakes({ result: { ok: true, records: [RECORD, { ...RECORD, documentNumber: 'INV-4022' }] } })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.replaced[0]?.records).toHaveLength(2)
      expect(f.replaced[0]?.records).toEqual([RECORD, { ...RECORD, documentNumber: 'INV-4022' }])
    })

    it('reports how many records were stored, so a caller need not guess', async () => {
      const f = fakes({ result: { ok: true, records: [RECORD, RECORD] } })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({ outcome: 'read', records: 2 })
    })

    it('stores them against the document it was asked about', async () => {
      const f = fakes()

      await extractDocument(DOCUMENT_ID, f)

      expect(f.replaced[0]?.documentId).toBe(DOCUMENT_ID)
    })

    it('fetches the bytes at the key the document record names (A3)', async () => {
      // Misattribution is silent and permanent: records stored against a
      // document whose bytes they did not come from. The key is taken from the
      // document record here, independently of what the code passed.
      const document: HeldDocument = {
        id: DOCUMENT_ID,
        storageKey: 'documents/99/deadbeef',
        contentType: 'application/pdf',
      }
      const f = fakes({ document })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.fetched).toEqual([document.storageKey])
    })

    it('sends the bytes it fetched, and the document’s own media type', async () => {
      const f = fakes()

      await extractDocument(DOCUMENT_ID, f)

      expect(f.extracted[0]?.bytes).toBe(SCAN_BYTES)
      expect(f.extracted[0]?.mediaType).toBe('application/pdf')
    })
  })

  describe('the deterministic path never reaches the model (A1, A8)', () => {
    it.each(TABULAR)('does not call the provider for %s', async (contentType) => {
      // Story 1.5's AC2 guarantee. It also costs money per document to break.
      const f = fakes({ document: { id: DOCUMENT_ID, storageKey: 'k', contentType } })

      const outcome = await extractDocument(DOCUMENT_ID, f)

      expect(f.extractor.extract).not.toHaveBeenCalled()
      expect(outcome).toMatchObject({ outcome: 'no-provider-path' })
    })

    it.each(PROVIDER_BACKED)('does call the provider for %s', async (contentType) => {
      // The other direction. Without this, the guard above passes for an
      // implementation that never calls the provider at all.
      const f = fakes({ document: { id: DOCUMENT_ID, storageKey: 'k', contentType } })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.extractor.extract).toHaveBeenCalledTimes(1)
    })

    it('routes every accepted content type exactly one way', async () => {
      // Neither list may drift from what upload accepts: a type in neither is a
      // document that can be uploaded and never read, and a type in both is one
      // that could be read twice.
      const routed = new Set([...TABULAR, ...PROVIDER_BACKED])

      expect(ACCEPTED_CONTENT_TYPES.length).toBeGreaterThan(0)
      expect([...ACCEPTED_CONTENT_TYPES].sort()).toEqual([...routed].sort())
    })

    it('stores nothing for a tabular document', async () => {
      const f = fakes({ document: { id: DOCUMENT_ID, storageKey: 'k', contentType: 'text/csv' } })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.extractions.replace).not.toHaveBeenCalled()
    })
  })

  describe('an outage is not the document’s fault (A2, A6)', () => {
    it('reports a provider refusal of unavailable as provider-unavailable', async () => {
      const f = fakes({ result: { ok: false, refusal: 'unavailable' } })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({
        outcome: 'provider-unavailable',
      })
    })

    it('reports a provider refusal of invalid as unreadable', async () => {
      // Both directions asserted. A guard that only checks one of a pair passes
      // for an implementation that returns that one always.
      const f = fakes({ result: { ok: false, refusal: 'invalid' } })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({ outcome: 'unreadable' })
    })

    it('reports a storage failure as provider-unavailable, not as a bad scan', async () => {
      const f = fakes({ storeThrows: true })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({
        outcome: 'provider-unavailable',
      })
    })

    it('reports a failed write as provider-unavailable, since the document read fine', async () => {
      const f = fakes({ replaceThrows: true })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({
        outcome: 'provider-unavailable',
      })
    })

    it('hands the error to the reporter rather than swallowing it', async () => {
      const reported: unknown[] = []
      const f = fakes({ storeThrows: true })

      await extractDocument(DOCUMENT_ID, { ...f, onError: (error) => reported.push(error) })

      expect(reported).toHaveLength(1)
    })
  })

  describe('nothing is stored when extraction did not succeed (A4, A5)', () => {
    it.each([
      ['unavailable', { ok: false, refusal: 'unavailable' } as ExtractionResult],
      ['invalid', { ok: false, refusal: 'invalid' } as ExtractionResult],
    ])('does not call replace after a %s refusal', async (_label, result) => {
      const f = fakes({ result })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.extractions.replace).not.toHaveBeenCalled()
    })

    it('never calls replace with an empty set', async () => {
      // 1.5b's repository refuses `[]`. Reaching it would report a content
      // problem as an infrastructure failure and blame the wrong thing.
      const f = fakes({ result: { ok: true, records: [] } })

      const outcome = await extractDocument(DOCUMENT_ID, f)

      expect(f.extractions.replace).not.toHaveBeenCalled()
      expect(outcome).toMatchObject({ outcome: 'unreadable' })
    })
  })

  describe('a document that is not there', () => {
    it('reports not-found rather than throwing', async () => {
      const f = fakes({ document: null })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({ outcome: 'not-found' })
    })

    it('reports not-found when the row exists but the bytes are gone', async () => {
      // A missing object is not a transient outage: retrying cannot help, and
      // saying "try later" forever would be a lie.
      const f = fakes({ bytes: null })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({ outcome: 'not-found' })
    })

    it('calls neither the provider nor the repository for a missing document', async () => {
      const f = fakes({ document: null })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.extractor.extract).not.toHaveBeenCalled()
      expect(f.extractions.replace).not.toHaveBeenCalled()
    })
  })
})
