/**
 * Payments are written before the extraction that settles the document.
 *
 * The order is load-bearing and the argument is the one `holdUnknownVendors`
 * already makes: `extractions.replace` moves the document to `read`, and a
 * document that is `read` is never looked at again. So payments missing after
 * that write is silent and permanent, while payments missing *before* it leaves
 * the document unsettled, re-read by the next poll, and healed. AD-13 makes the
 * retry safe — `PaymentRepository.replace` is set-replacement, so a second pass
 * writes the same set rather than a second copy of it.
 *
 * Asserted by making the extraction write fail and checking the payment write
 * already happened. Order asserted by consequence rather than by reading the
 * source: a comment saying "call this first" is not a constraint on anything.
 */

import { describe, expect, it, vi } from 'vitest'

import type { ExtractionRecord } from '../extraction/record'
import type { DocumentRepository } from '../ports/document-repository'
import type { DocumentStore } from '../ports/document-store'
import type { ExtractionRepository } from '../ports/extraction-repository'
import type { Extractor } from '../ports/extractor'
import type { PaymentRepository } from '../ports/payment-repository'
import type { Quarantine } from '../ports/quarantine'
import type { UnitDirectory } from '../ports/unit-directory'
import type { VendorDirectory } from '../ports/vendor-directory'
import { extractDocument } from './extract-document'

const DEPOSIT: ExtractionRecord = {
  documentKind: 'deposit',
  vendorName: null,
  documentNumber: null,
  issuedOn: '2026-03-01',
  totalAmount: '250.00',
  currency: 'USD',
  unitReference: '4B',
}

const SCAN = new TextEncoder().encode('%PDF-1.7 deposit slip %%EOF')

/** Everything `extractDocument` needs, with the extraction write set to fail. */
function harness(options: { extractionFails: boolean; unitReference?: string }) {
  const order: string[] = []

  const repository = {
    findById: vi.fn(async () => ({
      id: 'doc-1',
      storageKey: 'documents/abc',
      contentType: 'application/pdf',
      extractionState: 'held' as const,
    })),
    claimForExtraction: vi.fn(async () => ({ documentId: 'doc-1', token: 'token-1' })),
    releaseExtractionClaim: vi.fn(async () => undefined),
    markExtractionState: vi.fn(async () => undefined),
  } as unknown as DocumentRepository

  const store = { get: vi.fn(async () => SCAN), put: vi.fn() } as unknown as DocumentStore

  const extractions = {
    replace: vi.fn(async () => {
      order.push('extractions.replace')
      if (options.extractionFails) throw new Error('database said no')
    }),
    findByDocument: vi.fn(async () => []),
  } as unknown as ExtractionRepository

  const extractor = {
    extract: vi.fn(async () => ({
      ok: true as const,
      records: [{ ...DEPOSIT, unitReference: options.unitReference ?? DEPOSIT.unitReference }],
    })),
  } as unknown as Extractor

  const vendors = {
    resolve: vi.fn(async () => ({ outcome: 'resolved' as const, vendorId: 'v-1' })),
    suggest: vi.fn(),
  } as unknown as VendorDirectory

  const quarantine = { hold: vi.fn(), heldNames: vi.fn() } as unknown as Quarantine

  const units = {
    unitIdsFor: vi.fn(async () => new Map([['4B', 'unit-4b']]) as ReadonlyMap<string, string>),
  } as unknown as UnitDirectory

  const payments = {
    replace: vi.fn(async () => {
      order.push('payments.replace')
    }),
  } as unknown as PaymentRepository

  return {
    deps: { repository, store, extractions, extractor, vendors, quarantine, units, payments },
    order,
    payments,
    extractions,
  }
}

describe('the order the two writes happen in', () => {
  it('writes the payments before the extraction that settles the document', async () => {
    const { deps, order } = harness({ extractionFails: false })

    await extractDocument('doc-1', deps)

    expect(order).toEqual(['payments.replace', 'extractions.replace'])
  })

  it('has already written the payments when the extraction write fails', async () => {
    // The consequence that makes the order matter. The document stays unsettled,
    // so the next poll re-reads it; the payments it wrote are replaced rather
    // than duplicated, because `replace` is set-replacement.
    const { deps, order } = harness({ extractionFails: true })

    const result = await extractDocument('doc-1', deps)

    expect(order).toEqual(['payments.replace', 'extractions.replace'])
    // Not `read` — nothing may report success when the records were not stored.
    expect(result.outcome).toBe('provider-unavailable')
  })

  it('does not settle the document as read when the extraction write failed', async () => {
    const { deps } = harness({ extractionFails: true })

    const result = await extractDocument('doc-1', deps)

    expect(result.outcome).not.toBe('read')
  })

  it('refuses the document when the provider returns a reference the tables cannot store', async () => {
    // Where the storability guard actually bites. The CSV path never gets here
    // -- `assess` refuses an upload containing a NUL outright -- but a scan is
    // a valid PDF and the model supplies the reference, so nothing upstream has
    // looked at it.
    //
    // `text` cannot hold a NUL: as a parameter it raises 22021, which aborts the
    // transaction and takes every payment in the document with it, and reports
    // as an outage rather than a bad document -- so it would be retried forever.
    // Migration 017's shape for the fourth time this epic. Raised by review,
    // which noticed `unitIdsFor` refused to *send* one while nothing stopped it
    // being *stored*.
    const { deps, order } = harness({ extractionFails: false, unitReference: `4B${'\u0000'}` })

    const result = await extractDocument('doc-1', deps)

    expect(result.outcome).toBe('unreadable')
    // Nothing written, to either table -- the refusal happens before the writes.
    expect(order).toEqual([])
  })

  it('fences the payment write with the claim it is holding', async () => {
    // The call site half of the fix. The repository can only refuse a stale run
    // if the caller actually hands it the token -- and this write happens before
    // the fenced extraction write, so nothing else would catch it.
    const { deps, payments } = harness({ extractionFails: false })

    await extractDocument('doc-1', deps)

    const call = (payments.replace as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!
    expect(call[2]).toEqual({ token: 'token-1' })
  })
})
