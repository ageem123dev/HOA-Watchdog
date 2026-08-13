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

  const year = Number(evaluatedOn.slice(0, 4))
  const units = await deps.dues.duesForDocument(documentId, year, evaluatedOn)

  let raised = 0
  let amended = 0

  for (const unit of units) {
    // No assessment is not a shortfall of the whole amount. Nothing was owed,
    // so nothing can be missing, and a unit that is simply not on the roll yet
    // must not be reported as owing everything.
    if (unit.assessment === null) continue

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
        // UX-DR24's count: how many instalments this rests on. A shortfall
        // figure with no denominator is the reassurance that rule forbids.
        unitsChecked: units.length,
      },
    })

    if (outcome.wasAlreadyKnown) amended += 1
    else raised += 1
  }

  return { raised, amended, subjectsChecked: units.length }
}
