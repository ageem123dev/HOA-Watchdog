/**
 * Re-importing what a mapping change affects (story 5.7, Task 4 — AC4, AC7).
 *
 * ## The constraint this file exists to hold
 *
 * AD-13: *"Exactly one component owns creation of each derived entity; a second
 * write path for the same entity is a violation."* The story names a re-import
 * as the textbook temptation to write one.
 *
 * So `reimport` writes nothing. It fetches bytes and calls `ingest`, which
 * already re-reads and replaces — and these tests call the **real `ingest`**
 * with fakes beneath it, never a stub of it. A test asserting that `reimport`
 * called some collaborator would prove only that I wired my own function to
 * itself; it would pass just as well against a `reimport` that wrote derived
 * rows on the side.
 *
 * ## What a document's derived records are, here
 *
 * `extractions.replace(documentId, records)` is AD-13's other half. These tests
 * read the *last* call for a document, because "replaced, not appended" is the
 * claim — a re-import that appended would show two calls whose records both
 * survive, which is what `replace` exists to prevent.
 */

import { describe, expect, it, vi } from 'vitest'

import { ingest, type IngestDependencies } from '../ingestion/ingest'
import type { MappingStore } from '../ports/mapping-store'
import type { Reimportable, ReimportCandidates } from '../ports/reimport-candidates'
import type { SavedMapping } from './saved'
import { shapeKey } from './saved'
import { readHeadings } from '../extraction/headings'
import { previewReimport, reimport } from './reimport'

const TREASURER = 'director-1'

/** The export the treasurer mapped. Non-standard headings, so it needs one. */
const MAPPED = 'Txn Date,Descr,Amt\r\n2026-03-01,Willow Creek Landscaping,1240.00\r\n'
/** A different shape entirely — same kind, same association, must not be touched. */
const OTHER = 'Posted,Memo,Debit,Balance\r\n2026-03-02,Sparkle Pools,880.00,4000.00\r\n'

const shapeOf = (text: string) => {
  const rows = text.trim().split(/\r?\n/).map((line) => line.split(','))
  const headings = readHeadings(rows)

  expect(headings.ok, 'fixture must have readable headings').toBe(true)
  return shapeKey('deposit', headings.ok ? headings.headings : [])
}

