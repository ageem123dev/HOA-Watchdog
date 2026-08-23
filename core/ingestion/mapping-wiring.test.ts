/**
 * A remembered mapping reaches the reading (story 5.7, Task 3).
 *
 * ## Why this is a wiring test and not a unit one
 *
 * `applyMapping` already works and `saved.test.ts` already proves the shape key.
 * Neither says anything about whether `ingest` *calls* them — and this project
 * shipped exactly that gap in story 5.2, where an action required a field the
 * form never sent, every gate was green, and nothing rendered the form to find
 * out. `alert-wiring.test.ts`, `payment-wiring.test.ts` and
 * `detection-wiring.test.ts` exist for the same reason.
 *
 * ## The file these tests use
 *
 * A CSV headed `Txn Date,Descr,Amt`. Story 5.2 made a declared kind mandatory
 * and `readRows` refuses a header row that is not the importer's vocabulary, so
 * **this file does not import today**. That refusal is the control: it is what
 * makes "the mapping did something" observable rather than assumed.
 *
 * ## On the words these tests assert
 *
 * `read` and `unreadable` are two of `ingest`'s outcomes; `recorded` is not one
 * of them. The first draft of this file asserted `not.toBe('recorded')` for the
 * refusals, which passes for *every* outcome including success - a guard that
 * proves nothing, which is the defect this project has now found eleven times.
 * Assert the outcome that is expected, never the absence of one that cannot
 * occur.
 */

import { describe, expect, it, vi } from 'vitest'

import { readHeadings } from '../extraction/headings'
import { shapeKey } from '../mapping/saved'
import type { SavedMapping } from '../mapping/saved'
import type { MappingStore } from '../ports/mapping-store'
import { ingest, type IngestDependencies, type IngestibleFile } from './ingest'

const UPLOADER = 'director-1'

/** Headings no importer vocabulary contains, so it fails without a mapping. */
const CSV = 'Txn Date,Descr,Amt\r\n2026-03-01,Willow Creek Landscaping,1240.00\r\n'

const file = (text = CSV): IngestibleFile => ({
  filename: 'deposits.csv',
  contentType: 'text/csv',
  bytes: new TextEncoder().encode(text),
  documentKind: 'deposit',
})

const shapeOf = (text: string) => {
  const rows = text.trim().split(/\r?\n/).map((line) => line.split(','))
  const headings = readHeadings(rows)

  expect(headings.ok, 'the fixture must have readable headings').toBe(true)
  return shapeKey('deposit', headings.ok ? headings.headings : [])
}

const MAPPING: SavedMapping = {
  savedBy: UPLOADER,
  kind: 'deposit',
  shape: shapeOf(CSV),
  mapping: {
    kind: 'deposit',
    columns: 3,
    pairings: [
      { target: 'date', position: 1 },
      { target: 'description', position: 2 },
      { target: 'amount', position: 3 },
    ],
  },
}

function deps(overrides: Partial<IngestDependencies> = {}): IngestDependencies {
  const held = new Set<string>()

  return {
    store: { get: vi.fn(async () => null), put: vi.fn(async () => undefined) },
    repository: {
      findById: vi.fn(async () => null),
      record: vi.fn(async (document: { contentHash: string }) => {
        const alreadyHeld = held.has(document.contentHash)
        held.add(document.contentHash)
        return { id: `doc-${document.contentHash.slice(0, 8)}`, alreadyHeld }
      }),
      markExtractionState: vi.fn(async () => undefined),
      claimForExtraction: vi.fn(async () => undefined),
      releaseExtractionClaim: vi.fn(async () => undefined),
    },
    extractions: { replace: vi.fn(async () => undefined), findByDocument: vi.fn(async () => []) },
    ...overrides,
  } as unknown as IngestDependencies
}

const storeHolding = (mapping: SavedMapping | null): MappingStore => ({
  find: vi.fn(async () => mapping),
  save: vi.fn(async () => null),
})

