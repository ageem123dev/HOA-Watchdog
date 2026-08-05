/**
 * The port through which ingestion puts document bytes somewhere durable.
 *
 * Pure interface, like `user-directory.ts`: `core/` declares what it needs and
 * `adapters/` supplies it. The AWS SDK appears in `adapters/storage/` and
 * nowhere else, so `core/ingestion` stays testable with no network and no
 * credentials — and so replacing R2 with anything else stays a one-file change.
 */

export interface StoredDocument {
  /** Derived from the content hash by `core/ingestion/storage-key.ts`. */
  readonly key: string
  readonly bytes: Uint8Array
  readonly contentType: string
}

export interface DocumentStore {
  /**
   * Write the bytes at `key`.
   *
   * Idempotent by construction rather than by agreement: the key is a function
   * of the bytes, so writing the same document twice writes the same object
   * twice — which is why a failure between storing and recording leaves nothing
   * to clean up, and why AC2's "no second stored object" needs no check.
   */
  put(document: StoredDocument): Promise<void>

  /**
   * Read the bytes back.
   *
   * Story 1.5d needs this because extraction is **deferred**: the upload stores
   * the document and returns, and a later request reads it again to extract. Up
   * to now nothing ever read a document back, which is why this port could get
   * away with being write-only.
   *
   * Returns `null` when the key is absent, rather than throwing. A missing
   * object and an unreachable bucket are different situations — the first means
   * this document cannot be extracted at all, the second means try later — and
   * a caller that cannot tell them apart will tell the treasurer the wrong
   * thing.
   */
  get(key: string): Promise<Uint8Array | null>
}
