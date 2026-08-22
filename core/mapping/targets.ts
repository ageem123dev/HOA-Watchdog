/**
 * Which of the importer's columns a document of a given kind actually has.
 *
 * **Derived, never listed.** The lists below are computed from the constants
 * `readRows` itself reads — `REQUIRED_HEADERS`, `OPTIONAL_HEADERS`,
 * `ROLL_REQUIRED_HEADERS` and `KINDS_WITH_UNIT_REFERENCE`. A second hand-written
 * list would be correct on the day it was written and wrong the day a column is
 * added, and the symptom then is a mapping a treasurer completes and the
 * importer refuses.
 *
 * `record.ts` already names this defect shape one seam over: *"One statement,
 * two readers... Splitting that into two lists is how the parser comes to
 * produce a value the validator then rejects."*
 *
 * **Derivation is not proof, though**, which is why the tests do not read this
 * file. They build a header row out of what it returns, hand it to `readRows`,
 * and assert the answer — agreement observed rather than asserted.
 */

import { isDocumentKind, KINDS_WITH_UNIT_REFERENCE, type DocumentKind } from '../extraction/record'
import { OPTIONAL_HEADERS, REQUIRED_HEADERS } from '../extraction/tabular'
import { ROLL_HEADERS, ROLL_REQUIRED_HEADERS } from '../extraction/roll'

/** A column the importer knows how to read. Never a column it has retired. */
export type TargetField = (typeof REQUIRED_HEADERS)[number] | (typeof OPTIONAL_HEADERS)[number]

export interface KindTargets {
  /** Without every one of these, `readRows` refuses the file. */
  readonly required: readonly TargetField[]
  /** Read when present, and the file is within contract without them. */
  readonly optional: readonly TargetField[]
}

/**
 * Thrown rather than defaulted.
 *
 * A default list would turn a mistyped kind into a plausible-looking wizard over
 * a contract the importer will refuse — the mapping would look buildable and
 * every upload made from it would fail. `readRows` takes the same position with
 * its `unknown-kind` refusal.
 */
export class UnknownDocumentKindError extends Error {
  constructor(readonly kind: string) {
    super(`Not a document kind: ${kind}`)
    this.name = 'UnknownDocumentKindError'
  }
}

/**
 * The columns only a roll reads, so only a roll is offered them.
 *
 * `unit` is deliberately not here: it is shared with a deposit, where it is
 * genuinely optional. The roll's claim on it is that it is *required*, which is
 * `ROLL_REQUIRED_HEADERS`, not that it is roll-only.
 */
const ROLL_ONLY: readonly string[] = ROLL_HEADERS

export function targetsForKind(kind: DocumentKind): KindTargets {
  if (!isDocumentKind(kind)) throw new UnknownDocumentKindError(String(kind))

  const isRoll = kind === 'assessment_roll'
  const readsAUnit = (KINDS_WITH_UNIT_REFERENCE as readonly string[]).includes(kind)

  // Every kind owes these; a roll owes three more. Exactly the two checks
  // `readRows` makes against its header row, in the order it makes them.
  const required: TargetField[] = [
    ...REQUIRED_HEADERS,
    ...(isRoll ? ROLL_REQUIRED_HEADERS : []),
  ]

  const optional = OPTIONAL_HEADERS.filter((target) => {
    if (required.includes(target)) return false
    // A column the reader would not look at is not a target. Offered anyway, the
    // pairing reads as done and does nothing — which is worse than not offering
    // it, because the treasurer has been told their column is accounted for.
    if (target === 'unit') return readsAUnit
    if (ROLL_ONLY.includes(target)) return isRoll
    return true
  })

  return { required, optional }
}
