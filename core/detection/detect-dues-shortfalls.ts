import type { FindingRegister, RaisedFinding } from '../ports/finding'
import type { DuesReader } from '../ports/dues-reader'
import { yearRange, type DetectionOutcome } from './detection-run'
import { shortfallAgainst } from './dues-shortfall'

/**
 * Running dues detection over one uploaded deposit (FR-7, story 4.4).
 *
 * ## The subject is a unit, and this detector is not document-shaped
 *
 * 4.2 and 4.3 both ask "is something wrong with this document?" and key their
 * findings on it. This one asks "is something *missing*?", and absence has no
 * document to hang off. So `subject_id` is the **unit** and `period` is the
 * assessment year: the thing the finding is about is a unit's standing for a
 * year, which is true regardless of which deposit happened to reveal it.
 *
 * A unit id is stable across re-ingest where an extraction id is not — the
 * problem 4.2 had to solve — because `unit` is a durable entity keyed on the
 * unit number rather than a row replaced on every upload.
 *
 * ## One finding type, and the identity constraint is why
 *
 * The epic asks for two flags, *paid late* and *paid the wrong amount*, and
 * story 4.4's AC4 allows one type if one is a special case of the other and the
 * reasoning is written down. It is, and here it is.
 *
 * `finding_identity` is `(finding_type, subject_id, period)`. Two types would
 * not collide — which is exactly the problem. A unit that has paid nothing
 * raises the *not recorded* finding; when a part-payment arrives, the same unit
 * and year would raise the *below expected* finding **beside** it, and a board
 * member would be looking at two open findings about one year's dues, one of
 * them already out of date. Nothing would ever retract the first, because
 * migration 021 makes a finding one-way by design.
 *
 * With one type, that same part-payment amends the evidence of the finding
 * already there. The distinction survives as a field, which is where a
 * difference that *changes over time* belongs — a type is an identity and this
 * is a state.
 *
 * ## What it does not claim
 *
 * `unit_dues_shortfall` is arithmetic: this much had fallen due, this much
 * arrived. It deliberately does not say *delinquent*, *overdue* or *unpaid*.
 * UX-DR23 forbids implying certainty the system lacks, and the commonest cause
 * of a shortfall is a deposit nobody has uploaded yet — the roll being out of
 * date is a failure of the records, not of the person the finding names.
 */
export const UNIT_DUES_SHORTFALL = 'unit_dues_shortfall'

export interface DuesDetectionDependencies {
  readonly dues: DuesReader
  readonly findings: FindingRegister
}

export async function detectDuesShortfalls(
  documentId: string,
  deps: DuesDetectionDependencies,
): Promise<DetectionOutcome> {
  const evaluatedOn = await deps.dues.evaluationDateFor(documentId)
  if (evaluatedOn === null) return { raised: 0, amended: 0, subjectsChecked: 0 }

  // **Every year this deposit's money is for, not only the year it arrived
  // in.** A payment settling last year's arrears has to amend last year's
  // finding; nothing else ever will, because migration 021 makes a finding
  // one-way. The evaluation year is always included, so a deposit carrying no
  // payments still checks the current roll.
  const covered = await deps.dues.yearsCoveredBy(documentId)
  const years = [...new Set([Number(evaluatedOn.slice(0, 4)), ...covered])].sort((a, b) => a - b)

  let raised = 0
  let amended = 0
  let subjectsChecked = 0

  for (const year of years) {
    const units = await deps.dues.duesForYear(year, evaluatedOn)
    subjectsChecked += units.length

    for (const unit of units) {
      const shortfall = shortfallAgainst(unit.assessment, unit.payments, evaluatedOn)
      if (shortfall === null) continue

      const outcome: RaisedFinding = await deps.findings.raise({
        findingType: UNIT_DUES_SHORTFALL,
        subjectId: unit.unitId,
        period: yearRange(year),
        evidence: {
          ...shortfall,
        // As a treasurer would recognise it, and who to ask. The holder is the
        // one who held it **at the evaluation date**, which is the whole point
        // of reading it by containment rather than by recency.
          unitNumber: unit.unitNumber,
          holderName: unit.holderName,
          // **UX-DR24's denominator is `instalmentsDue`**, which arrives above in
          // `...shortfall`. A `unitsChecked: units.length` sat here until Argus
          // read it against its own comment: the comment said "how many
          // instalments this rests on" and the value was the size of the whole
          // roll — a number about the association stored inside a finding
          // about one unit, and one that changes every time a unit is
          // assessed. Storing it would have amended every finding's evidence
          // whenever the roll grew.
        //
          // 4.2 and 4.3 do carry a count of what was compared, and correctly:
          // their findings are keyed on a document, so "of the 3 invoices on
          // this upload" is about the subject. Here it is not.
        },
      })

      if (outcome.wasAlreadyKnown) amended += 1
      else raised += 1
    }
  }

  return { raised, amended, subjectsChecked }
}
