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
}
