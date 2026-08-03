/**
 * Where a document's bytes live, derived from what the bytes are.
 *
 * The key is a function of the content hash and nothing else. That single
 * decision does three jobs:
 *
 * It makes AC2's "no second stored object is created" true by construction —
 * re-uploading the same file writes the same key, so there is nothing to check
 * and nothing to race.
 *
 * It decides what a crash costs. If the bytes are stored and the `document`
 * insert then fails, a retry writes the same key with the same bytes; the orphan
 * is overwritten rather than accumulated. So there is no compensating delete,
 * and no delete path with failure modes of its own.
 *
 * And it keeps the filename out of the object store, where a member's name or an
 * association's address in a filename would otherwise persist unnoticed.
 */

/** Namespaced so 1.5's derived artefacts cannot collide with source documents. */
export const STORAGE_KEY_PREFIX = 'documents/'

const SHA256_HEX = /^[0-9a-f]{64}$/

export function storageKeyFor(contentHash: string): string {
  // This value is interpolated into an object path. A caller handing over
  // anything but a digest — a filename, a user-supplied string, a traversal
  // attempt — must fail here rather than produce a key that escapes the prefix.
  if (!SHA256_HEX.test(contentHash)) {
    throw new TypeError('storageKeyFor expects a lower-case hex SHA-256 digest')
  }

  return `${STORAGE_KEY_PREFIX}${contentHash}`
}
