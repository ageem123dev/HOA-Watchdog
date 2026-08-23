/**
 * The documents a mapping change might affect (story 5.7, AC4).
 *
 * ## Why this is its own port
 *
 * It could have been a method on `DocumentRepository`, and the first attempt put
 * it there. That forced four fakes - in `ingest.test.ts`, `reading.test.ts`,
 * `extract-document.test.ts` and the Postgres adapter - to grow a method none of
 * them will ever call, because `ingest` has no business listing documents. A
 * port is what `core/` needs from the outside, not a mirror of where the rows
 * live, and this project already keeps them narrow: `document-store.ts`,
 * `mapping-store.ts`, `finding-alert.ts`.
 *
 * ## Candidates, not matches
 *
 * This deliberately cannot filter by heading shape. Which documents a changed
 * mapping actually affects is decided by re-deriving each one's shape from its
 * own bytes, in `core/mapping/reimport.ts`.
 *
 * The alternative - recording the shape on the document at ingest time and
 * querying it - reads as cheaper and is wrong. It would be null for every
 * document imported before this story, which is exactly the set most likely to
 * need re-importing, and backfilling it means reading all their bytes: the work
 * this avoids by doing it once, at the moment the bytes must be fetched anyway.
 *
 * ## The association is derived, not passed
 *
 * `uploadedBy` is a member, and the adapter reads the association from that
 * member in SQL. 5.1's rule, and it matters more here than almost anywhere: a
 * re-import scoped to the wrong association rewrites another board's financial
 * history through a path that is *supposed* to rewrite history.
 */

/** A held document, with what a re-import needs to read it back and re-file it. */
export interface Reimportable {
  readonly id: string
  readonly storageKey: string
  readonly filename: string
  /** Normalised at ingest, so it routes the same way on the way back in. */
  readonly contentType: string
}

export interface ReimportCandidates {
  /**
   * Every document of `kind` held by this member's association.
   *
   * One document has many extraction rows, so an implementation joining to
   * `extraction` for the kind must return each document once - a duplicate here
   * becomes a document re-imported twice.
   */
  importedUnder(uploadedBy: string, kind: string): Promise<readonly Reimportable[]>
}
