import { readRows, readTable } from '../extraction/tabular'
import type { DocumentRepository } from '../ports/document-repository'
import type { DocumentStore } from '../ports/document-store'
import type { ExtractionRepository } from '../ports/extraction-repository'
import type { WorkbookDecoder } from '../ports/workbook-decoder'
import type { Quarantine } from '../ports/quarantine'
import type { VendorDirectory } from '../ports/vendor-directory'
import { holdUnknownVendors } from './hold-unknown-vendors'
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
  /** Stored, and its figures are in the record. */
  | { readonly filename: string; readonly outcome: 'read'; readonly documentId: string }
  /**
   * Stored, but nothing here can read this type yet.
   *
   * Deliberately neither `read` — nothing read it — nor `failed`, because
   * nothing went wrong. The bytes are kept, so the reader story adds them
   * without asking the treasurer to upload anything again.
   */
  | { readonly filename: string; readonly outcome: 'stored-not-read'; readonly documentId: string }
  /**
   * It opened, and could not be read into figures.
   *
   * The bytes and the document row **are** stored — that happens before any
   * reading. What is not written is the extraction: no records are inserted,
   * and on a re-ingest none are deleted either, so a document that already had
   * a good set still has it. Carries the document id for exactly that reason.
   */
  | { readonly filename: string; readonly outcome: 'unreadable'; readonly documentId: string }
  | { readonly filename: string; readonly outcome: 'already-held'; readonly documentId: string }
  | { readonly filename: string; readonly outcome: 'rejected'; readonly reason: RejectionReason }
  /** The file was fine; something underneath was not. Retryable, and not the file's fault. */
  | { readonly filename: string; readonly outcome: 'failed' }
  /**
   * Read, but its figures could not be written. Distinct from `failed` on
   * purpose: the bytes and the document row are durable, so nothing is lost and
   * re-uploading is the wrong instruction — identical bytes come back
   * already-held and the figures are still missing. Carries the document id so
   * the write can be retried against what is already held.
   */
  | { readonly filename: string; readonly outcome: 'figures-not-stored'; readonly documentId: string }

export interface IngestDependencies {
  readonly store: DocumentStore
  readonly repository: DocumentRepository
  readonly extractions: ExtractionRepository
  /** Absent means spreadsheets are held unread rather than failing. */
  readonly workbooks?: WorkbookDecoder
  /**
   * Asked whether a vendor name is one we already know.
   *
   * Optional so the many existing callers that predate story 1.6b keep working,
   * but its absence is a real gap rather than a neutral default: without it a
   * spreadsheet's unknown vendors are stored with nobody asked about them. The
   * upload route supplies both.
   */
  readonly vendors?: VendorDirectory
  /** Where a name nobody recognises waits for a human (AD-8). */
  readonly quarantine?: Quarantine
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

    // Everything above is durable now. Reading happens after, so a document
    // that cannot be read is still held and a corrected export needs no
    // re-upload — and a failed read cannot cost what was already stored.
    const reading = read(assessment.contentType, bytes, deps)

    if (reading === 'no-reader') {
      // Already-held wins here. The treasurer uploaded this file before, and
      // 1.4's contract is that they are told so rather than told something that
      // is also true but less useful.
      if (recorded.alreadyHeld) {
        return { filename, outcome: 'already-held', documentId: recorded.id }
      }
      return { filename, outcome: 'stored-not-read', documentId: recorded.id }
    }

    if (!reading.ok) {
      // Nothing is written and nothing is deleted. On a re-ingest the previous
      // set is still there, because replacement has not been reached.
      return { filename, outcome: 'unreadable', documentId: recorded.id }
    }

    // Replacement only now, with a complete validated set in hand. This is the
    // whole of AD-13's other half, and the reason it is not called earlier.
    //
    // Caught separately from everything above, because by this point the upload
    // has already survived: reporting a storage-layer `failed` here would tell
    // the treasurer their file was not saved when it was.
    // The same rule the deferred path applies, at the other place extraction
    // finishes. A spreadsheet's vendors are as unknown as a scan's, and epic
    // story 1.6's AC1 is about extraction completing, not about which parser
    // did it. Without this, uploading invoices as CSV was a way to put vendors
    // into the system with nobody asked about them. Raised in review.
    try {
      // Held before the records are stored, for the reason the deferred path
      // holds first: a hold that fails leaves nothing stored and the upload can
      // be retried, where records stored without a hold is silent.
      await holdUnknownVendors(recorded.id, reading.records, deps)

      await deps.extractions.replace(recorded.id, reading.records)
    } catch (error) {
      deps.onError?.(error, filename)

      return { filename, outcome: 'figures-not-stored', documentId: recorded.id }
    }

    if (recorded.alreadyHeld) {
      return { filename, outcome: 'already-held', documentId: recorded.id }
    }

    return { filename, outcome: 'read', documentId: recorded.id }
  } catch (error) {
    deps.onError?.(error, filename)

    return { filename, outcome: 'failed' }
  }
}

/** Types with no reader yet are held rather than failed — see the outcome above. */
const SPREADSHEET_TYPES = [
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]

type Reading = ReturnType<typeof readTable> | 'no-reader'

function read(contentType: string, bytes: Uint8Array, deps: IngestDependencies): Reading {
  if (contentType === 'text/csv') {
    return readTable(new TextDecoder().decode(bytes))
  }

  if (SPREADSHEET_TYPES.includes(contentType)) {
    if (deps.workbooks === undefined) return 'no-reader'
    const decoded = deps.workbooks.decode(bytes)
    if (!decoded.ok) return { ok: false, problems: [{ reason: 'unreadable-file' }] }
    return readRows(decoded.rows)
  }

  return 'no-reader'
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
