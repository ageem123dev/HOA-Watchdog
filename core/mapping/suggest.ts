/**
 * A guess at which column is which — offered, never applied (story 5.6).
 *
 * ## The port, and what may cross it
 *
 * `ColumnSuggester` is the seam story 5.6b puts a model behind. It takes
 * *headings and a kind*, and returns *suggested pairings*. That is all it may
 * take. If an implementation needs a store, a client or an association id, the
 * seam is drawn in the wrong place — and the import scan in `suggest.test.ts` is
 * what says so.
 *
 * ## Why the boundary is here rather than at the model
 *
 * epics.md gives the deterministic half no failure mode: *"no prompt, no
 * credential and no failure mode. The model earns its place on the residue."*
 * The bounds and the import restriction are written now, while nothing crosses
 * them, because a bound added later is a bound added to a live path.
 *
 * **Human confirmation is not the control here.** The PRD is explicit: a
 * treasurer confirming a mapping governs what is *stored*, while prompt
 * injection is about what the runtime *does* on the way there. So the control is
 * what this module is *able* to reach, which is nothing — asserted structurally,
 * because no behavioural test can show the absence of a credential the code
 * never asks for.
 */

import type { Heading } from '../extraction/headings'
import type { DocumentKind } from '../extraction/record'
import { targetForHeading } from './heading-match'
import { targetsForKind, type TargetField } from './targets'

/**
 * How many headings are considered, at most.
 *
 * A real export has tens of columns; this is far above that and far below
 * anything that would matter. It is a ceiling on what 5.6b can be handed, not a
 * limit anyone is expected to meet.
 */
export const MAX_SUGGESTIBLE_HEADINGS = 256

/**
 * How long a heading may be before it is ignored, in characters.
 *
 * Counted in the unit it claims. Story 5.5's byte bound counted UTF-16 code
 * units, so a "256 KB" payload weighed 688 KB — a cap measured in the wrong unit
 * is not a cap.
 */
export const MAX_HEADING_LENGTH = 128

export interface Suggestion {
  readonly target: TargetField
  /**
   * The column's 1-based position, or `null` for "considered, nothing found".
   *
   * `null` rather than omission, because a treasurer needs those to look
   * different: one says the suggester looked and had no answer, the other says
   * nothing at all.
   */
  readonly position: number | null
}

/** The seam story 5.6b implements with a model. Headings and a kind, nothing else. */
export interface ColumnSuggester {
  suggest(headings: readonly Heading[], kind: DocumentKind): readonly Suggestion[]
}

/**
 * Suggest a column for each target of `kind`, deterministically.
 *
 * Every required target comes back, matched or not. An optional target comes
 * back only when a heading named it — an unmatched optional column is not news.
 */
export function suggestColumns(
  headings: readonly Heading[],
  kind: DocumentKind,
): readonly Suggestion[] {
  // First, so an unknown kind throws rather than yielding an empty suggestion
  // list that reads as "nothing matched". `targetsForKind` takes that position
  // for the same reason.
  const { required, optional } = targetsForKind(kind)

  const found = new Map<TargetField, number>()

  // Bounded before anything is read, in file order so the leftmost heading wins.
  // A treasurer reads their file left to right; a suggestion pointing at column
  // 7 when column 2 says the same thing looks arbitrary.
  for (const heading of headings.slice(0, MAX_SUGGESTIBLE_HEADINGS)) {
    if (heading.text.length > MAX_HEADING_LENGTH) continue

    const target = targetForHeading(heading.text)
    if (target === null) continue

    // The only refusal that is reachable: a target already spoken for. A pairing
    // `assign` would refuse is one the treasurer experiences as nothing
    // happening, so first-match-wins and the rest of the rule is structural.
    //
    // **Two guards were deleted here rather than kept.** A `claimed` set of
    // positions is unreachable - one heading yields one target, so two targets
    // cannot want the same column. A `!offered.has(target)` filter is redundant
    // - the result below is built from `required` and `optional`, so a target
    // the kind does not publish has nowhere to be emitted. Both survived
    // mutation, which is what said they were guarding nothing.
    if (found.has(target)) continue

    found.set(target, heading.position)
  }

  return [
    ...required.map((target) => ({ target, position: found.get(target) ?? null })),
    ...optional.flatMap((target) => {
      const position = found.get(target)
      return position === undefined ? [] : [{ target, position }]
    }),
  ]
}

/** The deterministic suggester, as a port implementation. */
export const deterministicSuggester: ColumnSuggester = { suggest: suggestColumns }
