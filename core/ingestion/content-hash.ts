import { createHash } from 'node:crypto'

/**
 * The content hash: SHA-256 of a document's bytes, as uploaded.
 *
 * This is the identity AD-13 turns on — "re-ingesting a document with an
 * existing hash replaces that document's derived rows rather than appending" —
 * and `document_content_hash_unique` in migration 004 enforces it. Getting this
 * wrong does not raise an error anywhere; it makes duplicate detection, the
 * product's headline feature, quietly never fire.
 *
 * Two deliberate constraints on the signature:
 *
 * It takes **bytes, not a file**. No path, no handle, no upload object. Nothing
 * about where a document came from can leak into its identity, and the same
 * bytes uploaded twice under different names are one document rather than two.
 *
 * It is **pure**. No hash object outlives a call, so digest N never depends on
 * documents 1..N-1 — a failure mode that survives every single-call test and
 * only appears once boards upload in batches.
 */

const ALGORITHM = 'sha256'

export function contentHash(bytes: Uint8Array): string {
  // Rejecting a string is the point of this guard, not a formality. `contentHash(file.name)`
  // type-checks nowhere but happens in JavaScript, and it returns a perfectly
  // valid-looking digest of the filename. Buffer extends Uint8Array, so the
  // runtime's own type passes.
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('contentHash expects the document bytes as a Uint8Array')
  }

  // `update` honours the view's byteOffset and byteLength. Reaching for
  // `bytes.buffer` instead would hash whatever else shares the backing buffer —
  // routine for pooled Buffers, and invisible until production.
  return createHash(ALGORITHM).update(bytes).digest('hex')
}
