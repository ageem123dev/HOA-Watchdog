/**
 * The deferred-extraction endpoint.
 *
 * This is the access-control surface of the whole feature and it does not look
 * like one — it looks like a progress bar. It takes a document id and does
 * expensive, chargeable work against the bytes behind it, so the tests that
 * matter most here are the ones about who may call it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ExtractionOutcome } from '@/core/ingestion/extract-document'

const auth = vi.fn()
const extractDocument = vi.fn()

vi.mock('@/adapters/auth/auth', () => ({ auth: () => auth() }))
vi.mock('@/core/ingestion/extract-document', () => ({
  extractDocument: (...args: unknown[]) => extractDocument(...args),
}))

// The adapters are constructed at module scope. None reads its environment at
// construction — the property `next build` depends on — so importing the route
// here is safe and needs no credentials.
vi.mock('@/adapters/db/document-repository-postgres', () => ({
  createPostgresDocumentRepository: () => ({}),
}))
vi.mock('@/adapters/db/extraction-repository-postgres', () => ({
  createPostgresExtractionRepository: () => ({}),
}))
vi.mock('@/adapters/db/quarantine-postgres', () => ({ createQuarantine: () => ({}) }))
vi.mock('@/adapters/db/vendor-directory-postgres', () => ({ createVendorDirectory: () => ({}) }))
vi.mock('@/adapters/extraction/extractor-gemini', () => ({ createGeminiExtractor: () => ({}) }))
vi.mock('@/adapters/storage/document-store-s3', () => ({ createS3DocumentStore: () => ({}) }))

const { POST } = await import('./route')

const DOCUMENT_ID = '018f3a2b-0000-7000-8000-0000000000aa'

const call = (id: string = DOCUMENT_ID) =>
  POST(new Request('https://example.test/x', { method: 'POST' }), {
    params: Promise.resolve({ id }),
  })

const signedIn = () => auth.mockResolvedValue({ user: { id: 'board-member-1' } })
const answers = (outcome: ExtractionOutcome) => extractDocument.mockResolvedValue(outcome)

beforeEach(() => {
  auth.mockReset()
  extractDocument.mockReset()
  answers({ outcome: 'read', documentId: DOCUMENT_ID, records: 3 })
})

describe('POST /api/documents/[id]/extract', () => {
  describe('who may call it', () => {
    it('refuses an unauthenticated caller', async () => {
      auth.mockResolvedValue(null)

      expect((await call()).status).toBe(401)
    })

    it('extracts nothing for an unauthenticated caller', async () => {
      // The assertion that matters: a 401 with the work already done would have
      // spent the money before refusing.
      auth.mockResolvedValue(null)

      await call()

      expect(extractDocument).not.toHaveBeenCalled()
    })

    it.each([
      ['no user', {}],
      ['no id', { user: {} }],
      ['an empty id', { user: { id: '' } }],
      ['a blank id', { user: { id: '   ' } }],
      ['a non-string id', { user: { id: 42 } }],
    ])('refuses a session with %s', async (_label, session) => {
      // A session callback supplying null or an empty string would pass a loose
      // `!== undefined` check and leave this endpoint open.
      auth.mockResolvedValue(session)

      expect((await call()).status).toBe(401)
      expect(extractDocument).not.toHaveBeenCalled()
    })

    it('allows any signed-in board member, not only the uploader', async () => {
      // A deliberate decision, recorded in the story. Documents belong to the
      // association rather than to whoever happened to upload them, and there is
      // one association in this pilot — `board_member` has no organisation
      // column. Restricting to the uploader would stop a colleague retrying a
      // stuck extraction, which is a real workflow, not a hypothetical.
      //
      // **This becomes wrong the moment a second association exists.** At that
      // point this must scope the document to the caller's association, and this
      // test should fail until it does.
      signedIn()

      expect((await call()).status).toBe(200)
    })
  })

  describe('the document id', () => {
    it.each(['not-a-uuid', '123', '', 'DROP TABLE document'])(
      'refuses %s with 400 rather than letting the database reject it',
      async (id) => {
        // Postgres would refuse a malformed uuid with an error, which would
        // surface as a 500 — a broken server where the honest answer is a bad
        // request.
        signedIn()

        expect((await call(id)).status).toBe(400)
      },
    )

    it('does no work for a malformed id', async () => {
      signedIn()

      await call('not-a-uuid')

      expect(extractDocument).not.toHaveBeenCalled()
    })

    it('passes the id through unchanged', async () => {
      signedIn()

      await call()

      expect(extractDocument).toHaveBeenCalledWith(DOCUMENT_ID, expect.anything())
    })
  })

  describe('what it answers', () => {
    it('reports a successful read with its record count', async () => {
      signedIn()
      answers({ outcome: 'read', documentId: DOCUMENT_ID, records: 3 })

      const response = await call()

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ outcome: 'read', records: 3 })
    })

    it('answers 404 for a document that is not there', async () => {
      signedIn()
      answers({ outcome: 'not-found', documentId: DOCUMENT_ID })

      expect((await call()).status).toBe(404)
    })

    it.each([
      'unreadable',
      'provider-unavailable',
      'in-progress',
      'no-provider-path',
    ] as const)('answers 200 with the state for %s', async (outcome) => {
      // None of these is an application fault. A poller receiving a 5xx for "we
      // could not reach the provider just now" would report a broken server for
      // a condition the server is handling correctly.
      signedIn()
      answers({ outcome, documentId: DOCUMENT_ID })

      const response = await call()

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ outcome })
    })

    it('never returns 5xx for a provider outage', async () => {
      signedIn()
      answers({ outcome: 'provider-unavailable', documentId: DOCUMENT_ID })

      expect((await call()).status).toBeLessThan(500)
    })
  })
})
