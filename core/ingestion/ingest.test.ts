/**
 * Ingestion, end to end within `core/` — no network, no database, no credentials.
 *
 * The failure these tests care most about is not a wrong answer, it is a lost
 * afternoon. A treasurer uploads twenty documents, one is a `.docx`, and the
 * batch dies. AC3 says the rest must still be processed; the same has to hold
 * when the cause is a transient storage error rather than the file's fault.
 */

import type { DocumentKind } from '../extraction/record'
import { describe, expect, it, vi } from 'vitest'

import type { DocumentRepository, NewDocument } from '../ports/document-repository'
import type { DocumentStore, StoredDocument } from '../ports/document-store'
import type { ExtractionRepository } from '../ports/extraction-repository'
import { contentHash } from './content-hash'
import { ingest } from './ingest'
import { storageKeyFor } from './storage-key'

const UPLOADER = '018f3a2b-0000-7000-8000-000000000001'

const pdf = (label: string): Uint8Array =>
  new TextEncoder().encode(`%PDF-1.7\n${label}\ntrailer\n<< /Size 4 >>\n%%EOF`)

const file = (
  filename: string,
  bytes = pdf(filename),
  contentType = 'application/pdf',
  documentKind: DocumentKind = 'statement',
) => ({
  filename,
  contentType,
  bytes,
  // Declared by the upload since story 5.2, not read off a `type` column.
  documentKind,
})

interface Fakes {
  store: DocumentStore
  repository: DocumentRepository
  extractions: ExtractionRepository
  stored: StoredDocument[]
  recorded: NewDocument[]
  destructiveCalls: string[]
}

function fakes(
  options: {
    heldHashes?: Set<string>
    failStoreFor?: (document: StoredDocument) => boolean
    failRecordFor?: (document: NewDocument) => boolean
  } = {},
): Fakes {
  const stored: StoredDocument[] = []
  const recorded: NewDocument[] = []
  const destructiveCalls: string[] = []
  const held = options.heldHashes ?? new Set<string>()

  return {
    stored,
    recorded,
    destructiveCalls,
    // Every file in this suite is a PDF or a rejection, so nothing here should
    // ever reach extraction. Throwing rather than recording makes that a proven
    // property instead of an untested assumption: if routing ever sends a PDF
    // down the reading path, these tests report `failed` and say so.
    extractions: {
      replace: vi.fn(async () => {
        destructiveCalls.push('replace')
        throw new Error('no file in this suite should reach extraction')
      }),
      findByDocument: vi.fn(async () => []),
    },
    store: {
      get: vi.fn(async () => null),
      put: vi.fn(async (document: StoredDocument) => {
        if (options.failStoreFor?.(document)) throw new Error('R2 said no')
        stored.push(document)
      }),
    },
    repository: {
      findById: vi.fn(async () => null),
      // Silent stubs would let the guarantee above rot. `extractions.replace`
      // throws so that a PDF reaching extraction is a failure rather than a
      // pass; these are the rest of that same lifecycle and must behave the
      // same way, or routing could later send an upload down the deferred path
      // and this suite would stay green. Raised in review.
      markExtractionState: vi.fn(async () => {
        throw new Error('no file in this suite should reach the extraction lifecycle')
      }),
      claimForExtraction: vi.fn(async () => {
        throw new Error('no file in this suite should claim a document')
      }),
      releaseExtractionClaim: vi.fn(async () => {
        throw new Error('no file in this suite should release a claim')
      }),
      // `destructiveCalls` stays empty by construction now that the port has no
      // destructive method. It is still asserted, so re-introducing one without
      // a place for it in the ordering fails these tests rather than passing
      // quietly.
      record: vi.fn(async (document: NewDocument) => {
        if (options.failRecordFor?.(document)) throw new Error('database said no')

        const alreadyHeld = held.has(document.contentHash)
        if (!alreadyHeld) {
          held.add(document.contentHash)
          recorded.push(document)
        }

        return { id: `doc-${document.contentHash.slice(0, 8)}`, alreadyHeld }
      }),
    },
  }
}

