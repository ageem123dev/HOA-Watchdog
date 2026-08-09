/**
 * A read assessment roll becomes units, holders, tenures and assessments.
 *
 * The sibling of `record-payments.ts`, in the same slot of the same pipeline,
 * and written as one module for the reason `hold-unknown-vendors.ts` gives
 * beside them both: a rule with two implementations is a rule that will disagree
 * with itself, and the disagreement is silent.
 *
 * **Only the tabular path produces roll rows, and that is a decision rather than
 * an oversight.** A scanned roll is read by the provider, whose result type is
 * `ExtractionRecord[]` — and `core/ports/extractor.ts` rests a safety claim on
 * that type having no free-form field, so nothing can smuggle a paragraph of
 * instructions through a value. A roll row carries a person's *name*: widening
 * the provider's result to hold one is an AD-8 change and wants a decision
 * record, not a story task.
 *
 * The asymmetry runs the opposite way to story 2.5's, which is why it is
 * acceptable here and was not there. That story's unwired path was CSV — the
 * format the pilot actually uploads — which is what made the gap fatal. Here the
 * wired path is that one: an association keeps its roll in a spreadsheet, and a
 * scanned roll is the unusual case. **The limitation is real and recorded**: a
 * scanned roll stores extraction rows and creates no unit, exactly as before
 * this story, and story 2.6's README has to say so.
 */

import type { RollRow } from '../extraction/roll'
import type { RollRepository } from '../ports/roll-repository'

/** The collaborator the tabular call site injects. */
export interface RollRecordingDependencies {
  /**
   * Where a roll's units, holders, tenures and assessments are written.
   *
   * Optional, like `units` and `payments` beside it, so callers written before
   * this story keep working — and, like them, its absence is a real gap rather
   * than a neutral default: without it a roll is read and no unit is created, so
   * every deposit uploaded afterwards is held. The production call site supplies
   * it and a test says so.
   */
  readonly rolls?: RollRepository
}

/**
 * Store what a roll stated.
 *
 * Call this **before** the extraction records are stored, for the reason
 * `recordPayments` and `holdUnknownVendors` are called before them: `replace`
 * settles the document, so a roll missing after a settled extraction is silent
 * and permanent, while one missing before it leaves the document unsettled and
 * heals on the next pass. `RollRepository.apply` is idempotent (AD-13), so that
 * retry writes the same rows rather than a second copy.
 *
 * **A document with no roll rows is not a roll**, and no call is made at all —
 * `apply` refuses an empty list by design, and reaching it would turn every
 * invoice upload into a failure. That mirrors `recordPayments` refusing to call
 * `replace` for a document with no deposit lines.
 */
export async function recordRoll(
  documentId: string,
  rollRows: readonly RollRow[],
  deps: RollRecordingDependencies,
): Promise<void> {
  const { rolls } = deps
  if (rolls === undefined) return
  if (rollRows.length === 0) return

  await rolls.apply(documentId, rollRows)
}
