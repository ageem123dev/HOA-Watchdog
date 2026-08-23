/**
 * Re-importing the documents a mapping change affects (story 5.7, AC4 and AC7).
 *
 * ## This module writes nothing
 *
 * AD-13: *"Exactly one component owns creation of each derived entity; a second
 * write path for the same entity is a violation."* The story names a re-import
 * as the textbook temptation to write one, and it is: every ingredient is here —
 * the documents, their bytes, the new mapping — and replacing their rows
 * directly would be a dozen lines.
 *
 * So this is not a writer. It fetches bytes and hands them to `ingest`, which
 * already re-reads and replaces: re-ingesting the same bytes calls
 * `extractions.replace(id, records)`, and `alreadyHeld` short-circuits *only* in
 * the `no-reader` branch. The re-import is the existing read-and-replace
 * triggered by a different event, and nothing more.
 *
 * `reimport-boundary.test.ts` asserts that structurally, because this paragraph
 * is prose and prose does not hold.
 *
 * ## How "affected" is decided
 *
 * Per document, from that document's own bytes. `importedUnder` returns every
 * document of the kind for the association; this re-derives each one's heading
 * shape and re-imports only those matching the shape whose mapping changed.
 *
 * Recording the shape at ingest time and querying it would be cheaper and would
 * be wrong: it is absent for every document imported before this story, which is
 * exactly the set most likely to need re-importing. The bytes must be fetched to
 * re-import anyway, so deriving the shape from them costs one parse.
 *
 * ## Per document, never per batch
 *
 * AC7. Each document is fully re-imported or untouched — which `ingest` already
 * guarantees, since `replace` is one transaction per document — and each gets
 * its own outcome. Nothing here aggregates: a treasurer shown a single "done"
 * would believe documents were rewritten that were skipped, and `bytes-missing`
 * on one document must not cost the next one its re-import.
 */

import { readHeadings } from '../extraction/headings'
import { toRectangle } from '../extraction/rectangle'
import type { IngestDependencies, IngestibleFile, IngestOutcome } from '../ingestion/ingest'
import type { DocumentKind } from '../extraction/record'
import type { ReimportCandidates } from '../ports/reimport-candidates'
import { shapeKey } from './saved'

/**
 * What happened to one document.
 *
 * Five words, because collapsing any two of them loses something a treasurer
 * needs. `unaffected` is a decision — this document's columns are not the ones
 * that changed — while `bytes-missing` and `unreadable` are failures to be
 * chased, and neither is `re-imported`.
 */
export type ReimportResult =
  | 're-imported'
  | 'unaffected'
  | 'bytes-missing'
  | 'unreadable'
  | 'failed'

export interface ReimportOutcome {
  readonly documentId: string
  readonly filename: string
  readonly outcome: ReimportResult
}

export interface ReimportDependencies extends IngestDependencies {
  readonly candidates: ReimportCandidates
  /**
   * `ingest` itself, injected so this module cannot be tested against a stub of
   * the very thing it exists to delegate to. The tests pass the real function.
   */
  readonly ingest: (
    files: readonly IngestibleFile[],
    uploadedBy: string,
    deps: IngestDependencies,
  ) => Promise<IngestOutcome[]>
}

export async function reimport(
  uploadedBy: string,
  kind: DocumentKind,
  shape: string,
  deps: ReimportDependencies,
): Promise<readonly ReimportOutcome[]> {
  const held = await deps.candidates.importedUnder(uploadedBy, kind)
  const outcomes: ReimportOutcome[] = []

  // Sequential, matching `ingest`'s own reason for being sequential: these
  // writes land on the same documents' derived rows, and interleaving them
  // gains nothing a treasurer waiting on a handful of statements would notice.
  for (const document of held) {
    outcomes.push({
      documentId: document.id,
      filename: document.filename,
      outcome: await one(document, uploadedBy, kind, shape, deps),
    })
  }

  return outcomes
}

async function one(
  document: { readonly storageKey: string; readonly filename: string; readonly contentType: string },
  uploadedBy: string,
  kind: DocumentKind,
  shape: string,
  deps: ReimportDependencies,
): Promise<ReimportResult> {
  try {
    const bytes = await deps.store.get(document.storageKey)
    // Not an exception. A key object storage does not have is a fact about this
    // document, and the batch continues — reported so it can be chased, never
    // folded into `unaffected`, which would say the mapping simply did not apply.
    if (bytes === null) return 'bytes-missing'

    const rectangle = toRectangle(document.contentType, bytes, deps.workbooks)
    if (!rectangle.ok) return 'unreadable'

    const headings = readHeadings(rectangle.rows)
    if (!headings.ok) return 'unreadable'

    // The shape is re-derived from these bytes and compared to the shape whose
    // mapping changed. This is the whole of 4c: a document sharing the
    // association and the kind but not the heading row is not affected, and
    // re-importing it would apply a mapping built for somebody else's columns.
    if (shapeKey(kind, headings.headings) !== shape) return 'unaffected'

    const [outcome] = await deps.ingest(
      [{ filename: document.filename, contentType: document.contentType, bytes, documentKind: kind }],
      uploadedBy,
      deps,
    )

    /**
     * **`already-held` is the success case here, and that reads wrong until you
     * follow it.** `ingest` calls `extractions.replace` and only afterwards
     * returns `already-held` for a document it had seen before - the replace is
     * at ingest.ts:293, the return at ingest.ts:361. The word is addressed to
     * someone uploading a file they already uploaded; for a re-import, whose
     * bytes are by definition already held, it means the rows were re-read and
     * replaced. My first version accepted only `read` and reported every
     * successful re-import as `unreadable`.
     *
     * `read` is accepted too, for the case where the document is not held -
     * the same read-and-replace ran either way.
     *
     * Everything else is a failure and is named as one. Mapping them all to
     * `unreadable` would tell a treasurer their file could not be read when the
     * truth was that its figures were not stored.
     */
    if (outcome?.outcome === 'already-held' || outcome?.outcome === 'read') return 're-imported'

    return outcome?.outcome === 'unreadable' ? 'unreadable' : 'failed'
  } catch {
    // The store or the ingest threw. One document's bad day is not the batch's:
    // AC7's "a failure partway through does not leave one document's rows
    // replaced and another's half-written" is satisfied by each document's own
    // replace being atomic, and by this loop continuing rather than unwinding.
    return 'failed'
  }
}