const MAPPING: SavedMapping = {
  savedBy: TREASURER,
  kind: 'deposit',
  shape: shapeOf(MAPPED),
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

const doc = (id: string, filename: string): Reimportable => ({
  id,
  storageKey: `key/${id}`,
  filename,
  contentType: 'text/csv',
})

interface Harness {
  readonly deps: IngestDependencies
  readonly candidates: ReimportCandidates
  readonly replaced: { documentId: string; count: number; records: readonly unknown[] }[]
  readonly fetched: string[]
}

function harness(
  held: readonly Reimportable[],
  bytesFor: Record<string, string>,
  mapping: SavedMapping | null = MAPPING,
): Harness {
  const replaced: { documentId: string; count: number; records: readonly unknown[] }[] = []
  const fetched: string[] = []

  const mappings: MappingStore = {
    // Matched by shape, exactly as an upload is. A store that answered the same
    // mapping for every shape would make 4c unobservable.
    find: vi.fn(async (_who: string, _kind: string, shape: string) =>
      mapping && shape === mapping.shape ? mapping : null,
    ),
    save: vi.fn(async () => ({ replaced: false, previous: null })),
  }

  const deps = {
    mappings,
    store: {
      get: vi.fn(async (key: string) => {
        fetched.push(key)
        const text = bytesFor[key]
        return text === undefined ? null : new TextEncoder().encode(text)
      }),
      put: vi.fn(async () => undefined),
    },
    repository: {
      findById: vi.fn(async () => null),
      record: vi.fn(async () => ({ id: 'doc-x', alreadyHeld: true })),
      markExtractionState: vi.fn(async () => undefined),
      claimForExtraction: vi.fn(async () => undefined),
      releaseExtractionClaim: vi.fn(async () => undefined),
    },
    extractions: {
      // The records themselves, not their count. A cross-check comparing lengths
      // passes when two paths produce the same number of wrong rows - which is
      // exactly the failure a re-import can have. Raised by CodeRabbit.
      replace: vi.fn(async (documentId: string, records: readonly unknown[]) => {
        replaced.push({ documentId, count: records.length, records })
      }),
      findByDocument: vi.fn(async () => []),
    },
  } as unknown as IngestDependencies

  return {
    deps,
    candidates: { importedUnder: vi.fn(async () => held) },
    replaced,
    fetched,
  }
}

const run = (h: Harness) =>
  reimport(TREASURER, 'deposit', MAPPING.shape, { ...h.deps, ingest, candidates: h.candidates })

describe('a mapping change re-imports what it affects', () => {
  it('re-reads a document imported under the changed shape', async () => {
    const h = harness([doc('a', 'march.csv')], { 'key/a': MAPPED })

    const outcomes = await run(h)

    expect(outcomes).toEqual([{ documentId: 'a', filename: 'march.csv', outcome: 're-imported' }])
    expect(h.fetched).toEqual(['key/a'])
  })

  it('replaces the derived rows through the component that already owns them', async () => {
    /**
     * AC4, and the structural half is in `reimport-boundary.test.ts`. This is
     * the behavioural half: the records reach `extractions.replace`, which is
     * AD-13's other half — reached by calling the real `ingest`, not by
     * `reimport` writing anything.
     */
    const h = harness([doc('a', 'march.csv')], { 'key/a': MAPPED })

    await run(h)

    expect(h.replaced).toMatchObject([{ documentId: 'doc-x', count: 1 }])
  })

  it('leaves a document of a different shape alone', async () => {
    /**
     * 4c, and it is the one that would corrupt data rather than waste time. The
     * other document shares the association *and* the kind — only its heading
     * row differs, which is the whole basis on which a mapping applies.
     */
    const h = harness([doc('a', 'march.csv'), doc('b', 'other-bank.csv')], {
      'key/a': MAPPED,
      'key/b': OTHER,
    })

    const outcomes = await run(h)

    expect(outcomes).toEqual([
      { documentId: 'a', filename: 'march.csv', outcome: 're-imported' },
      { documentId: 'b', filename: 'other-bank.csv', outcome: 'unaffected' },
    ])
    // The decisive assertion: nothing was rewritten for `b`.
    expect(h.replaced.map((r) => r.documentId)).toEqual(['doc-x'])
  })

  it('asks for candidates as the member, never as an association', async () => {
    // 4b. A re-import scoped to the wrong association rewrites another board's
    // history through the one path whose job is rewriting history.
    const h = harness([], {})

    await run(h)

    expect(h.candidates.importedUnder).toHaveBeenCalledWith(TREASURER, 'deposit')
  })
})

describe('one document going wrong does not take the others with it', () => {
  it('reports missing bytes and keeps going', async () => {
    /**
     * 4e. Object storage can lose a key — a lifecycle rule, a failed upload, a
     * key written wrong. The document that follows must still be re-imported,
     * and the one that failed must not be reported as done.
     */
    const h = harness([doc('gone', 'lost.csv'), doc('a', 'march.csv')], { 'key/a': MAPPED })

    const outcomes = await run(h)

    expect(outcomes).toEqual([
      { documentId: 'gone', filename: 'lost.csv', outcome: 'bytes-missing' },
      { documentId: 'a', filename: 'march.csv', outcome: 're-imported' },
    ])
  })

  it('reports a document whose bytes no longer read, and keeps going', async () => {
    // 4f. Not the same as missing: the bytes are there and do not parse.
    const h = harness([doc('bad', 'corrupt.csv'), doc('a', 'march.csv')], {
      'key/bad': '',
      'key/a': MAPPED,
    })

    const outcomes = await run(h)

    expect(outcomes[0]).toEqual({
      documentId: 'bad',
      filename: 'corrupt.csv',
      outcome: 'unreadable',
    })
    expect(outcomes[1]?.outcome).toBe('re-imported')
  })

  it('reports a storage failure rather than aborting the batch', async () => {
    const h = harness([doc('a', 'march.csv'), doc('b', 'april.csv')], {
      'key/a': MAPPED,
      'key/b': MAPPED,
    })
    let call = 0
    h.deps.store.get = vi.fn(async (key: string) => {
      if (++call === 1) throw new Error('object storage said no')
      return new TextEncoder().encode(key === 'key/b' ? MAPPED : OTHER)
    })

    const outcomes = await run(h)

    expect(outcomes[0]?.outcome).toBe('failed')
    expect(outcomes[1]?.outcome).toBe('re-imported')
  })

  it('never reports a document it skipped as one it re-imported', async () => {
    /**
     * 4g. The failure this catches is a summary: a caller that cannot tell
     * "re-imported" from "left alone" from "could not read" would show a
     * treasurer one number and let them believe every document was rewritten.
     * AC7 says the outcome is reported per document, not summarised into a
     * single "done".
     */
    const h = harness([doc('a', 'march.csv'), doc('b', 'other.csv'), doc('gone', 'lost.csv')], {
      'key/a': MAPPED,
      'key/b': OTHER,
    })

    const outcomes = await run(h)

    expect(outcomes).toHaveLength(3)
    expect(new Set(outcomes.map((o) => o.outcome))).toEqual(
      new Set(['re-imported', 'unaffected', 'bytes-missing']),
    )
  })
})

describe('the warning before the act (AC6)', () => {
  const preview = (h: Harness) =>
    previewReimport(TREASURER, 'deposit', MAPPING.shape, {
      ...h.deps,
      ingest,
      candidates: h.candidates,
    })

  it('counts what would be re-read, separately from what is merely held', async () => {
    const h = harness([doc('a', 'march.csv'), doc('b', 'other-bank.csv')], {
      'key/a': MAPPED,
      'key/b': OTHER,
    })

    expect(await preview(h)).toEqual({ considered: 2, affected: 1, unreadable: 0 })
  })

  it('counts a document it cannot reach rather than passing over it', async () => {
    /**
     * A treasurer told "1 will be re-read" and nothing else would never learn
     * that a second document is unreachable - and this is the moment they are
     * deciding, so it is the moment the fact is worth something. Silence here
     * reads as zero.
     */
    const h = harness([doc('a', 'march.csv'), doc('gone', 'lost.csv')], { 'key/a': MAPPED })

    expect(await preview(h)).toEqual({ considered: 2, affected: 1, unreadable: 1 })
  })

  it('counts a document whose storage throws, instead of failing the whole warning', async () => {
    /**
     * `reimport` catches per document; `previewReimport` did not, so one
     * unreachable object took down the count for every other document - and the
     * treasurer got an error where they were owed a number. The asymmetry is
     * exactly the kind that survives review because both functions read
     * correctly on their own. Raised by CodeRabbit.
     */
    const h = harness([doc('a', 'march.csv'), doc('b', 'april.csv')], {
      'key/a': MAPPED,
      'key/b': MAPPED,
    })
    let call = 0
    h.deps.store.get = vi.fn(async () => {
      if (++call === 1) throw new Error('object storage said no')
      return new TextEncoder().encode(MAPPED)
    })

    expect(await preview(h)).toEqual({ considered: 2, affected: 1, unreadable: 1 })
  })

  it('promises exactly what the re-import then does', async () => {
    /**
     * The anti-drift assertion, and the reason `classify` is shared rather than
     * copied. The preview is what the treasurer consents to; a run that
     * re-imported a different number than the one they agreed to would be the
     * worst place in this story for the duplicated-rule defect to land.
     *
     * Two harnesses, because the run mutates its own world - the same documents,
     * the same bytes, the same mapping.
     */
    const documents = [doc('a', 'march.csv'), doc('b', 'other-bank.csv'), doc('gone', 'lost.csv')]
    const bytes = { 'key/a': MAPPED, 'key/b': OTHER }

    const promised = await preview(harness(documents, bytes))
    const done = await run(harness(documents, bytes))

    expect(done.filter((outcome) => outcome.outcome === 're-imported')).toHaveLength(
      promised.affected,
    )
    expect(done).toHaveLength(promised.considered)
    // And the promise was not the trivial one: something was, and something was not.
    expect(promised.affected).toBeGreaterThan(0)
    expect(promised.affected).toBeLessThan(promised.considered)
  })

  it('reads nothing back into the system', async () => {
    // A preview that re-imported as a side effect would rewrite history the
    // treasurer has not yet agreed to rewrite - the whole point of asking first.
    const h = harness([doc('a', 'march.csv')], { 'key/a': MAPPED })

    await preview(h)

    expect(h.replaced).toEqual([])
  })
})

describe('the point of the whole thing: the new mapping is what gets applied', () => {
  /**
   * **The integration pass found this missing.** Every test above proves the
   * re-import *ran* - documents fetched, `extractions.replace` reached, outcomes
   * reported. None proved it re-parsed under the **changed** mapping, which is
   * the entire content of AC4.
   *
   * That gap is invisible per task. Task 4 owns "re-import the affected
   * documents" and Task 3 owns "an upload applies the saved mapping"; the
   * re-import gets its parse from Task 3's code, by calling `ingest`. If that
   * lookup returned a stale mapping, every assertion in this file would still
   * pass - the same number of records would be written to the same document, and
   * they would all be wrong in the same way as before.
   *
   * A four-column file with two plausible money columns is what makes the
   * difference observable: only the amount moves.
   */
  const FOUR =
    'Txn Date,Descr,Amt,Fee\r\n2026-03-01,Willow Creek Landscaping,1240.00,35.00\r\n'

  const mappingFor = (amountColumn: number): SavedMapping => ({
    savedBy: TREASURER,
    kind: 'deposit',
    shape: shapeOf(FOUR),
    mapping: {
      kind: 'deposit',
      columns: 4,
      pairings: [
        { target: 'date', position: 1 },
        { target: 'description', position: 2 },
        { target: 'amount', position: amountColumn },
      ],
    },
  })

  const amountsUnder = async (mapping: SavedMapping) => {
    const h = harness([doc('a', 'march.csv')], { 'key/a': FOUR })
    // The store answers with this mapping for the file's shape, which is what
    // `ingest` consults on the way back in. Passed rather than assigned:
    // `IngestDependencies.mappings` is readonly, and casting past that would be
    // working around the contract in order to test it.
    const mappings = {
      find: vi.fn(async (_who: string, _kind: string, shape: string) =>
        shape === mapping.shape ? mapping : null,
      ),
      save: vi.fn(async () => ({ replaced: false, previous: null })),
    }

    await reimport(TREASURER, 'deposit', mapping.shape, {
      ...h.deps,
      mappings,
      ingest,
      candidates: h.candidates,
    })

    return h.replaced.flatMap((call) =>
      // `totalAmount`, a decimal string — never a number. `record.ts` is
      // explicit that a binary float cannot represent an association's ledger.
      call.records.map((record) => (record as { totalAmount?: unknown }).totalAmount),
    )
  }

  it('reads the column the current mapping names, not the one it used to', async () => {
    const underAmt = await amountsUnder(mappingFor(3))
    const underFee = await amountsUnder(mappingFor(4))

    // Both re-imports produced records — otherwise the comparison below is two
    // empty lists agreeing with each other.
    expect(underAmt.length).toBeGreaterThan(0)
    expect(underFee.length).toBe(underAmt.length)

    // And the figures moved with the mapping, which is the whole of AC4.
    expect(underAmt).not.toEqual(underFee)
    expect(String(underAmt[0])).toContain('1240')
    expect(String(underFee[0])).toContain('35')
  })
})

describe('the cross-check', () => {
  it('produces what a fresh upload of the same bytes under the mapping produces', async () => {
    /**
     * The integration agreeing with the path it claims to be reusing. If these
     * two ever disagree, the re-import has grown a second reading — which is the
     * AD-13 violation, arriving quietly rather than as a new file.
     */
    const viaReimport = harness([doc('a', 'march.csv')], { 'key/a': MAPPED })
    await run(viaReimport)

    const viaUpload = harness([], {})
    await ingest(
      [
        {
          filename: 'march.csv',
          contentType: 'text/csv',
          bytes: new TextEncoder().encode(MAPPED),
          documentKind: 'deposit',
        },
      ],
      TREASURER,
      viaUpload.deps,
    )

    expect(viaReimport.replaced).toEqual(viaUpload.replaced)
    expect(viaReimport.replaced.length).toBeGreaterThan(0)
  })
})
