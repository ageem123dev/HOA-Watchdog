/**
 * The quarantine rule on the upload-time path.
 *
 * A spreadsheet's extraction finishes here, in `ingest`, rather than in
 * `extract-document`. Epic story 1.6's AC1 is about extraction *completing*,
 * not about which parser did it — so until this existed, uploading the invoices
 * as CSV was a way to put vendors into the system with nobody asked about them.
 * Found by review of story 1.6b, against a test of mine that had recorded the
 * bypass as intended behaviour.
 *
 * A file of its own because `ingest.test.ts` deliberately throws from
 * `extractions.replace` — every file in that suite is a PDF or a rejection, and
 * throwing proves nothing reaches extraction. This suite needs the opposite.
 */

import { describe, expect, it, vi } from 'vitest'

import { ingest } from './ingest'
import type { ExtractionRecord } from '../extraction/record'
import type { DocumentRepository } from '../ports/document-repository'
import type { DocumentStore } from '../ports/document-store'
import type { ExtractionRepository } from '../ports/extraction-repository'
import type { Quarantine } from '../ports/quarantine'
import type { VendorDirectory } from '../ports/vendor-directory'

const UPLOADER = '018f3a2b-0000-7000-8000-0000000000ee'
const KNOWN = 'Evergreen Landscaping'

/**
 * The columns `core/extraction/tabular.ts` actually reads: `description` is the
 * vendor and `type` the document kind. The first draft of this fixture invented
 * column names, so every row failed validation and the suite reported
 * `unreadable` for reasons that had nothing to do with quarantine.
 */
const csv = (vendor: string) => ({
  documentKind: 'invoice' as const,
  filename: 'invoices.csv',
  contentType: 'text/csv',
  bytes: new TextEncoder().encode(
    [
      'description,reference,date,amount',
      `"${vendor}",INV-1,2026-06-01,1450.00`,
      '',
    ].join('\n'),
  ),
})

function harness(options: { known?: string[]; holdThrows?: boolean } = {}) {
  const replaced: { documentId: string; records: readonly ExtractionRecord[] }[] = []
  const quarantined: { documentId: string; extractedName: string }[] = []
  const resolved: string[] = []
  const recognised = new Set((options.known ?? []).map((name) => name.trim().toLowerCase()))

  const store: DocumentStore = {
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
  } as unknown as DocumentStore

  const repository: DocumentRepository = {
    record: vi.fn(async () => ({ id: 'doc-1', alreadyHeld: false })),
    findById: vi.fn(async () => null),
    markExtractionState: vi.fn(async () => undefined),
    claimForExtraction: vi.fn(async () => null),
    releaseExtractionClaim: vi.fn(async () => undefined),
  } as unknown as DocumentRepository

  const extractions: ExtractionRepository = {
    replace: vi.fn(async (documentId: string, records: readonly ExtractionRecord[]) => {
      replaced.push({ documentId, records })
    }),
    findByDocument: vi.fn(async () => []),
  }

  const vendors: VendorDirectory = {
    resolve: vi.fn(async (extractedName: string) => {
      resolved.push(extractedName)
      return recognised.has(extractedName.trim().toLowerCase())
        ? ({ outcome: 'resolved', vendorId: 'known' } as const)
        : ({ outcome: 'unresolved' } as const)
    }),
    suggest: vi.fn(async () => {
      throw new Error('suggest ranks candidates for a human; ingestion must not reach it')
    }),
  }

  const quarantine: Quarantine = {
    hold: vi.fn(async (documentId: string, extractedName: string) => {
      if (options.holdThrows) throw new Error('quarantine said no')
      quarantined.push({ documentId, extractedName })
    }),
    heldNames: vi.fn(async () => quarantined.map((item) => item.extractedName)),
  }

  return { store, repository, extractions, vendors, quarantine, replaced, quarantined, resolved }
}

describe('a spreadsheet whose vendor nobody recognises', () => {
  it('holds it rather than storing the vendor unasked', async () => {
    const f = harness({ known: [KNOWN] })

    await ingest([csv('Someone Unheard Of')], UPLOADER, f)

    expect(f.quarantined.map((item) => item.extractedName)).toEqual(['Someone Unheard Of'])
  })

  it('holds nothing when the vendor is recognised', async () => {
    // Beside the case above on purpose: alone, "nothing was held" passes just
    // as happily against code that never asks.
    const f = harness({ known: [KNOWN] })

    await ingest([csv(KNOWN)], UPLOADER, f)

    expect(f.resolved).toEqual([KNOWN])
    expect(f.quarantined).toEqual([])
  })

  it('asks about the vendor at all', async () => {
    // The regression test for the gap itself. This path stored records without
    // ever asking, and nothing in the suite said so.
    const f = harness()

    await ingest([csv('Anybody At All')], UPLOADER, f)

    expect(f.resolved).toEqual(['Anybody At All'])
  })

  it('holds before it stores, so a failed hold leaves nothing behind', async () => {
    // The same ordering argument as the deferred path: records stored with the
    // hold still missing is silent, and a hold with nothing stored is retryable.
    const f = harness({ known: [KNOWN], holdThrows: true })

    const [outcome] = await ingest([csv('Someone Unheard Of')], UPLOADER, f)

    expect(outcome?.outcome).toBe('figures-not-stored')
    expect(f.replaced).toEqual([])
  })

  it('still stores the figures of a document it held', async () => {
    // Holding is not withholding. The figures were read and they are kept;
    // what waits is who the vendor is.
    const f = harness({ known: [KNOWN] })

    await ingest([csv('Someone Unheard Of')], UPLOADER, f)

    expect(f.replaced).toHaveLength(1)
  })

  it('refuses a NUL that arrives past the acceptance scan', async () => {
    // Reachable, and I removed the guard for this once on the reasoning that
    // upload acceptance rejects a NUL-bearing file. It does not: acceptance.ts
    // scans `bytes.subarray(0, 8192)` only, so a NUL further into a large
    // spreadsheet arrives here untouched. A decoded workbook cell can carry one
    // with no NUL in the file bytes at all.
    //
    // Left unguarded it reaches `vendors.resolve`, Postgres refuses the
    // parameter with 22021, and the upload reports `figures-not-stored` -- which
    // tells the treasurer their figures were not saved rather than that the
    // document could not be read. Raised in review, twice.
    const filler = Array.from(
      { length: 200 },
      (_unused, index) => `"Filler Vendor ${index}",INV-${index},2026-06-01,10.00`,
    )
    const rows = [
      'description,reference,date,amount',
      ...filler,
      '"Late\u0000Vendor",INV-X,2026-06-01,1450.00',
      '',
    ].join('\n')

    expect(new TextEncoder().encode(rows).indexOf(0)).toBeGreaterThan(8192)

    const f = harness({ known: [KNOWN] })
    const [outcome] = await ingest(
      [{ documentKind: 'statement', filename: 'big.csv', contentType: 'text/csv', bytes: new TextEncoder().encode(rows) }],
      UPLOADER,
      f,
    )

    expect(outcome?.outcome).toBe('unreadable')
    expect(f.replaced).toEqual([])
    expect(f.quarantined).toEqual([])
  })
})
