/**
 * The port through which a deposit document's payments are written.
 *
 * A write port, unlike every other port this epic added. Payments are *derived*
 * from a document rather than typed by a treasurer, so something has to write
 * them — and AD-13 says a re-ingest replaces what the previous reading produced
 * rather than appending to it.
 *
 * **Both tables move together.** A deposit line either becomes a payment or is
 * held for a human, and the two outcomes are one reading of one document. A
 * replacement that cleared `payment` and not `held_payment` would leave the
 * document half-described — some of it from this reading, some from the last —
 * and nothing downstream could tell which.
 */

import type { ResolvedLine } from '../payment/resolve-line'

export interface PaymentRepository {
  /**
   * Replace everything this document previously produced, in one transaction.
   *
   * `lines` is the whole reading: attributed and held together, in the order the
   * document listed them. Splitting them into two arguments would invite a
   * caller to pass one and forget the other, which is the failure this signature
   * exists to make unrepresentable.
   *
   * **An entirely empty reading is refused**, not obeyed. `replace(id, [])` reads
   * identically to "extraction found nothing", and obeying it would destroy a
   * good set on a caller's mistake — the reasoning
   * `core/ports/extraction-repository.ts` records for its own replace. Note the
   * bar is the *combined* set: a deposit whose every line was held is a perfectly
   * ordinary outcome and must be allowed.
   */
  replace(documentId: string, lines: readonly ResolvedLine[]): Promise<void>
}
