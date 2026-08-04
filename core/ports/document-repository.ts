/**
 * The port through which ingestion records that a document exists.
 *
 * `core/` declares the shape; `adapters/db/` supplies it using the
 * `watchdog_writer` role (AD-4, AC1). Nothing here knows about Postgres.
 */

export interface NewDocument {
  /** Lower-case hex SHA-256, from `core/ingestion/content-hash.ts`. */
  readonly contentHash: string
  readonly storageKey: string
  readonly filename: string
  /** Normalised, so it satisfies `document_content_type_supported`. */
  readonly contentType: string
  readonly byteSize: number
  readonly uploadedBy: string
}

export interface RecordedDocument {
  readonly id: string
  /**
   * True when these bytes were already held.
   *
   * The distinction is decided by the database's uniqueness constraint, not by a
   * read-then-write in the adapter: two uploads arriving together both read
   * before either writes, and a product whose headline feature is duplicate
   * detection cannot be the thing that manufactures duplicates (AD-13).
   */
  readonly alreadyHeld: boolean
}

export interface DocumentRepository {
  record(document: NewDocument): Promise<RecordedDocument>

  /**
   * AD-13's other half: re-ingesting known bytes **replaces** that document's
   * derived rows rather than appending a second set.
   *
   * No derived tables exist until story 1.5, so today's implementation has
   * nothing to delete. The seam is declared and called anyway, so 1.5 has one
   * place to fill rather than a call site to remember to add — the half of AD-13
   * that is easiest to leave undone is the half nothing visibly breaks without.
   */
  replaceDerivedRows(documentId: string): Promise<void>
}
