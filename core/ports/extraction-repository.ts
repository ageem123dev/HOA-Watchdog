import type { ExtractionRecord } from '../extraction/record'

/**
 * The port through which a document's extracted records are stored.
 *
 * `core/` declares the shape; `adapters/db/` supplies it using the
 * `watchdog_writer` role (AD-4). Nothing here knows about Postgres.
 */
export interface ExtractionRepository {
  /**
   * Make `records` the document's complete set, replacing whatever was there.
   *
   * Set-shaped rather than row-shaped, because AD-13 says re-ingesting known
   * bytes **replaces** a document's derived rows, and a document yields many.
   * Delete and insert happen in one transaction: separated, a failure between
   * them leaves a document with no records where it had a full set, which looks
   * exactly like a document nothing was ever read from.
   *
   * An empty `records` is refused rather than treated as "delete everything" —
   * see the adapter for why.
   */
  replace(documentId: string, records: readonly ExtractionRecord[]): Promise<void>

  /** Every record held for a document, for verification and for the catalog. */
  findByDocument(documentId: string): Promise<readonly ExtractionRecord[]>
}
