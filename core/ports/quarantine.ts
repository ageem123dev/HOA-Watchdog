/**
 * The port through which ingestion hands a decision to a human.
 *
 * A vendor name that resolves to nothing is not an error and not a new vendor.
 * It is a question, and AD-8 says a person answers it. This port is how the
 * question gets recorded.
 *
 * Deliberately narrow. It cannot read the queue, because rendering the queue is
 * story 1.6c and a port that can do both invites ingestion to start making
 * decisions from what it finds there. It cannot resolve anything either — that
 * is 1.6d, and it needs the human this port exists to reach.
 */

export interface Quarantine {
  /**
   * Record that this document is waiting on someone to identify this name.
   *
   * **Idempotent.** Re-extraction is ordinary — AD-13 makes re-ingest routine
   * and a retry after a failed write is routine too — so holding a document
   * twice for one name must be a no-op rather than an error the caller has to
   * recognise and swallow. The database enforces that with a unique index on
   * `(document_id, normalised_name)`; this contract is what stops a caller
   * defeating it by treating the collision as a failure.
   *
   * Takes the name **as extracted**, not normalised. A treasurer is being asked
   * to recognise it, and the folded form is a comparison key.
   */
  hold(documentId: string, extractedName: string): Promise<void>

  /**
   * The names this document is currently waiting on.
   *
   * For verifying the hold, not for building a surface — 1.6c reads the queue
   * across documents and will need its own shape. Kept here so a caller and a
   * test can ask "is this document held?" without reaching past the port.
   */
  heldNames(documentId: string): Promise<readonly string[]>
}
