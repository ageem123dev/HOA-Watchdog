import {
  StaleExtractionClaimError,
  type DocumentRepository,
  type ExtractionState,
} from '../ports/document-repository'
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
  'in-progress',
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
  /**
   * Someone else holds the claim.
   *
   * Not a failure and not a queue position — the document is `held` and being
   * read right now. This is the outcome the surface renders as "extracting",
   * which is why that is not a durable state: it is `held` plus a live claim,
   * observed from here.
   */
  | { readonly outcome: 'in-progress'; readonly documentId: string }

export interface ExtractDocumentDependencies {
  readonly repository: DocumentRepository
  /** How long a claim survives without its holder finishing. */
  readonly claimTtlSeconds?: number
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
/**
 * Long enough for a slow provider, short enough that a crashed run frees the
 * document while the treasurer is still watching.
 */
/**
 * What a finished document reports when someone polls it again.
 *
 * `claimForExtraction` returns null for two different situations — someone else
 * holds a live claim, and the work is already done — and they are not the same
 * answer. Treating both as `in-progress` showed "Reading" forever for a document
 * that had been read, because every later poll took the same branch. Found in
 * review.
 */
const SETTLED_OUTCOME: Readonly<Record<ExtractionState, ExtractionOutcomeKind | null>> = {
  // Still claimable, so a null claim here really does mean someone else has it.
  held: null,
  provider_unavailable: 'provider-unavailable',
  read: 'read',
  unreadable: 'unreadable',
}

const DEFAULT_CLAIM_TTL_SECONDS = 300

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

    // Claimed before a byte is fetched or a token is spent. A lock taken around
    // the write would serialise the cheap part and let the expensive part run
    // twice -- story 1.5b shipped that shape and it was caught in review.
    const claim = await deps.repository.claimForExtraction(
      documentId,
      deps.claimTtlSeconds ?? DEFAULT_CLAIM_TTL_SECONDS,
    )

    if (claim === null) {
      // Two situations, one null. If the document has finished, say so — a
      // document that was read must not keep reporting `in-progress` to every
      // later poll. Only a `held` document that could not be claimed is
      // genuinely someone else's work in flight.
      const settled = SETTLED_OUTCOME[document.extractionState]

      return settled === null
        ? { outcome: 'in-progress', documentId }
        : ({ outcome: settled, documentId } as ExtractionOutcome)
    }

    const settle = async (
      state: 'unreadable' | 'provider_unavailable',
      outcome: 'unreadable' | 'provider-unavailable',
    ): Promise<ExtractionOutcome> => {
      // Fenced, then released. Both are writes and both need the token: a
      // holder whose claim lapsed could otherwise mark a document unreadable
      // after a fresher run had already succeeded.
      await deps.repository.markExtractionState(documentId, state, { token: claim.token })
      await deps.repository.releaseExtractionClaim(claim)

      return { outcome, documentId }
    }

    try {
      const bytes = await deps.store.get(document.storageKey)

      // A missing object is not a transient outage. Retrying cannot conjure the
      // bytes back, so telling the treasurer to wait would be a lie.
      //
      // The state stays `held`, which is the honest description of the row: we
      // have it and we have not read it. It is also imperfect — a later poll
      // will re-claim and re-fetch a document whose bytes are gone for good.
      // None of AC3's four states says "the bytes have vanished", and inventing
      // one here would put a fifth state in by the back door. Raised in review
      // and recorded as a decision rather than patched around.
      if (bytes === null) {
        await deps.repository.releaseExtractionClaim(claim)
        return { outcome: 'not-found', documentId }
      }

      const result = await deps.extractor.extract({ bytes, mediaType: document.contentType })

      if (!result.ok) {
        // The distinction story 1.5c split the port's refusal in two to preserve.
        return result.refusal === 'unavailable'
          ? await settle('provider_unavailable', 'provider-unavailable')
          : await settle('unreadable', 'unreadable')
      }

      // An empty collection is a content problem, not an infrastructure one.
      // `replace` refuses `[]`, and reaching it would report this as an outage.
      if (result.records.length === 0) return await settle('unreadable', 'unreadable')

      // The fence goes with the write. `replace` clears the claim in the same
      // transaction as the state change, which is why nothing releases it here:
      // a second release could free a document a *later* claimant already holds.
      await deps.extractions.replace(documentId, result.records, { token: claim.token })

      return { outcome: 'read', documentId, records: result.records.length }
    } catch (error) {
      // A refused write is not an outage. Expiry creates a second claimant by
      // design, so being refused means someone fresher took over — and they may
      // well have succeeded. Reporting `provider-unavailable` would tell the
      // treasurer their document is waiting when it has just been read.
      //
      // Re-read rather than guess: the winner decides the outcome, and only the
      // database knows what they decided.
      if (error instanceof StaleExtractionClaimError) {
        const current = await deps.repository.findById(documentId)
        const settled = current === null ? null : SETTLED_OUTCOME[current.extractionState]

        return settled === null
          ? { outcome: 'in-progress', documentId }
          : ({ outcome: settled, documentId } as ExtractionOutcome)
      }

      deps.onError?.(error, documentId)
      await deps.repository.releaseExtractionClaim(claim).catch(() => undefined)

      return { outcome: 'provider-unavailable', documentId }
    }
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
