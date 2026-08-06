/**
 * The port through which a surface asks what is waiting on a human.
 *
 * Separate from `Quarantine` on purpose. That port's header says it cannot read
 * the queue, and gives the reason: a port that both records the question and
 * reads the answers invites ingestion to start deciding from what it finds
 * there. Adding a read method there would have satisfied the same acceptance
 * criteria and deleted the argument, so the read lives here instead.
 *
 * And this one can only read. Confirming a vendor, or matching one to an
 * existing record, is a human's decision — the single place AD-8 structurally
 * requires a person — and it belongs to a write port that does not exist yet.
 * The absence is the design: a caller cannot quietly reach for a method that
 * was never declared.
 */

/**
 * One document waiting on one name.
 *
 * A document held for two unrecognised names appears twice, once per name,
 * because two unknown vendors on one invoice are two separate questions. The
 * database says the same thing: the unique index is on `(document_id,
 * normalised_name)`, not on the document.
 */
export interface HeldItem {
  readonly documentId: string

  /**
   * What the document is called, which is what a treasurer recognises.
   *
   * Not the storage key. AD-10 keeps storage keys inside `adapters/storage`,
   * and the key sits on the same `document` row this joins to — one careless
   * `select *` away from leaving with the filename.
   */
  readonly filename: string

  /**
   * The vendor name as the document said it, unfolded.
   *
   * Never the normalised form. Migration 010 puts it plainly in the column
   * comment: the folded name is a comparison key and no use to a human. Someone
   * is being asked "do you recognise this?", and the answer depends on seeing
   * what was actually read.
   */
  readonly extractedName: string
}

export interface QuarantineQueue {
  /**
   * Everything currently waiting, oldest first.
   *
   * The order is fixed by the query rather than by the caller, so two renders
   * of an unchanged queue cannot disagree. Nothing downstream re-sorts: a
   * second ordering rule is a second answer to "which is first".
   */
  held(): Promise<readonly HeldItem[]>
}
