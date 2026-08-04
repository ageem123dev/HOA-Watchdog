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
}
