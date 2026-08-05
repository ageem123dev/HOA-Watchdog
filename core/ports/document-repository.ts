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
 * Where a document has got to, mirroring `document_extraction_state_known` in
 * migration 007. A test reads that SQL and fails if these two disagree.
 *
 * `failed` is deliberately absent. Story 1.5b shipped an outcome by that name
 * whose copy told the treasurer their document was not saved when it had been,
 * and had to add `figures-not-stored` to undo it.
 */
export const EXTRACTION_STATES = ['held', 'read', 'unreadable', 'provider_unavailable'] as const

export type ExtractionState = (typeof EXTRACTION_STATES)[number]

/**
 * A document as it is held, for the deferred extraction pass to work from.
 *
 * Deliberately not the whole row. Extraction needs to find the bytes, know how
 * to read them, and know whether it still needs reading — the filename and
 * uploader are the surface's business.
 */
export interface HeldDocument {
  readonly id: string
  readonly storageKey: string
  /** Normalised, so routing can decide deterministic-versus-provider on it. */
  readonly contentType: string
  readonly extractionState: ExtractionState
}

/**
 * The claim that authorised a write is no longer the live one.
 *
 * Expiry creates a second claimant on purpose, so the original may still be
 * running and may still return an answer. Refusing its write is what stops the
 * system preferring the *staler* of two results — it is not a fault in the
 * ordinary sense, and a caller that sees it should report the document's current
 * state rather than an error.
 *
 * Declared here rather than in an adapter because both write paths need it, and
 * the concept belongs to the domain: "you no longer hold this" is a rule of the
 * claim, not a detail of Postgres.
 */
export class StaleExtractionClaimError extends Error {
  override readonly name = 'StaleExtractionClaimError'

  constructor(readonly documentId: string) {
    super(`the extraction claim on ${documentId} is no longer held; this write was refused`)
  }
}

/**
 * A claim on a document while it is being extracted.
 *
 * Held in the database rather than in a process: two application instances
 * share no memory, so an in-memory claim is invisible to the instance that
 * matters. The token is what makes the finalising write safe — see
 * `ExtractionRepository.replace`.
 */
export interface ExtractionClaim {
  readonly documentId: string
  /** Unique to this attempt. Only its holder may release or finish. */
  readonly token: string
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

  /**
   * Move a document to a state that carries no records.
   *
   * `read` is **not** settable here on purpose: it is only ever committed
   * alongside the records that justify it, which is `ExtractionRepository.replace`'s
   * single transaction. A separate "mark it read" would be a way to claim
   * figures exist when they do not.
   */
  /**
   * @param fence - the claim that authorises this write, when there is one.
   *
   * Fenced for the same reason `replace` is, and it is easy to miss: expiry
   * creates a second claimant, so a holder whose claim lapsed can return with a
   * *failure* and mark a document unreadable after a fresher run already
   * succeeded. Overwriting a success with a stale failure is the worse
   * direction of the same bug.
   */
  markExtractionState(
    id: string,
    state: Exclude<ExtractionState, 'read'>,
    fence?: { readonly token: string },
  ): Promise<void>

  /**
   * Take the right to extract this document, or return `null` if someone else
   * holds it.
   *
   * **Before the provider call, not after.** A lock taken around the write
   * serialises the cheap part and lets the expensive part run twice — story
   * 1.5b shipped exactly that shape and it was found in review.
   *
   * A claim that has passed its expiry is available again: a process that dies
   * mid-extraction must not hold a document forever. That deliberately creates
   * a second claimant while the first may still be running, which is why the
   * write is fenced on the token rather than trusting whoever arrives.
   *
   * Only `held` documents are claimable. Anything else has finished.
   */
  claimForExtraction(id: string, ttlSeconds: number): Promise<ExtractionClaim | null>

  /**
   * Give the claim back, so a retry need not wait out the expiry.
   *
   * Requires the matching token. A claim released by the wrong holder would let
   * a stale claimant hand a live document to the next caller.
   */
  releaseExtractionClaim(claim: ExtractionClaim): Promise<void>

}
