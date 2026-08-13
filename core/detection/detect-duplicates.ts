import type { FindingRegister, RaisedFinding } from '../ports/finding'
import type { InvoiceReader } from '../ports/invoice-reader'
import { monthOf, monthRange, type DetectionOutcome } from './detection-run'
import { duplicatesAmong, type DuplicateMatch, type InvoiceReading } from './duplicate-invoice'
import { INVOICE_MATCH_RULE } from './invoice-number'

/**
 * Running duplicate detection over one uploaded document (FR-6).
 *
 * ## One finding per document per month, and the collapse is the design
 *
 * `subject_id` is one uuid and a duplicate is a pair, so something has to give.
 * Both obvious answers were probed and both fail:
 *
 * - **`extraction.id` is not stable.** It defaults to `uuidv7()` and migration
 *   006 replaces a document's rows set-shaped on re-ingest, so the same invoice
 *   gets a new id every upload. The key would change and re-ingestion would
 *   raise a second finding for a finding already raised — the sentence AD-13
 *   forbids, and the reason story 4.1 was ordered first.
 * - **`document_id` alone collapses.** A document can carry many invoices, and
 *   one in this database carries three.
 *
 * So the subject is the document and the period is the invoice's calendar
 * month — and where a document holds several duplicates in one month they
 * become **one** finding whose evidence lists every pair. Nothing is lost, and
 * it is the truer sentence for a board member: "this upload contains invoices
 * you appear to have paid already" is one thing to review, not three.
 *
 * `document_id` and `uploaded_at` are both stable across re-ingest, so running
 * detection again lands on the same key and AD-13's no-op holds.
 */

/**
 * `verb_noun`, matching `finding_type_is_verb_noun` in migration 021.
 *
 * **"possible", and the word is load-bearing.** UX-DR23 forbids implying
 * certainty the system lacks, and the epic spells this case out: *"these two
 * rows match on amount and date" is not the same claim as "you paid twice" -- an
 * association can legitimately pay one vendor the same amount on the same day.*
 *
 * The detector is exact; what it found is not. Stories 4.5 and 4.8 render this
 * type as a heading and put it in an email subject, so a type that asserted a
 * duplicate would put the claim in front of a board member no matter how
 * carefully the surrounding copy hedged. Caught by the acceptance-criteria audit:
 * the evidence reasons hedged correctly from the start and the type did not.
 */
export const POSSIBLE_DUPLICATE_INVOICE = 'possible_duplicate_invoice'

export interface DuplicateDetectionDependencies {
  readonly invoices: InvoiceReader
  readonly findings: FindingRegister
}

/**
 * One pair, as the evidence records it.
 *
 * Derived values, not the rows they came from (AD-6). The vendor and both
 * invoice numbers are kept **as written** rather than folded: a board member is
 * being asked to recognise their own paperwork, and the comparison key is no use
 * to them. AD-8 — these are extracted strings, escaped by whatever renders them
 * and never interpolated.
 */
interface EvidencePair {
  readonly reason: DuplicateMatch['reason']
  readonly vendorName: string | null
  readonly amount: string | null
  readonly invoiceNumber: string | null
  readonly issuedOn: string | null
  readonly priorDocumentId: string
  readonly priorInvoiceNumber: string | null
  readonly priorIssuedOn: string | null
}

function evidenceFor(invoice: InvoiceReading, match: DuplicateMatch, prior: InvoiceReading): EvidencePair {
  return {
    reason: match.reason,
    vendorName: invoice.vendorName,
    amount: invoice.amount,
    invoiceNumber: invoice.documentNumber,
    issuedOn: invoice.issuedOn,
    priorDocumentId: match.priorDocumentId,
    priorInvoiceNumber: prior.documentNumber,
    priorIssuedOn: prior.issuedOn,
  }
}

/**
 * Compare every invoice on this document against what came before, and raise
 * what is found.
 *
 * Returns counts rather than the findings themselves. `wasAlreadyKnown` is what
 * story 4.8 needs to avoid mailing a second alert for a finding already raised,
 * and totalling it here means the caller does not have to ask the register a
 * second question to learn whether anything is new.
 */
export async function detectDuplicateInvoices(
  documentId: string,
  deps: DuplicateDetectionDependencies,
): Promise<DetectionOutcome> {
  const invoices = await deps.invoices.invoicesOn(documentId)

  // Grouped before anything is raised, because a document with three duplicates
  // in one month is one finding. Raising per invoice would hit the same key
  // three times and only the last evidence would survive.
  const byMonth = new Map<string, EvidencePair[]>()

  for (const invoice of invoices) {
    const priors = await deps.invoices.priorCandidates(invoice)
    const matches = duplicatesAmong(invoice, priors)
    if (matches.length === 0) continue

    const month = monthOf(invoice)
    const pairs = byMonth.get(month) ?? []

    for (const match of matches) {
      const prior = priors.find((candidate) => candidate.extractionId === match.priorExtractionId)
      // `prior` came out of `priors`, so this cannot miss today. It throws
      // rather than skipping because the two failures are not equal: `continue`
      // would drop a pair from the evidence a board member reads and report
      // success, where a throw reaches `run-detection.ts` and is logged. Raised
      // by CodeRabbit — a `continue` here is a silent evidence loss waiting for
      // whoever changes the matcher.
      if (prior === undefined) {
        throw new Error(`matched invoice ${match.priorExtractionId} was not among the candidates`)
      }

      pairs.push(evidenceFor(invoice, match, prior))
    }

    byMonth.set(month, pairs)
  }

  let raised = 0
  let amended = 0

  for (const [month, pairs] of byMonth) {
    const outcome: RaisedFinding = await deps.findings.raise({
      findingType: POSSIBLE_DUPLICATE_INVOICE,
      subjectId: documentId,
      period: monthRange(month),
      evidence: {
        // UX-DR24 forbids reassurance without a count of what was checked, and
        // 4.5's copy is built from this.
        invoicesChecked: invoices.length,
        matchRule: INVOICE_MATCH_RULE,
        pairs,
      },
    })

    if (outcome.wasAlreadyKnown) amended += 1
    else raised += 1
  }

  return { raised, amended, invoicesChecked: invoices.length }
}
