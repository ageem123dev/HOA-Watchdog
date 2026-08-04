import type { DocumentRepository } from '../ports/document-repository'
import type { DocumentStore } from '../ports/document-store'
import { type RejectionReason, assess } from './acceptance'
import { contentHash } from './content-hash'
import { storageKeyFor } from './storage-key'

/**
 * Ingestion: the only way ledger data enters this system (AD-1).
 *
 * Two properties shape everything below.
 *
 * **One outcome per file, always.** A treasurer uploading twenty documents,
 * one of which is a `.docx`, must not lose the other nineteen (AC3). The same
 * has to hold when the cause is a transient storage error rather than the file's
 * fault, which is why a per-file `failed` outcome exists alongside the
 * rejections — a storage outage is not something to tell a board member their
 * valid PDF was rejected for.
 *
 * **Order is the safety property, not a cleanup path.** Assess → hash → key →
 * store → record:
 *
 * - Rejection happens before either port is touched, so AC4's "no partial record
 *   of that file is stored" holds by construction rather than by remembering to
 *   undo something.
 * - Store precedes record because a row pointing at bytes that are not there is
 *   worse than an object with no row. The object is self-healing — the key is
 *   the content hash, so a retry writes the same bytes to the same place — while
 *   a dangling row is a permanent lie about what the association holds.
 */

export interface IngestibleFile {
  readonly filename: string
  /** As declared by the client; the acceptance gate treats it as a claim. */
  readonly contentType: string
  readonly bytes: Uint8Array
}

export type IngestOutcome =
  | { readonly filename: string; readonly outcome: 'accepted'; readonly documentId: string }
  | { readonly filename: string; readonly outcome: 'already-held'; readonly documentId: string }
  | { readonly filename: string; readonly outcome: 'rejected'; readonly reason: RejectionReason }
  /** The file was fine; something underneath was not. Retryable, and not the file's fault. */
  | { readonly filename: string; readonly outcome: 'failed' }

export interface IngestDependencies {
  readonly store: DocumentStore
  readonly repository: DocumentRepository
  /**
   * Where the real error goes. It is deliberately absent from the outcome — an
   * exception's text can name a path, a bucket, or a library — but discarding it
   * entirely would make a storage outage look like bad luck to whoever is on
   * call.
   */
  readonly onError?: (error: unknown, filename: string) => void
}

async function ingestOne(
  file: IngestibleFile,
  uploadedBy: string,
  deps: IngestDependencies,
): Promise<IngestOutcome> {
  const { filename, bytes } = file
  const assessment = assess({ contentType: file.contentType, bytes })

  if (assessment.outcome === 'rejected') {
    return { filename, outcome: 'rejected', reason: assessment.reason }
  }

  try {
    // Hashed before anything parses or extracts (AC1). The digest is the
    // document's identity, so it is computed from the bytes as uploaded and
    // nothing downstream can influence it.
    const hash = contentHash(bytes)
    const storageKey = storageKeyFor(hash)

    await deps.store.put({ key: storageKey, bytes, contentType: assessment.contentType })

    const recorded = await deps.repository.record({
      contentHash: hash,
      storageKey,
      filename,
      // The normalised type, not the declared one: browsers send
      // `text/csv; charset=utf-8`, which document_content_type_supported refuses.
      contentType: assessment.contentType,
      byteSize: bytes.length,
      uploadedBy,
    })

    if (recorded.alreadyHeld) {
      // Nothing is destroyed here. AD-13's replacement is real, but it belongs
      // after a complete set has been read and validated — deleting on the way
      // in means a failed re-read leaves the document with no records where it
      // had a full set, and that is indistinguishable from never having any.
      return { filename, outcome: 'already-held', documentId: recorded.id }
    }

    return { filename, outcome: 'accepted', documentId: recorded.id }
  } catch (error) {
    deps.onError?.(error, filename)

    return { filename, outcome: 'failed' }
  }
}

export async function ingest(
  files: readonly IngestibleFile[],
  uploadedBy: string,
  deps: IngestDependencies,
): Promise<IngestOutcome[]> {
  const outcomes: IngestOutcome[] = []

  // Sequential on purpose. Two identical files in one batch must resolve to one
  // record and one already-held, and the database's uniqueness constraint is
  // what decides that — running them concurrently would have both racing for the
  // same insert to find out. A board uploads tens of files, not thousands.
  for (const file of files) {
    outcomes.push(await ingestOne(file, uploadedBy, deps))
  }

  return outcomes
}
