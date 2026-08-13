import { detectDuplicateInvoices } from '../detection/detect-duplicates'
import { detectVendorSpikes } from '../detection/detect-vendor-spikes'
import type { DetectionOutcome } from '../detection/detection-run'
import type { FindingRegister } from '../ports/finding'
import type { InvoiceReader } from '../ports/invoice-reader'

/**
 * Running detection at the end of ingestion (FR-6, stories 4.2 and 4.3).
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
 * ## One failing detector must not stop the other
 *
 * The two detectors answer different questions and share nothing but a reader.
 * A vendor-spike query that times out is no reason to skip the check for an
 * invoice you may already have paid — and the reverse. So each runs inside its
 * own guard, and the outcome names them separately rather than summing them: a
 * caller that cannot tell *which* half ran cannot tell what re-running would
 * recover.
 *
 * The reported error names its detector for the same reason. A log line reading
 * "detection failed for document X" when one of two failed tells an operator
 * nothing they can act on.
 *
 * ## Sequential, deliberately
 *
 * The two `await`s below run one after the other rather than through
 * `Promise.all`, and the upload does wait for both. Raised by Argus as a missed
 * concurrency win; kept sequential because the win is smaller than it looks and
 * the cost is not:
 *
 * - Each detector issues a query per invoice against a pool of five
 *   connections shared by the whole process. Running two of them at once
 *   doubles the checkouts per upload, and concurrent uploads multiply that.
 * - The real duplication is not the ordering: both detectors open by calling
 *   `invoicesOn(documentId)`, so the same query runs twice either way. Reading
 *   the invoices once here and passing them in is the change worth making if
 *   detection latency ever matters, and it makes the pair concurrency-safe as a
 *   side effect. `Promise.all` on top of the duplicate read would buy the
 *   smaller half of that.
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

/**
 * What each detector managed, `null` where it failed.
 *
 * Separate fields rather than a total: "3 findings raised" out of two detectors
 * one of which threw is a number that reads as success.
 */
export interface DetectionRun {
  readonly duplicates: DetectionOutcome | null
  readonly spikes: DetectionOutcome | null
}

export async function runDetection(
  documentId: string,
  deps: DetectionDependencies,
): Promise<DetectionRun | null> {
  const { invoices, findings } = deps
  if (invoices === undefined || findings === undefined) return null

  const attempt = async (
    detector: string,
    run: () => Promise<DetectionOutcome>,
  ): Promise<DetectionOutcome | null> => {
    try {
      return await run()
    } catch (cause) {
      // **Reporting the failure must not become the failure.** `onError` is
      // caller-supplied and a logger with a broken transport is an ordinary
      // thing to have; thrown from here it escapes `attempt`, so the second
      // detector never runs and the exception reaches an ingestion path that
      // had already stored the document's records. Raised by CodeRabbit.
      try {
        deps.onError?.(new Error(`${detector} detection failed`, { cause }), documentId)
      } catch {
        // Nowhere left to report it: the thing that reports is what broke.
      }

      return null
    }
  }

  return {
    duplicates: await attempt('duplicate-invoice', () =>
      detectDuplicateInvoices(documentId, { invoices, findings }),
    ),
    spikes: await attempt('vendor-spike', () =>
      detectVendorSpikes(documentId, { invoices, findings }),
    ),
  }
}
