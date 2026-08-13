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

  /**
   * The same vendor's invoices in the trailing window ending at **this
   * invoice's own issue date**.
   *
   * ## The window ends at the invoice, not at today
   *
   * A window ending at `now()` gives a different answer for the same invoice
   * every time it is computed, so re-running detection next year would amend a
   * finding a board member already reviewed — and AD-13's no-op would stop
   * meaning anything. Ending it at the invoice's own date makes the answer a
   * property of the invoice rather than of when the question was asked.
   *
   * ## Strictly earlier, which is also what excludes the invoice itself
   *
   * An invoice cannot be in its own average. The date comparison is what
   * enforces that — its own row is not strictly earlier than itself — rather
   * than an id exclusion, because `extraction.id` is exactly what re-ingestion
   * changes (migration 006 replaces a document's rows set-shaped). A rule that
   * held only until the next upload is not a rule.
   *
   * An invoice with no issue date has no window and therefore no history. The
   * upload date is not a substitute: it records when we noticed the invoice,
   * not when the vendor charged.
   *
   * ## What can still change the answer, stated rather than discovered
   *
   * Anchoring to the invoice's date makes the window stable; it does not make
   * the *contents* of the window stable. A backdated invoice uploaded next
   * month falls inside a window that was already computed, so re-running
   * detection would compute a different average for an invoice nobody touched.
   *
   * That is the right behaviour rather than a leak: the second answer is the
   * better-informed one, and `raise` amends the evidence in place instead of
   * raising a second finding, so AD-13 holds either way. A board member sees an
   * updated comparison, never a duplicate alert. Worth naming because the
   * opposite assumption — "the same invoice always yields the same evidence" —
   * is the one a later story would be tempted to build a cache on.
   *
   * Unlike `priorCandidates`, this narrows on **nothing but** the vendor and
   * the window — the amounts are what is being averaged, so narrowing on them
   * would average the answer with itself.
   */
  trailingInvoices(subject: InvoiceReading): Promise<readonly InvoiceReading[]>
}
