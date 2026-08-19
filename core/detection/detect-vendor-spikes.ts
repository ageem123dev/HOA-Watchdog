import type { FindingRegister, RaisedFinding } from '../ports/finding'
import type { InvoiceReader } from '../ports/invoice-reader'
import { monthOf, monthRange, type DetectionOutcome } from './detection-run'
import type { InvoiceReading } from './duplicate-invoice'
import {
  SPIKE_THRESHOLD_PERCENT,
  TRAILING_WINDOW_MONTHS,
  spikeAgainst,
  type VendorSpike,
} from './vendor-spike'

/**
 * Running vendor-spike detection over one uploaded document (FR-6, story 4.3).
 *
 * ## The same rails 4.2 laid, not a second set
 *
 * One finding per document per month, keyed on `(finding_type, subject_id,
 * period)`, grouped before anything is raised. The reasoning is
 * `detect-duplicates.ts`'s and is not repeated here; what matters is that this
 * detector reaches the same key by the same route, from `detection-run.ts`,
 * rather than by computing a month of its own. Two detectors with two month
 * rules would file the same month under two ranges.
 *
 * The `finding_type` differs, so the two detectors never collide on the
 * identity constraint even for the same document and month. They are separate
 * findings because they are separate sentences: one says you may have paid this
 * bill already, the other says this bill is larger than usual.
 *
 * ## One window query per invoice, knowingly
 *
 * CodeRabbit raised the N+1: this reads a trailing window per invoice rather
 * than batching by vendor. Left as it is, because the bound is invoices *per
 * document* — the largest in this database carries three — and
 * `detectDuplicateInvoices` has had the same shape since 4.2, so batching one
 * and not the other would leave the pair inconsistent for no measured gain.
 * Batching means a reader method that takes many subjects and returns histories
 * keyed by them, which changes the port; that is a story about detection
 * throughput, not a review fix on a story about arithmetic.
 */

/**
 * `verb_noun`, matching `finding_type_is_verb_noun` in migration 021.
 *
 * **It states the comparison and stops there.** UX-DR23 forbids implying
 * certainty the system lacks, and every shorter name available claims more than
 * was measured: `vendor_overcharge` accuses, `vendor_price_increase` infers a
 * trend from a single invoice, and an association that approved a large job
 * gets neither. What the detector actually knows is that this invoice is more
 * than the threshold above what this vendor charged on average over the window
 * — so that is the name.
 *
 * Story 4.2 shipped `possible_duplicate_invoice` only because the
 * acceptance-criteria audit caught `duplicate_invoice` overclaiming after the
 * code was written. This story picked its type with that already decided.
 */
export const INVOICE_ABOVE_VENDOR_AVERAGE = 'invoice_above_vendor_average'

export interface VendorSpikeDependencies {
  readonly invoices: InvoiceReader
  readonly findings: FindingRegister
}

/**
 * One spike, as the evidence records it.
 *
 * **Derived values, not the ingredients (AD-6).** Migration 021 already quotes
 * the sentence this implements: *"a vendor-spike finding stores the computed
 * percentage over the trailing average, not the invoices it averaged."* The
 * invoices behind `average` appear nowhere here, and a test looks for their
 * identifiers in the serialised evidence rather than trusting this paragraph.
 *
 * The vendor and invoice number are kept **as written** rather than folded: a
 * board member is being asked to recognise their own paperwork. AD-8 — these
 * are extracted strings, escaped by whatever renders them and never
 * interpolated.
 */
interface EvidenceSpike extends VendorSpike {
  readonly vendorName: string | null
  readonly amount: string | null
  readonly invoiceNumber: string | null
  readonly issuedOn: string | null
}

function evidenceFor(invoice: InvoiceReading, spike: VendorSpike): EvidenceSpike {
  return {
    ...spike,
    vendorName: invoice.vendorName,
    amount: invoice.amount,
    invoiceNumber: invoice.documentNumber,
    issuedOn: invoice.issuedOn,
  }
}

/**
 * Compare every invoice on this document against its vendor's trailing average,
 * and raise what stands out.
 *
 * Returns counts rather than the findings themselves, matching
 * `detectDuplicateInvoices` — `wasAlreadyKnown` is what story 4.8 needs to avoid
 * mailing a second alert for a finding already raised.
 */
export async function detectVendorSpikes(
  documentId: string,
  deps: VendorSpikeDependencies,
): Promise<DetectionOutcome> {
  const invoices = await deps.invoices.invoicesOn(documentId)
  const byMonth = new Map<string, EvidenceSpike[]>()

  for (const invoice of invoices) {
    const history = await deps.invoices.trailingInvoices(invoice)
    const spike = spikeAgainst(invoice, history)
    if (spike === null) continue

    const month = monthOf(invoice)
    const spikes = byMonth.get(month) ?? []
    spikes.push(evidenceFor(invoice, spike))
    byMonth.set(month, spikes)
  }

  let raised = 0
  let amended = 0

  for (const [month, spikes] of byMonth) {
    const outcome: RaisedFinding = await deps.findings.raise({
      findingType: INVOICE_ABOVE_VENDOR_AVERAGE,
      subjectId: documentId,
      documentId,
      period: monthRange(month),
      evidence: {
        // UX-DR24 forbids reassurance without a count of what was checked. The
        // per-spike `invoicesAveraged` is the *other* denominator — how much
        // history each comparison rests on — and both are needed: "we checked 3
        // invoices, and one was 30% above an average of 6".
        invoicesChecked: invoices.length,
        // Both constants, because the epic requires a board member to see 20%
        // and six months without reading the source.
        thresholdPercent: SPIKE_THRESHOLD_PERCENT,
        windowMonths: TRAILING_WINDOW_MONTHS,
        spikes,
      },
    })

    if (outcome.wasAlreadyKnown) amended += 1
    else raised += 1
  }

  return { raised, amended, subjectsChecked: invoices.length }
}
