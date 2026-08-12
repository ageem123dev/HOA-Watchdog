import type { FindingRegister, FindingPeriod, RaisedFinding } from '../ports/finding'
import type { InvoiceReader } from '../ports/invoice-reader'
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

/** `verb_noun`, matching `finding_type_is_verb_noun` in migration 021. */
export const DUPLICATE_INVOICE = 'duplicate_invoice'

export interface DuplicateDetectionDependencies {
  readonly invoices: InvoiceReader
  readonly findings: FindingRegister
}

export interface DetectionOutcome {
  /** Findings this run put on the register for the first time. */
  readonly raised: number
  /** Findings that were already there and had their evidence amended. */
  readonly amended: number
  /** How many invoices were compared, whether or not anything was found. */
  readonly invoicesChecked: number
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

/** `YYYY-MM` for the month a finding is filed under. */
function monthOf(invoice: InvoiceReading): string {
  // The invoice's own date when it has one. When it does not, the month the
  // document arrived — FR-6's fuzzy rule names no date, so requiring one would
  // narrow the criterion, and "when this was noticed" is an honest answer for a
  // window the invoice refuses to state.
  return (invoice.issuedOn ?? invoice.documentUploadedAt).slice(0, 7)
}

/**
 * The month as a half-open range, `[first, first-of-next)`.
 *
 * Arithmetic on the string, never through a `Date`: `new Date('2026-03-01')` is
 * midnight UTC, and formatting it west of Greenwich gives February — a March
 * finding filed under the wrong month in the column it is keyed on.
 */
function monthRange(month: string): FindingPeriod {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(5, 7))
  const nextYear = index === 12 ? year + 1 : year
  const nextIndex = index === 12 ? 1 : index + 1

  return {
    from: `${month}-01`,
    until: `${String(nextYear).padStart(4, '0')}-${String(nextIndex).padStart(2, '0')}-01`,
  }
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
      // `prior` came from `priors`, so this cannot miss — the guard exists
      // because `noUncheckedIndexedAccess` is on and a silent `undefined` would
      // put nulls into the evidence a board member reads.
      if (prior === undefined) continue

      pairs.push(evidenceFor(invoice, match, prior))
    }

    byMonth.set(month, pairs)
  }

  let raised = 0
  let amended = 0

  for (const [month, pairs] of byMonth) {
    const outcome: RaisedFinding = await deps.findings.raise({
      findingType: DUPLICATE_INVOICE,
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