describe('ingest', () => {
  describe('a document that is accepted', () => {
    it('stores the bytes and records the document', async () => {
      const f = fakes()
      const one = file('june-statement.pdf')

      const outcomes = await ingest([one], UPLOADER, f)

      expect(outcomes).toEqual([
        {
          filename: 'june-statement.pdf',
          // A PDF is stored and held unread until the provider story adds a
          // reader for it. Not `read`, because nothing read it.
          outcome: 'stored-not-read',
          documentId: `doc-${contentHash(one.bytes).slice(0, 8)}`,
        },
      ])
      expect(f.stored).toHaveLength(1)
      expect(f.recorded).toHaveLength(1)
    })

    it('keys the object off the content hash, so re-upload cannot make a second one', async () => {
      // Cross-check: both values recomputed here from the bytes, independently
      // of whatever the service did internally.
      const f = fakes()
      const one = file('ledger.pdf')

      await ingest([one], UPLOADER, f)

      const expectedHash = contentHash(one.bytes)
      expect(f.stored[0]?.key).toBe(storageKeyFor(expectedHash))
      expect(f.recorded[0]?.contentHash).toBe(expectedHash)
      expect(f.recorded[0]?.storageKey).toBe(storageKeyFor(expectedHash))
    })

    it('records the size of the bytes actually held, not a declared figure', async () => {
      const f = fakes()
      const one = file('big.pdf', pdf('x'.repeat(5000)))

      await ingest([one], UPLOADER, f)

      expect(f.recorded[0]?.byteSize).toBe(one.bytes.length)
    })

    it('records the normalised content type, not the one the browser declared', async () => {
      // `text/csv; charset=utf-8` violates document_content_type_supported.
      // Recording the raw declaration fails at INSERT, after the bytes are
      // already in object storage.
      const f = fakes()
      const csv = file('export.csv', new TextEncoder().encode('a,b\n1,2\n'), 'Text/CSV; charset=utf-8')

      await ingest([csv], UPLOADER, f)

      expect(f.recorded[0]?.contentType).toBe('text/csv')
    })

    it('keeps the uploader, so the audit trail keeps its actor', async () => {
      const f = fakes()

      await ingest([file('a.pdf')], UPLOADER, f)

      expect(f.recorded[0]?.uploadedBy).toBe(UPLOADER)
    })

    it('keeps the filename for display without letting it reach the object key', async () => {
      const f = fakes()

      await ingest([file('Unit 4B — Ramirez.pdf')], UPLOADER, f)

      expect(f.recorded[0]?.filename).toBe('Unit 4B — Ramirez.pdf')
      expect(f.stored[0]?.key).not.toContain('Ramirez')
    })

    it('stores before recording, so no row can point at bytes that are not there', async () => {
      const order: string[] = []
      const f = fakes()
      vi.mocked(f.store.put).mockImplementation(async () => {
        order.push('store')
      })
      vi.mocked(f.repository.record).mockImplementation(async () => {
        order.push('record')
        return { id: 'doc-1', alreadyHeld: false }
      })

      await ingest([file('a.pdf')], UPLOADER, f)

      expect(order).toEqual(['store', 'record'])
    })
  })

  describe('a document already held (AC2)', () => {
    it('reports it as already held rather than as a failure', async () => {
      const bytes = pdf('same')
      const f = fakes({ heldHashes: new Set([contentHash(bytes)]) })

      const [outcome] = await ingest([file('again.pdf', bytes)], UPLOADER, f)

      expect(outcome).toMatchObject({ outcome: 'already-held' })
    })

    it('does not record a second document row', async () => {
      const bytes = pdf('same')
      const f = fakes({ heldHashes: new Set([contentHash(bytes)]) })

      await ingest([file('again.pdf', bytes)], UPLOADER, f)

      expect(f.recorded).toHaveLength(0)
    })

    it('destroys nothing when the same bytes arrive again', async () => {
      // AD-13's replacement is real, but it belongs *after* a complete set has
      // been read and validated — which is Task 3's wiring, not this branch.
      // Deleting here, before anything is parsed, means a failed re-read leaves
      // the document with no records where it had a full set.
      const bytes = pdf('same')
      const f = fakes({ heldHashes: new Set([contentHash(bytes)]) })

      await ingest([file('again.pdf', bytes)], UPLOADER, f)

      expect(f.destructiveCalls).toEqual([])
    })

    it('destroys nothing for a document seen for the first time either', async () => {
      const f = fakes()

      await ingest([file('new.pdf')], UPLOADER, f)

      expect(f.destructiveCalls).toEqual([])
    })

    it('handles the same file twice inside one batch', async () => {
      // Two identical files in one upload is the case that manufactures a
      // duplicate if the check is a read-then-write.
      const bytes = pdf('duplicate')
      const f = fakes()

      const outcomes = await ingest(
        [file('invoice.pdf', bytes), file('invoice-copy.pdf', bytes)],
        UPLOADER,
        f,
      )

      expect(outcomes.map((o) => o.outcome)).toEqual(['stored-not-read', 'already-held'])
      expect(f.recorded).toHaveLength(1)
    })
  })

  describe('a document that is rejected', () => {
    it('reports the reason from the acceptance gate', async () => {
      const f = fakes()
      const bad = file('notes.docx', new Uint8Array([1, 2, 3]), 'application/msword')

      const [outcome] = await ingest([bad], UPLOADER, f)

      expect(outcome).toEqual({
        filename: 'notes.docx',
        outcome: 'rejected',
        reason: 'unsupported-type',
      })
    })

    it('leaves nothing behind — neither port is called at all (AC4)', async () => {
      const f = fakes()
      const locked = file(
        'locked.pdf',
        new TextEncoder().encode('%PDF-1.7\nx\ntrailer\n<< /Encrypt 5 0 R >>\n%%EOF'),
      )

      const [outcome] = await ingest([locked], UPLOADER, f)

      expect(outcome).toMatchObject({ outcome: 'rejected', reason: 'unreadable' })
      expect(f.store.put).not.toHaveBeenCalled()
      expect(f.repository.record).not.toHaveBeenCalled()
    })

    it('does not stop the rest of the batch (AC3)', async () => {
      const f = fakes()
      const files = [
        file('1.pdf'),
        file('2.pdf'),
        file('bad.exe', new Uint8Array([0x4d, 0x5a]), 'application/x-msdownload'),
        file('4.pdf'),
        file('5.pdf'),
      ]

      const outcomes = await ingest(files, UPLOADER, f)

      expect(outcomes.map((o) => o.outcome)).toEqual([
        'stored-not-read',
        'stored-not-read',
        'rejected',
        'stored-not-read',
        'stored-not-read',
      ])
      expect(f.recorded).toHaveLength(4)
    })
  })

  describe('when a port fails', () => {
    it('reports that file as failed and processes the others', async () => {
      const third = file('3.pdf')
      const f = fakes({ failStoreFor: (document) => document.key === storageKeyFor(contentHash(third.bytes)) })

      const outcomes = await ingest(
        [file('1.pdf'), file('2.pdf'), third, file('4.pdf')],
        UPLOADER,
        f,
      )

      expect(outcomes.map((o) => o.outcome)).toEqual([
        'stored-not-read',
        'stored-not-read',
        'failed',
        'stored-not-read',
      ])
      expect(f.recorded).toHaveLength(3)
    })

    it('survives a repository failure the same way', async () => {
      const second = file('2.pdf')
      const f = fakes({
        failRecordFor: (document) => document.contentHash === contentHash(second.bytes),
      })

      const outcomes = await ingest([file('1.pdf'), second, file('3.pdf')], UPLOADER, f)

      expect(outcomes.map((o) => o.outcome)).toEqual(['stored-not-read', 'failed', 'stored-not-read'])
    })

    it('carries no message, cause, or stack out of the failure', async () => {
      const f = fakes({ failStoreFor: () => true })

      const [outcome] = await ingest([file('a.pdf')], UPLOADER, f)

      expect(Object.keys(outcome!).sort()).toEqual(['filename', 'outcome'])
    })

    it('hands the error to the caller-supplied reporter, so it is not swallowed', async () => {
      // Not shown to the treasurer, but an operator needs to see it. Silently
      // discarding it would make a storage outage look like bad luck.
      const reported: unknown[] = []
      const f = fakes({ failStoreFor: () => true })

      await ingest([file('a.pdf')], UPLOADER, { ...f, onError: (error) => reported.push(error) })

      expect(reported).toHaveLength(1)
      expect(reported[0]).toBeInstanceOf(Error)
    })
  })

  describe('the shape of the batch', () => {
    it('returns nothing for an empty batch', async () => {
      expect(await ingest([], UPLOADER, fakes())).toEqual([])
    })

    it('returns one outcome per file, in the order given', async () => {
      const f = fakes()
      const files = ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'].map((name) => file(name))

      const outcomes = await ingest(files, UPLOADER, f)

      expect(outcomes.map((o) => o.filename)).toEqual(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'])
    })

    it('keeps outcomes aligned when a rejection sits between accepted files', async () => {
      const f = fakes()
      const files = [
        file('good-1.pdf'),
        file('empty.pdf', new Uint8Array(0)),
        file('good-2.pdf'),
      ]

      const outcomes = await ingest(files, UPLOADER, f)

      expect(outcomes).toMatchObject([
        { filename: 'good-1.pdf', outcome: 'stored-not-read' },
        { filename: 'empty.pdf', outcome: 'rejected', reason: 'empty' },
        { filename: 'good-2.pdf', outcome: 'stored-not-read' },
      ])
    })
  })
})
