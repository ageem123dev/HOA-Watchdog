/**
 * The port through which a surface asks which payments are waiting on a human.
 *
 * Separate from `PaymentRepository` on purpose, and for the reason
 * `core/ports/quarantine-queue.ts` gives about its own separation: a port that
 * both writes the reading and reads the open questions invites ingestion to
 * start deciding from what it finds there.
 *
 * **This one can only read.** Naming the unit a held payment belongs to is a
 * human's decision — the same decision `quarantine_item` exists for, and the
 * single place AC2 structurally requires a person. Attributing it belongs to a
 * write path that does not exist yet, and the absence is the design: a caller
 * cannot quietly reach for a method that was never declared.
 */

/** One deposit line waiting on a human to name its unit. */
export interface HeldPayment {
  readonly documentId: string

  /**
   * What the document is called, which is what a treasurer recognises.
   *
   * Not the storage key. AD-10 keeps storage keys inside `adapters/storage`, and
   * the key sits on the same `document` row this joins to — one careless
   * `select *` away from leaving with it.
   */
  readonly filename: string

  /**
   * The unit reference as the document spelled it, unfolded.
   *
   * Never the normalised form. Somebody is being asked "which unit is this?",
   * and the answer depends on seeing what was actually read — the same argument
   * `quarantine-queue.ts` makes about an extracted vendor name.
   */
  readonly unitReference: string

  /** `YYYY-MM-DD`. A calendar date, never a `Date`. */
  readonly paidOn: string

  /** A decimal string, as every amount in this system crosses. */
  readonly amount: string
}

export interface HeldPaymentQueue {
  /**
   * Everything currently waiting, oldest first.
   *
   * The order is fixed by the query rather than by the caller, so two renders of
   * an unchanged queue cannot disagree. Nothing downstream re-sorts: a second
   * ordering rule is a second answer to "which is first".
   */
  held(): Promise<readonly HeldPayment[]>
}
