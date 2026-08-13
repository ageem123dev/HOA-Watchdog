import type { AssessmentTerms } from '../assessment/schedule'
import type { ReceivedPayment } from '../detection/dues-shortfall'

/**
 * What one unit owed, what arrived, and who held it.
 *
 * `assessment` is `null` when no assessment was recorded for that unit and year.
 * **That is not a shortfall of the whole amount** — nothing was owed, so nothing
 * can be missing. The distinction has to survive out of SQL, which is why this
 * is a nullable field rather than a zero.
 *
 * `holderName` is `null` when no membership covers the evaluation date. A unit
 * with no recorded holder is a gap in the roll rather than an error here, and a
 * finding that names nobody is still worth raising — the money is still short.
 */
export interface UnitDues {
  readonly unitId: string
  /** As a treasurer would recognise it, never the folded comparison key. */
  readonly unitNumber: string
  readonly assessment: AssessmentTerms | null
  readonly payments: readonly ReceivedPayment[]
  readonly holderName: string | null
}

/**
 * The port through which dues detection reads.
 *
 * **Read-only, and the absence of a write method is the design** — the same
 * argument `core/ports/invoice-reader.ts` makes. A detector that could edit a
 * payment could quietly make its own findings true, and arrears is the finding
 * where that matters most: it names a person.
 *
 * ## One call per document, not one per unit
 *
 * The signature takes a document and returns every unit it touched, rather than
 * answering for one unit at a time. Story 4.3's merge request drew exactly that
 * finding against the vendor-spike detector — a window query per invoice — and
 * the answer there was that the bound was small. Here the bound is *units on a
 * deposit*, which is the whole association: 26 units today and no ceiling. So
 * the N+1 is designed out rather than argued about.
 */
export interface DuesReader {
  /**
   * The date this deposit was taken as evidence of, as `YYYY-MM-DD`, or `null`
   * if the document is unknown.
   *
   * **The detector's clock, and it is a property of the document rather than of
   * the moment the question is asked.** Uploading a deposit is when the
   * association's record of what has arrived is most complete, so it is the
   * honest date to ask "what has not?" — and it does not move, so re-running
   * detection next year gives the same answer and AD-13's no-op keeps meaning
   * something. Story 2.3 kept the schedule clock-free for the same reason; a
   * detector that reached for `now()` would undo it.
   *
   * The cost is stated rather than discovered: a deposit uploaded in January
   * covering the previous year is evaluated against the *new* year's schedule.
   * Re-running detection for a chosen year is the fix, not a heuristic here.
   */
  evaluationDateFor(documentId: string): Promise<string | null>
  /**
   * Every unit the given deposit document recorded a payment against, with what
   * that unit owed for `year` and everything that arrived toward it.
   *
   * `payments` is **not** limited to the ones this document carried. A unit's
   * standing is the sum of everything received for the year; a deposit that
   * lands a second instalment must not read as though the first never arrived.
   *
   * `on` selects the holder — the membership covering that date — and is the
   * same evaluation date the rule is asked to compare against, so the finding
   * and the name it carries describe the same moment.
   */
  duesForDocument(documentId: string, year: number, on: string): Promise<readonly UnitDues[]>
}
