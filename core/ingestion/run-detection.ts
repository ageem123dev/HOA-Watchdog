import { detectDuplicateInvoices, type DetectionOutcome } from '../detection/detect-duplicates'
import type { FindingRegister } from '../ports/finding'
import type { InvoiceReader } from '../ports/invoice-reader'

/**
 * Running duplicate detection at the end of ingestion (FR-6, story 4.2).
 *
 * ## After the records are stored, and that is forced
 *
 * The hold and the payment write both happen *before* `extractions.replace`, so
 * that a failure leaves the document `held` and the next poll heals it. Detection
 * cannot join them: it compares this document's invoices against earlier ones by
 * reading them back, and before `replace` they are not there to read.
 *
 * So it runs last, and the self-healing property does not apply to it. That is a
 * real limitation rather than an oversight, and the consequence is spelled out
 * below rather than discovered later.
 *
 * ## A failed detection must not un-read a document
 *
 * The document *was* read: its records are stored and a treasurer can see them.
 * Throwing here would report the upload as failed for something that succeeded,
 * and — worse — the caller's retry would find the document already settled and
 * change nothing. The upload would look broken and be fine.
 *
 * So a failure is reported through `onError` and swallowed, the way the rest of
 * this path treats bookkeeping failures. **The cost is honest: the finding is
 * missed until detection runs again**, and nothing currently re-runs it. AD-13
 * makes re-running a no-op, so a re-detect entry point is safe to add whenever a
 * later story wants one; that is the fix, not a retry here.
 *
 * ## Absent collaborators mean "do nothing", and that is a real gap
 *
 * `recordPayments` made the same choice for `units` and `payments`, and
 * `payment-wiring.test.ts` exists because the gap is invisible: a document is
 * read, stored, and never checked, and **nothing fails**. The wiring test is what
 * keeps this honest.
 */
export interface DetectionDependencies {
  readonly invoices?: InvoiceReader
  readonly findings?: FindingRegister
  readonly onError?: (error: unknown, documentId: string) => void
}

export async function runDuplicateDetection(
  documentId: string,
  deps: DetectionDependencies,
): Promise<DetectionOutcome | null> {
  const { invoices, findings } = deps
  if (invoices === undefined || findings === undefined) return null

  try {
    return await detectDuplicateInvoices(documentId, { invoices, findings })
  } catch (error) {
    deps.onError?.(error, documentId)

    return null
  }
}
