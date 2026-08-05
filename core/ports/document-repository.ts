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

/**
 * A document as it is held, for the deferred extraction pass to work from.
 *
 * Deliberately not the whole row. Extraction needs to find the bytes and know
 * how to read them, and nothing else — the filename and uploader are the
 * surface's business.
 */
export interface HeldDocument {
  readonly id: string
  readonly storageKey: string
  /** Normalised, so routing can decide deterministic-versus-provider on it. */
  readonly contentType: string
}

export interface DocumentRepository {
  record(document: NewDocument): Promise<RecordedDocument>

  /**
   * The document with this id, or `null` if there is none.
   *
   * Null rather than a throw: a caller asking for a document that does not
   * exist is an ordinary outcome of a stale link or a deleted upload, and the
   * follow-up endpoint has to answer it with a 404 rather than a 500.
   */
  findById(id: string): Promise<HeldDocument | null>
}
