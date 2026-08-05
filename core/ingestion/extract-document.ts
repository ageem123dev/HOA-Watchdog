import type { DocumentRepository } from '../ports/document-repository'
import type { DocumentStore } from '../ports/document-store'
import type { ExtractionRepository } from '../ports/extraction-repository'
import type { Extractor } from '../ports/extractor'

/**
 * Read a document that is already held, and store what it says.
 *
 * This is the deferred half of ingestion. Story 1.5c decided the order:
 * uploading stores the bytes and returns, and extraction happens on a later
 * request the surface polls — because a model call is seconds, and a treasurer
 * uploading twenty scans should not hold one request open for minutes.
 *
 * **Only documents no deterministic parser can read come here.** CSV and Excel
 * are parsed in `core/` at upload time and never reach a provider: that is story
 * 1.5's AC2 guarantee, it costs money per document to break, and a test asserts
 * the extractor is not called for those types.
 */

export const EXTRACTION_OUTCOMES = [
  'read',
  'unreadable',
  'provider-unavailable',
  'not-found',
  'no-provider-path',
] as const

export type ExtractionOutcomeKind = (typeof EXTRACTION_OUTCOMES)[number]

export type ExtractionOutcome =
  | { readonly outcome: 'read'; readonly documentId: string; readonly records: number }
  /** The provider answered and its answer could not be trusted. A better scan may help. */
  | { readonly outcome: 'unreadable'; readonly documentId: string }
  /**
   * The provider could not answer, or the bytes could not be fetched.
   *
   * **Not `unreadable`.** The document is fine and retrying may work. Story 1.5b
   * collapsed a pair like this into one outcome and had to add a second name
   * later; 1.5c split the port's refusal in two so this distinction could
   * survive to a surface.
   */
  | { readonly outcome: 'provider-unavailable'; readonly documentId: string }
  | { readonly outcome: 'not-found'; readonly documentId: string }
  /** A type the deterministic path owns. Asking to extract it is a caller error. */
  | { readonly outcome: 'no-provider-path'; readonly documentId: string }

export interface ExtractDocumentDependencies {
  readonly repository: DocumentRepository
  readonly store: DocumentStore
  readonly extractions: ExtractionRepository
  readonly extractor: Extractor
  readonly onError?: (error: unknown, documentId: string) => void
}

/**
 * Types a deterministic parser owns. These never reach a provider.
 *
 * Held as the complement of the provider-backed set rather than as a second
 * hand-written list: a test asserts the two together are exactly
 * `ACCEPTED_CONTENT_TYPES`, so a type that can be uploaded can never fall
 * through both — which would be a document accepted and then never readable.
 */
const TABULAR_TYPES: ReadonlySet<string> = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export async function extractDocument(
  documentId: string,
  deps: ExtractDocumentDependencies,
): Promise<ExtractionOutcome> {
  try {
    const document = await deps.repository.findById(documentId)
    if (document === null) return { outcome: 'not-found', documentId }

    // Checked before the bytes are fetched, so a caller asking to extract a
    // spreadsheet costs nothing and, more importantly, cannot reach the model.
    if (TABULAR_TYPES.has(document.contentType)) {
      return { outcome: 'no-provider-path', documentId }
    }

    const bytes = await deps.store.get(document.storageKey)

    // A missing object is not a transient outage. Retrying cannot conjure the
    // bytes back, so telling the treasurer to wait would be a lie.
    if (bytes === null) return { outcome: 'not-found', documentId }

    const result = await deps.extractor.extract({ bytes, mediaType: document.contentType })

    if (!result.ok) {
      // The distinction story 1.5c split the port's refusal in two to preserve.
      return {
        outcome: result.refusal === 'unavailable' ? 'provider-unavailable' : 'unreadable',
        documentId,
      }
    }

    // An empty collection is a content problem, not an infrastructure one.
    // `replace` refuses `[]`, and reaching it would report this as an outage.
    if (result.records.length === 0) return { outcome: 'unreadable', documentId }

    await deps.extractions.replace(documentId, result.records)

    return { outcome: 'read', documentId, records: result.records.length }
  } catch (error) {
    // Everything that throws here is infrastructure: the object store, the
    // database, the transport. None of it is the document's fault, so none of
    // it may render as "your scan is bad".
    //
    // `provider-unavailable` is broader than its name — it also covers a failed
    // write — and that is a deliberate consequence of AC3 fixing exactly four
    // durable states. What the treasurer needs to know is the same in each
    // case: nothing is lost, this is retryable, and it is not their document.
    deps.onError?.(error, documentId)

    return { outcome: 'provider-unavailable', documentId }
  }
}
