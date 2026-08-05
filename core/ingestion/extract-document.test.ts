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
import {
  StaleExtractionClaimError,
  type DocumentRepository,
  type HeldDocument,
} from '../ports/document-repository'
import type { DocumentStore } from '../ports/document-store'
import type { ExtractionRepository } from '../ports/extraction-repository'
import type { ExtractionResult, Extractor } from '../ports/extractor'
import { extractDocument, type ExtractDocumentDependencies } from './extract-document'

const DOCUMENT_ID = '018f3a2b-0000-7000-8000-0000000000aa'
const SCAN_BYTES = new TextEncoder().encode('%PDF-1.7 a scanned invoice')
const TOKEN = '018f3a2b-0000-7000-8000-0000000000ff'

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
  readonly released: string[]
  readonly marked: { id: string; state: string; token?: string }[]
}

function fakes(
  options: {
    document?: HeldDocument | null
    bytes?: Uint8Array | null
    result?: ExtractionResult
    storeThrows?: boolean
    replaceThrows?: boolean
    replaceStale?: boolean
    claimable?: boolean
  } = {},
): Fakes {
  const extracted: { bytes: Uint8Array; mediaType: string }[] = []
  const fetched: string[] = []
  const replaced: { documentId: string; records: readonly ExtractionRecord[] }[] = []
  const released: string[] = []
  const marked: { id: string; state: string; token?: string }[] = []

  const held: HeldDocument | null =
    options.document === undefined
      ? {
          id: DOCUMENT_ID,
          storageKey: 'documents/ab/cdef',
          contentType: 'application/pdf',
          extractionState: 'held' as const,
        }
      : options.document

  const claim = options.claimable === false ? null : { documentId: DOCUMENT_ID, token: TOKEN }

  const repository: DocumentRepository = {
    record: vi.fn(async () => ({ id: DOCUMENT_ID, alreadyHeld: false })),
    findById: vi.fn(async () => held),
    markExtractionState: vi.fn(async (id: string, state: string, fence?: { token: string }) => {
      marked.push({ id, state, token: fence?.token })
    }),
    claimForExtraction: vi.fn(async () => claim),
    releaseExtractionClaim: vi.fn(async (given) => {
      released.push(given.token)
    }),
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
      if (options.replaceStale) throw new StaleExtractionClaimError(documentId)
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

  return {
    repository,
    store,
    extractions,
    extractor,
    extracted,
    fetched,
    replaced,
    released,
    marked,
  }
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
        extractionState: 'held',
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
      const f = fakes({
        document: { id: DOCUMENT_ID, storageKey: 'k', contentType, extractionState: 'held' },
      })

      const outcome = await extractDocument(DOCUMENT_ID, f)

      expect(f.extractor.extract).not.toHaveBeenCalled()
      expect(outcome).toMatchObject({ outcome: 'no-provider-path' })
    })

    it.each(PROVIDER_BACKED)('does call the provider for %s', async (contentType) => {
      // The other direction. Without this, the guard above passes for an
      // implementation that never calls the provider at all.
      const f = fakes({
        document: { id: DOCUMENT_ID, storageKey: 'k', contentType, extractionState: 'held' },
      })

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
      const f = fakes({ document: { id: DOCUMENT_ID, storageKey: 'k', contentType: 'text/csv', extractionState: 'held' } })

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

  describe('the claim (story 1.5d task 3)', () => {
    it('claims the document before calling the provider', async () => {
      // The whole point. A lock taken around the write serialises the cheap
      // part and lets the expensive part run twice.
      const f = fakes()

      await extractDocument(DOCUMENT_ID, f)

      expect(f.repository.claimForExtraction).toHaveBeenCalledTimes(1)
      const claimOrder = vi.mocked(f.repository.claimForExtraction).mock.invocationCallOrder[0]!
      const extractOrder = vi.mocked(f.extractor.extract).mock.invocationCallOrder[0]!
      expect(claimOrder).toBeLessThan(extractOrder)
    })

    it('claims for a positive, non-trivial length of time', async () => {
      // Nothing checked the second argument. If it regressed to 0 or undefined
      // every claim would be immediately expirable, defeating the fence this
      // whole suite exists to protect — and every test here would still pass.
      // Raised in review.
      const f = fakes()

      await extractDocument(DOCUMENT_ID, f)

      const [, ttl] = vi.mocked(f.repository.claimForExtraction).mock.calls[0]!

      expect(typeof ttl).toBe('number')
      expect(ttl).toBeGreaterThan(30)
    })

    it('honours an explicit claim TTL', async () => {
      const f = fakes()

      await extractDocument(DOCUMENT_ID, { ...f, claimTtlSeconds: 90 })

      expect(f.repository.claimForExtraction).toHaveBeenCalledWith(DOCUMENT_ID, 90)
    })

    it('does not call the provider when the claim is lost (C9)', async () => {
      const f = fakes({ claimable: false })

      const outcome = await extractDocument(DOCUMENT_ID, f)

      expect(f.extractor.extract).not.toHaveBeenCalled()
      expect(f.store.get).not.toHaveBeenCalled()
      expect(outcome).toMatchObject({ outcome: 'in-progress' })
    })

    it('does not claim a document with no provider path, so nothing is wasted', async () => {
      const f = fakes({
        document: { id: DOCUMENT_ID, storageKey: 'k', contentType: 'text/csv', extractionState: 'held' },
      })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.repository.claimForExtraction).not.toHaveBeenCalled()
    })

    it('fences the write with the token it holds (C4)', async () => {
      const f = fakes()

      await extractDocument(DOCUMENT_ID, f)

      expect(f.extractions.replace).toHaveBeenCalledWith(DOCUMENT_ID, expect.anything(), {
        token: TOKEN,
      })
    })

    it('fences the failure states too', async () => {
      // The hole the fence would otherwise leave open: A's claim expires, B
      // claims and succeeds, then A returns with a failure and marks the
      // document unreadable — overwriting B's success. Marking is a write and
      // needs the same fence the record write has.
      const f = fakes({ result: { ok: false, refusal: 'invalid' } })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.marked).toEqual([{ id: DOCUMENT_ID, state: 'unreadable', token: TOKEN }])
    })

    it.each([
      ['invalid', 'unreadable'],
      ['unavailable', 'provider_unavailable'],
    ])('records the durable state after a %s refusal', async (refusal, state) => {
      const f = fakes({ result: { ok: false, refusal: refusal as 'invalid' | 'unavailable' } })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.marked[0]?.state).toBe(state)
    })

    it('releases the claim after a failure, so a retry need not wait for expiry (C6)', async () => {
      const f = fakes({ result: { ok: false, refusal: 'unavailable' } })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.released).toEqual([TOKEN])
    })

    it('releases the claim when the bytes cannot be fetched', async () => {
      const f = fakes({ storeThrows: true })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.released).toEqual([TOKEN])
    })

    it('does not release after a successful write, because the write cleared it', async () => {
      // `replace` clears the claim in the same transaction as the state change.
      // Releasing again would be a second write that could free a document a
      // *later* claimant already holds.
      const f = fakes()

      await extractDocument(DOCUMENT_ID, f)

      expect(f.released).toEqual([])
    })

    it('does not mark a state when it never held the claim', async () => {
      const f = fakes({ claimable: false })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.marked).toEqual([])
      expect(f.released).toEqual([])
    })
  })

  describe('what a poll reports once the work has finished (found in review)', () => {
    // `claimForExtraction` returns null for two different situations: someone
    // else holds a live claim, and the document has finished. Reporting both as
    // `in-progress` means a document that was read successfully shows "Reading"
    // to the treasurer forever, because every later poll takes the same branch.
    it('reports an already-read document with its record count, not a bare outcome', async () => {
      // Raised in review. The first version built `{ outcome: 'read', documentId }`
      // and forced it past the compiler with `as ExtractionOutcome` — producing a
      // `read` result with no `records` field, which the type says is impossible.
      // A cast that silences the checker is how that becomes a runtime surprise.
      const f = fakes({
        claimable: false,
        document: {
          id: DOCUMENT_ID,
          storageKey: 'k',
          contentType: 'application/pdf',
          extractionState: 'read',
        },
      })
      vi.mocked(f.extractions.findByDocument).mockResolvedValue([RECORD, RECORD])

      expect(await extractDocument(DOCUMENT_ID, f)).toEqual({
        outcome: 'read',
        documentId: DOCUMENT_ID,
        records: 2,
      })
    })

    it.each([
      ['unreadable', 'unreadable'],
      ['provider_unavailable', 'provider-unavailable'],
    ] as const)('reports %s as %s rather than in-progress', async (state, expected) => {
      const f = fakes({
        claimable: false,
        document: {
          id: DOCUMENT_ID,
          storageKey: 'k',
          contentType: 'application/pdf',
          extractionState: state,
        },
      })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({ outcome: expected })
    })

    it('re-reads the state after losing the claim, rather than trusting a stale read', async () => {
      // The window: findById says `held`, another worker finishes, and only then
      // does claimForExtraction return null. Reporting the first read would
      // resurrect the "Reading forever" bug this branch exists to fix. Raised in
      // review.
      const f = fakes({ claimable: false })
      vi.mocked(f.repository.findById)
        .mockResolvedValueOnce({
          id: DOCUMENT_ID,
          storageKey: 'k',
          contentType: 'application/pdf',
          extractionState: 'held',
        })
        .mockResolvedValueOnce({
          id: DOCUMENT_ID,
          storageKey: 'k',
          contentType: 'application/pdf',
          extractionState: 'read',
        })
      vi.mocked(f.extractions.findByDocument).mockResolvedValue([RECORD])

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({ outcome: 'read', records: 1 })
    })

    it('reports not-found when the document disappears while the claim is lost', async () => {
      const f = fakes({ claimable: false })
      vi.mocked(f.repository.findById)
        .mockResolvedValueOnce({
          id: DOCUMENT_ID,
          storageKey: 'k',
          contentType: 'application/pdf',
          extractionState: 'held',
        })
        .mockResolvedValueOnce(null)

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({ outcome: 'not-found' })
    })

    it('still reports in-progress when the document is held and someone else holds it', async () => {
      // The other direction. Without this, the fix above could report the state
      // for everything and never say in-progress at all.
      const f = fakes({ claimable: false })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({ outcome: 'in-progress' })
    })
  })

  describe('a claim that lapsed under a slow holder (found in review)', () => {
    it('does not report an outage when a fresher claimant already finished', async () => {
      // The stale holder's write is refused, which is correct. Reporting that
      // refusal as `provider-unavailable` tells the treasurer their document is
      // waiting when it has in fact been read by the run that superseded this
      // one.
      const f = fakes({ replaceStale: true })
      vi.mocked(f.repository.findById)
        .mockResolvedValueOnce({
          id: DOCUMENT_ID,
          storageKey: 'documents/ab/cdef',
          contentType: 'application/pdf',
          extractionState: 'held',
        })
        .mockResolvedValueOnce({
          id: DOCUMENT_ID,
          storageKey: 'documents/ab/cdef',
          contentType: 'application/pdf',
          extractionState: 'read',
        })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({ outcome: 'read' })
    })

    it('re-reads the document rather than guessing what the winner did', async () => {
      const f = fakes({ replaceStale: true })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.repository.findById).toHaveBeenCalledTimes(2)
    })

    it('does not report a stale claim as an infrastructure failure', async () => {
      const f = fakes({ replaceStale: true })

      const outcome = await extractDocument(DOCUMENT_ID, f)

      expect(outcome).not.toMatchObject({ outcome: 'provider-unavailable' })
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
