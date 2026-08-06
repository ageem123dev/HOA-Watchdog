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
import type { Quarantine } from '../ports/quarantine'
import type { VendorDirectory } from '../ports/vendor-directory'
import { extractDocument, type ExtractDocumentDependencies } from './extract-document'

const DOCUMENT_ID = '018f3a2b-0000-7000-8000-0000000000aa'
const OTHER_DOCUMENT_ID = '018f3a2b-0000-7000-8000-0000000000bb'
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
  /** Every (document, name) handed to the quarantine port, in order. */
  readonly quarantined: { documentId: string; extractedName: string }[]
  /** Every name resolution was asked about, so "never held" cannot pass vacuously. */
  readonly resolved: string[]
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
    /** Names the directory recognises. Everything else comes back unresolved. */
    knownVendors?: string[]
    holdThrows?: boolean
  } = {},
): Fakes {
  const extracted: { bytes: Uint8Array; mediaType: string }[] = []
  const fetched: string[] = []
  const replaced: { documentId: string; records: readonly ExtractionRecord[] }[] = []
  const released: string[] = []
  const marked: { id: string; state: string; token?: string }[] = []
  const quarantined: { documentId: string; extractedName: string }[] = []
  const resolvedNames: string[] = []

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

  const known = new Set((options.knownVendors ?? []).map((name) => name.trim().toLowerCase()))

  const vendors: VendorDirectory = {
    resolve: vi.fn(async (extractedName: string) => {
      resolvedNames.push(extractedName)
      return known.has(extractedName.trim().toLowerCase())
        ? ({ outcome: 'resolved', vendorId: 'vendor-id-for-' + extractedName.trim() } as const)
        : ({ outcome: 'unresolved' } as const)
    }),
    suggest: vi.fn(async () => {
      throw new Error('suggest ranks candidates for a human and must not be reached from ingestion')
    }),
  }

  const quarantine: Quarantine = {
    hold: vi.fn(async (documentId: string, extractedName: string) => {
      if (options.holdThrows) throw new Error('quarantine said no')
      quarantined.push({ documentId, extractedName })
    }),
    heldNames: vi.fn(async () => quarantined.map((item) => item.extractedName)),
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
    vendors,
    quarantine,
    extracted,
    fetched,
    replaced,
    released,
    marked,
    quarantined,
    resolved: resolvedNames,
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

      // The actual default, not merely "more than nothing". A loose bound
      // passes for a 31-second claim, which would expire under a slow provider
      // and hand the document to a second caller mid-run. Raised in review.
      expect(ttl).toBe(300)
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

    it('does not release the claim after a provider outage, so the cooldown survives', async () => {
      // C6 originally required a release on every failure path, "so a retry
      // need not wait for expiry". Round 3 then added a cooldown that caps how
      // often one document can cost a provider call — and the two collided:
      // `markExtractionState` retains the claim as the cooldown, and the
      // release immediately cleared it, so the budget did nothing at all.
      //
      // The cooldown wins for this state. `markExtractionState` owns claim
      // clearing now: it clears for the terminal states and retains for the
      // retryable one, which is one place making the decision instead of two.
      const f = fakes({ result: { ok: false, refusal: 'unavailable' } })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.released).toEqual([])
      expect(f.marked).toEqual([
        { id: DOCUMENT_ID, state: 'provider_unavailable', token: TOKEN },
      ])
    })

    it('does not release separately after an unreadable result either', async () => {
      // Marking a terminal state already clears the claim, so a second write
      // would be a release that matches nothing — and could free a document a
      // *later* claimant already holds if the token were ever reused.
      const f = fakes({ result: { ok: false, refusal: 'invalid' } })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.released).toEqual([])
      expect(f.marked[0]?.state).toBe('unreadable')
    })

    it('records the outage when the bytes cannot be fetched, rather than only releasing', async () => {
      // This test used to assert a bare release, and that is what made the
      // cooldown skippable: releasing leaves `extraction_state` at `held`, which
      // `claimForExtraction` treats as immediately claimable. The next poll
      // would re-claim at once and spend another provider call, so the budget
      // that caps provider cost applied to `settle`'s paths and to nothing else.
      //
      // A thrown store or database error is an outage like any other, and the
      // state must say so durably. Raised in review round 4.
      const f = fakes({ storeThrows: true })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.marked).toEqual([
        { id: DOCUMENT_ID, state: 'provider_unavailable', token: TOKEN },
      ])
      expect(f.released).toEqual([])
    })

    it('records the outage when the write fails after the provider has been paid', async () => {
      // The worst case for cost: the provider call already happened, so an
      // unthrottled retry pays for the same document twice. `replace` throwing
      // is exactly that window.
      const f = fakes({ replaceThrows: true })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.marked).toEqual([
        { id: DOCUMENT_ID, state: 'provider_unavailable', token: TOKEN },
      ])
      expect(f.released).toEqual([])
    })

    it('reports the original cause once when the outage write itself fails', async () => {
      // The error being handled is often a database error, so the write that
      // records it can fail too. Asserting only the returned outcome would be a
      // guard that proves nothing: letting the second error escape reaches the
      // outer catch, which returns the same `provider-unavailable` — the first
      // draft of this test passed with the swallow removed.
      //
      // What actually differs is the reporting. Escaping means `onError` fires
      // twice and the second call carries the bookkeeping failure, burying the
      // cause that matters. One call, carrying the original.
      const reported: unknown[] = []
      const f = fakes({ storeThrows: true })
      vi.mocked(f.repository.markExtractionState).mockRejectedValue(new Error('database also down'))

      const outcome = await extractDocument(DOCUMENT_ID, {
        ...f,
        onError: (error) => reported.push(error),
      })

      expect(outcome).toMatchObject({ outcome: 'provider-unavailable' })
      expect(reported).toHaveLength(1)
      expect((reported[0] as Error).message).toBe('R2 said no')
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

    it('releases the claim when the bytes are simply absent, the one path that still does', async () => {
      // The last `releaseExtractionClaim` call in this module, and it had no
      // test at all. Not an oversight in writing it — an erosion. Two tests
      // once asserted a release here and on neighbouring paths; both were
      // re-specified to `released == []` when the retry cooldown made a
      // release wrong for *those* paths, and this one lost its only cover as
      // collateral. Deleting the call left all 1020 tests green.
      //
      // Absent bytes are deliberately not an outage: retrying cannot conjure
      // them back, so the state stays `held` and the claim is handed back
      // rather than converted into a cooldown that would cap nothing.
      const f = fakes({ bytes: null })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({ outcome: 'not-found' })
      expect(f.released).toEqual([TOKEN])
      expect(f.marked).toEqual([])
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

describe('vendors nobody recognises wait for a human (story 1.6b)', () => {
  const KNOWN = 'Evergreen Landscaping'
  const withVendor = (vendorName: string | null): ExtractionResult => ({
    ok: true,
    records: [{ ...RECORD, vendorName }],
  })

  describe('holding', () => {
    it('holds the document for a name it does not recognise', async () => {
      const f = fakes({ result: withVendor('Someone Unheard Of'), knownVendors: [KNOWN] })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.quarantined).toEqual([
        { documentId: DOCUMENT_ID, extractedName: 'Someone Unheard Of' },
      ])
    })

    it('holds nothing for a name it recognises', async () => {
      // Paired with the test above deliberately. On its own, "nothing was held"
      // passes just as happily against code that never asks.
      const f = fakes({ result: withVendor(KNOWN), knownVendors: [KNOWN] })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.resolved).toEqual([KNOWN])
      expect(f.quarantined).toEqual([])
    })

    it('holds the name as the document said it, not folded', async () => {
      // A treasurer is being asked to recognise this. The normalised form is a
      // comparison key and is no use to them.
      const spelled = '  EverGREEN   Gardens '
      const f = fakes({ result: withVendor(spelled), knownVendors: [KNOWN] })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.quarantined[0]?.extractedName).toBe(spelled)
    })

    it('does not hold a document that has no vendor at all', async () => {
      // A statement has none, and migration 006 allows the null. Holding these
      // would quarantine every bank statement the pilot ingests.
      const f = fakes({ result: withVendor(null), knownVendors: [KNOWN] })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.resolved).toEqual([])
      expect(f.quarantined).toEqual([])
    })

    it('asks once for a name that appears on several records', async () => {
      const f = fakes({
        result: {
          ok: true,
          records: [
            { ...RECORD, vendorName: 'Repeated Vendor' },
            { ...RECORD, vendorName: 'Repeated Vendor' },
            { ...RECORD, vendorName: 'Repeated  vendor' },
          ],
        },
        knownVendors: [KNOWN],
      })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.quarantined).toHaveLength(1)
    })

    it('holds only the names that did not resolve', async () => {
      const f = fakes({
        result: {
          ok: true,
          records: [
            { ...RECORD, vendorName: KNOWN },
            { ...RECORD, vendorName: 'Unknown Roofing' },
            { ...RECORD, vendorName: null },
          ],
        },
        knownVendors: [KNOWN],
      })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.quarantined.map((item) => item.extractedName)).toEqual(['Unknown Roofing'])
    })

    it('still reports the document as read, because extraction succeeded', async () => {
      // Quarantine is not a fifth extraction state. The provider answered and
      // the records validated; it is vendor resolution that is pending.
      const f = fakes({ result: withVendor('Someone Unheard Of'), knownVendors: [KNOWN] })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({ outcome: 'read', records: 1 })
    })
  })

  describe('the order of the two writes', () => {
    it('holds before storing records, so a failure between them can recover', async () => {
      // Not symmetric. `replace` moves the document to `read`, which settles it
      // and stops any later poll, so records stored with no hold is silent and
      // permanent. A hold with no records leaves the document `held`, so the
      // next poll re-extracts, holds again as a no-op, and stores. It heals.
      const order: string[] = []
      const f = fakes({ result: withVendor('Someone Unheard Of'), knownVendors: [KNOWN] })

      vi.mocked(f.quarantine.hold).mockImplementation(async () => {
        order.push('hold')
      })
      vi.mocked(f.extractions.replace).mockImplementation(async () => {
        order.push('replace')
      })

      await extractDocument(DOCUMENT_ID, f)

      expect(order).toEqual(['hold', 'replace'])
    })

    it('does not store records when the hold fails', async () => {
      // The consequence of that order, asserted rather than assumed.
      const f = fakes({
        result: withVendor('Someone Unheard Of'),
        knownVendors: [KNOWN],
        holdThrows: true,
      })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.replaced).toEqual([])
    })

    it('reports a failed hold as retryable, not as a bad document', async () => {
      const f = fakes({
        result: withVendor('Someone Unheard Of'),
        knownVendors: [KNOWN],
        holdThrows: true,
      })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({
        outcome: 'provider-unavailable',
      })
    })
  })

  describe('a name the database could never store', () => {
    const UNSTORABLE = 'Ever\u0000green'

    it('is unreadable, not an outage', async () => {
      // The provider answered and its answer cannot be trusted, which is what
      // `unreadable` means. Reporting `provider-unavailable` would promise a
      // retry that cannot help: the same bytes yield the same NUL every time.
      const f = fakes({ result: withVendor(UNSTORABLE), knownVendors: [KNOWN] })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({ outcome: 'unreadable' })
    })

    it('is not handed to resolution at all', async () => {
      const f = fakes({ result: withVendor(UNSTORABLE), knownVendors: [KNOWN] })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.resolved).toEqual([])
    })

    it('stores nothing and holds nothing', async () => {
      const f = fakes({ result: withVendor(UNSTORABLE), knownVendors: [KNOWN] })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.replaced).toEqual([])
      expect(f.quarantined).toEqual([])
    })

    it.each([
      ['a name past the length the table will store', 'x'.repeat(201)],
      ['a name that is blank once trimmed', ' \u00a0\u202f\t '],
    ])('refuses %s the same way', async (_label, name) => {
      // The guard has to match `quarantine_item_name_length`, not just the one
      // shape validation misses. It refuses a NUL, a name over 200 characters
      // and a name that is blank after trimming; a guard covering only the
      // first lets the other two reach `hold`, raise 23514, and be reported as
      // retryable -- so the document re-fails on every poll and pays for a
      // provider call each time. Raised in review by two reviewers
      // independently, after the first analysis wrongly dismissed it.
      const f = fakes({ result: withVendor(name), knownVendors: [KNOWN] })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({ outcome: 'unreadable' })
      expect(f.resolved).toEqual([])
      expect(f.quarantined).toEqual([])
      expect(f.replaced).toEqual([])
    })

    it('sees an unstorable name even when another record hides it', async () => {
      // The hole the first fix opened. `distinctVendorNames` dedupes by the
      // NORMALISED key and keeps the first spelling, and normalisation treats
      // NBSP as a separator -- so 'Acme' plus three hundred NBSPs collapses to
      // the same key as a plain 'Acme' and disappears before the guard runs.
      //
      // It does not disappear from `replace`, which stores every record. And
      // migration 006's bound trims only space, tab and newline, so the padded
      // name measures 304 there -- verified against the database -- raising
      // 23514, which the generic handler calls a retryable outage. The document
      // then re-fails on every poll and pays for a provider call each time.
      //
      // So the guard has to see every name, not the deduplicated set.
      const padded = 'Acme Supplies' + '\u00a0'.repeat(300)
      const f = fakes({
        result: {
          ok: true,
          records: [
            { ...RECORD, vendorName: 'Acme Supplies' },
            { ...RECORD, vendorName: padded },
          ],
        },
        knownVendors: [KNOWN],
      })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({ outcome: 'unreadable' })
      // Resolution too, not only the outcome: an implementation that resolved
      // the first name before noticing the second still returns `unreadable`
      // and would pass without this. Raised in review.
      expect(f.resolved).toEqual([])
      expect(f.replaced).toEqual([])
      expect(f.quarantined).toEqual([])
    })

    it('accepts a name exactly at the length the table allows', async () => {
      // The other side of the bound. Without this, a guard one character too
      // strict passes every test above.
      const f = fakes({ result: withVendor('y'.repeat(200)), knownVendors: [KNOWN] })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({ outcome: 'read' })
      expect(f.quarantined).toHaveLength(1)
    })

    it('counts characters the way the database does, not UTF-16 units', async () => {
      // `char_length` counts code points; JavaScript's `.length` counts UTF-16
      // units, so 200 astral characters are 400 by the wrong measure. Guarding
      // on `.length` would refuse a name the table would happily store.
      const astral = String.fromCodePoint(0x1f600).repeat(200)

      expect(astral.length).toBe(400)

      const f = fakes({ result: withVendor(astral), knownVendors: [KNOWN] })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({ outcome: 'read' })
    })

    it('accepts every other awkward character, so the guard is narrow', async () => {
      // A guard that refuses too much is its own defect: these are all storable
      // and all plausible in a real vendor name.
      const awkward = 'Café Äkta — O’Brien & Sons'
      const f = fakes({ result: withVendor(awkward), knownVendors: [KNOWN] })

      expect(await extractDocument(DOCUMENT_ID, f)).toMatchObject({ outcome: 'read' })
      expect(f.quarantined).toHaveLength(1)
    })
  })

  describe('the deterministic path is untouched', () => {
    it.each(TABULAR)('never resolves a vendor for %s', async (contentType) => {
      const f = fakes({
        document: {
          id: DOCUMENT_ID,
          storageKey: 'documents/ab/cdef',
          contentType,
          extractionState: 'held' as const,
        },
        knownVendors: [KNOWN],
      })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.resolved).toEqual([])
      expect(f.quarantined).toEqual([])
    })
  })

  describe('one held document does not delay any other (AC3)', () => {
    it('holds the unresolved one and lets the rest through', async () => {
      // Both documents run through the *same* quarantine and directory, so this
      // would fail if extraction ever became set-shaped -- one call deciding
      // for a batch, where a single unknown name stops everything behind it.
      // It passes trivially today because extraction is per document, and that
      // is exactly why it is worth asserting: nothing else records the
      // guarantee, and a later change could take it away silently.
      const held = fakes({ result: withVendor('Someone Unheard Of'), knownVendors: [KNOWN] })
      const clear = {
        ...fakes({ result: withVendor(KNOWN), knownVendors: [KNOWN] }),
        quarantine: held.quarantine,
        vendors: held.vendors,
      }

      const heldOutcome = await extractDocument(DOCUMENT_ID, held)
      const clearOutcome = await extractDocument(OTHER_DOCUMENT_ID, clear)

      expect(heldOutcome).toMatchObject({ outcome: 'read' })
      expect(clearOutcome).toMatchObject({ outcome: 'read' })
      expect(held.quarantined).toEqual([
        { documentId: DOCUMENT_ID, extractedName: 'Someone Unheard Of' },
      ])
    })

    it('stores the records of the document that was held, too', async () => {
      // Holding is not withholding. The figures were read and they are kept;
      // what waits is who the vendor is.
      const f = fakes({ result: withVendor('Someone Unheard Of'), knownVendors: [KNOWN] })

      await extractDocument(DOCUMENT_ID, f)

      expect(f.replaced).toHaveLength(1)
    })
  })
})
