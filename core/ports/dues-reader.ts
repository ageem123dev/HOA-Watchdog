import type { AssessmentTerms } from '../assessment/schedule'
import type { ReceivedPayment } from '../detection/dues-shortfall'

/**
 * What one unit owed, what arrived, and who held it.
 *
 * `assessment` is never null, because a unit with no assessment for the year is
 * never selected: nothing was owed, so nothing can be missing. Structural
 * rather than a nullable field, so the detector cannot forget to check it.
 *
 * `holderName` is `null` when no membership covers the evaluation date. A unit
 * with no recorded holder is a gap in the roll rather than an error here, and a
 * finding that names nobody is still worth raising — the money is still short.
 */
export interface UnitDues {
  readonly unitId: string
  /** As a treasurer would recognise it, never the folded comparison key. */
  readonly unitNumber: string
  readonly assessment: AssessmentTerms
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
   * Every unit assessed for `year`, with what it owed and what arrived.
   *
   * ## The scope is the roll, not the deposit that triggered the check
   *
   * **This is the correction the acceptance-criteria audit found**, and it went
   * to the heart of the feature. Selecting units from the uploaded deposit's own
   * payments looks natural — the deposit is what changed — but a unit that has
   * paid *nothing* appears on no deposit, so the first case FR-7 names would
   * never have been found. "Identify units with missed payments" cannot mean
   * "among the units that paid".
   *
   * So a deposit upload supplies the occasion and the evaluation date, and the
   * roll supplies the subjects.
   *
   * `payments` is everything received for the year, not only what one document
   * carried — a deposit landing the second instalment must not read as though
   * the first never arrived.
   *
   * `on` selects the holder, the membership covering that date, and is the same
   * evaluation date the rule compares against, so the finding and the name it
   * carries describe the same moment.
   */
  duesForYear(year: number, on: string): Promise<readonly UnitDues[]>
}
