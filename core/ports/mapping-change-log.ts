/**
 * The durable record of a mapping change (story 5.7, AC6).
 *
 * Migration 027 is the authority on the rules; this is the shape a caller
 * reaches them through. Read that file's header before changing anything here.
 *
 * ## Why this is separate from `MappingStore`
 *
 * `MappingStore.save` already returns what it replaced, which is what makes a
 * change *detectable*. This port is what makes it *durable*. Keeping them apart
 * is deliberate: a store whose `save` also wrote history would give one method
 * two owners, and the second write would be invisible at the call site — where
 * the decision to record belongs, because a re-import's outcomes are not known
 * until after it runs.
 *
 * ## Recording happens after the re-import, not before
 *
 * The record names which documents were re-imported and what happened to each,
 * so it cannot be written until they have been. That ordering is why `record`
 * takes the outcomes rather than returning something the caller fills in later:
 * a two-step write would leave a row claiming a re-import that never finished.
 *
 * ## There is no read
 *
 * Nothing in story 5.7 shows this history to anybody — AC6 asks for a durable
 * record, not a page. Migration 027 grants the reader nothing for the same
 * reason. When a surface needs it, the read is designed then, with the question
 * it has to answer in hand, rather than guessed at now.
 */

import type { DocumentKind } from '../extraction/record'
import type { DraftMapping } from '../mapping/draft'
import type { ReimportOutcome } from '../mapping/reimport'

export interface MappingChange {
  /**
   * The member who changed it. The association is derived from them in SQL,
   * never passed — 5.1's rule, and this row is evidence about one board.
   */
  readonly changedBy: string
  readonly kind: DocumentKind
  readonly shape: string
  /** `null` when nothing was replaced, which is what a first mapping is. */
  readonly previous: DraftMapping | null
  readonly next: DraftMapping
  /** Per document, because AC7 refuses a single summarised "done". */
  readonly documents: readonly ReimportOutcome[]
}

export interface MappingChangeLog {
  /**
   * Write the record. It is never updated and never deleted — migration 027
   * revokes both, so a caller that expected to amend one would fail at runtime.
   */
  record(change: MappingChange): Promise<void>
}