describe('a file whose columns the importer does not recognise', () => {
  it('does not import when nothing has been mapped', async () => {
    /**
     * The control. Without this, every assertion below could pass against an
     * importer that accepts the file regardless — and the mapping would be
     * decoration.
     */
    const [outcome] = await ingest([file()], UPLOADER, deps())

    expect(outcome?.outcome).toBe('unreadable')
  })

  it('imports when a mapping for its shape has been remembered', async () => {
    const extractions = { replace: vi.fn(async () => undefined), findByDocument: vi.fn(async () => []) }

    const [outcome] = await ingest([file()], UPLOADER, {
      ...deps({ extractions } as Partial<IngestDependencies>),
      mappings: storeHolding(MAPPING),
    } as IngestDependencies)

    expect(outcome?.outcome).toBe('read')
    // The rows reached extraction, which is what "imported" means here.
    expect(extractions.replace).toHaveBeenCalledTimes(1)
  })

  it('asks the store for the uploader, not for an association the caller named', async () => {
    // 3d, and it is the tenancy control: `document-repository-postgres.ts` says
    // the association "is read from the uploader rather than passed in, so a
    // caller cannot supply the wrong one".
    const mappings = storeHolding(MAPPING)

    await ingest([file()], UPLOADER, { ...deps(), mappings } as IngestDependencies)

    expect(mappings.find).toHaveBeenCalledWith(UPLOADER, 'deposit', MAPPING.shape)
  })
})

describe('when the mapping cannot help', () => {
  it('imports as it did before when no store is supplied', async () => {
    // 3b. An unconfigured deploy must behave exactly as it does today — and a
    // file the importer already understands must not need a mapping at all.
    const standard = 'date,description,amount\r\n2026-03-01,Willow Creek,1240.00\r\n'

    const [outcome] = await ingest([file(standard)], UPLOADER, deps())

    expect(outcome?.outcome).toBe('read')
  })

  it('does not fail the upload when the store throws', async () => {
    /**
     * 3c. A store that is down must not take the upload with it. The file then
     * reads as it would with no mapping — which for these headings is a refusal,
     * not a wrong import. The safe direction: the treasurer is told their file
     * could not be read, rather than having it read under no mapping and
     * silently producing nothing.
     */
    const mappings: MappingStore = {
      find: vi.fn(async () => {
        throw new Error('the database said no')
      }),
      save: vi.fn(async () => null),
    }

    const [outcome] = await ingest([file()], UPLOADER, { ...deps(), mappings } as IngestDependencies)

    expect(outcome?.outcome).toBe('unreadable')
  })

  it('does not apply a mapping saved for a different shape', async () => {
    /**
     * 3a — the disaster case. A mapping is *positions*, so one applied to a file
     * whose columns sit elsewhere reads every value into the wrong field, and
     * every value is still plausible. The store here answers `null` because the
     * shape does not match, which is what the lookup is for.
     */
    const reordered = 'Descr,Txn Date,Amt\r\n Willow Creek,2026-03-01,1240.00\r\n'

    const [outcome] = await ingest([file(reordered)], UPLOADER, {
      ...deps(),
      mappings: storeHolding(null),
    } as IngestDependencies)

    expect(outcome?.outcome).toBe('unreadable')
  })

  it('never looks up a mapping for a document that is not a rectangle', async () => {
    // 3g. A scanned PDF has no heading row, so there is nothing to key on and
    // nothing a mapping could do.
    const mappings = storeHolding(MAPPING)

    await ingest(
      [
        {
          filename: 'scan.pdf',
          contentType: 'application/pdf',
          bytes: new TextEncoder().encode('%PDF-1.4 not really'),
          documentKind: 'invoice',
        },
      ],
      UPLOADER,
      { ...deps(), mappings } as IngestDependencies,
    )

    expect(mappings.find).not.toHaveBeenCalled()
  })
})
