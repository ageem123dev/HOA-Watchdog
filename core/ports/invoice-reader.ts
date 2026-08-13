import type { InvoiceReading } from '../detection/duplicate-invoice'

/**
 * The port through which the duplicate detector reads invoices.
 *
 * **Read-only, and the absence of a write method is the design.** This is the
 * same argument `core/ports/query-log.ts` makes in the opposite direction: a
 * capability nothing declares is a capability nothing can quietly acquire. The
 * detector's whole job is to look at what ingestion recorded and say something
 * about it, and a detector that could *edit* an extraction could quietly make
 * its own findings true. `ExtractionRepository` is where writing lives, and this
 * port is deliberately not it.
 *
 * There is no `raise` here either. Raising is `FindingRegister`, held separately
 * for the reason story 4.1 split it from `FindingReviewer`: reading invoices and
 * recording findings are different capabilities, and one object holding both is
 * a refactor away from a detector that writes what it wants to have read.
 */
export interface InvoiceReader {
  /**
   * Every invoice this document carries.
   *
   * Plural, and that is not defensive. Migration 006 allows many extraction rows
   * per document by design — *"a single upload is hundreds of lines"* — and a
   * real document in this database carries three invoices. A reader that
   * returned one would silently check the first and ignore the rest.
   */
  invoicesOn(documentId: string): Promise<readonly InvoiceReading[]>

  /**
   * Invoices that could plausibly be the same bill, from **earlier** documents.
   *
   * Narrowed in SQL to the same vendor and the same amount, which is what both
   * of FR-6's rules require. The narrowing is an optimisation: `duplicatesAmong`
   * re-checks every condition, so a reader that returned too much would still
   * produce the right answer.
   *
   * **Earlier, never later.** If two documents duplicate each other, only the
   * one that arrived second can be said to duplicate anything — otherwise both
   * uploads raise a finding about the same pair and the register reports one
   * event twice.
   */
  priorCandidates(subject: InvoiceReading): Promise<readonly InvoiceReading[]>
}
