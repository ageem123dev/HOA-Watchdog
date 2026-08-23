/**
 * What deterministic matching could not answer (story 5.6b, AC1).
 *
 * ## Derived from the suggestion, never recomputed
 *
 * This asks `suggestColumns` what it matched and subtracts. It does **not**
 * re-run `targetForHeading` and reach its own conclusion, and that is the whole
 * design of the module: two implementations of "what matched" agree on the day
 * they are written and drift the day the alias table changes. The symptom of
 * that drift is a model asked about a column that is already paired — which
 * `assign` refuses, and the treasurer experiences as nothing happening at all.
 *
 * This project has found that shape four times over: `targetsForKind` versus a
 * hand-written list, `TARGET_LABELS` defined twice, the import scanner living in
 * four drifted copies, and the five document kinds written out in three places
 * in story 5.6. It is the defect this codebase is most prone to.
 *
 * ## Why "empty" has to mean exactly the right thing
 *
 * An empty residue is the signal that no model call is needed. Count optional
 * targets as unfilled and it never empties for an ordinary three-column export:
 * every file would cost a call, and the model would be pushed to guess at
 * columns nobody needs.
 */

import type { Heading } from '../extraction/headings'
import type { DocumentKind } from '../extraction/record'
import { MAX_HEADING_LENGTH, MAX_SUGGESTIBLE_HEADINGS, suggestColumns } from './suggest'
import { targetsForKind, type TargetField } from './targets'

export interface Residue {
  /**
   * Required targets still without a column.
   *
   * Required only. An unmatched optional column is not a question worth asking
   * a model, and treating it as one means the residue never empties.
   */
  readonly unfilled: readonly TargetField[]
  /**
   * Headings no target claimed, in file order, with their positions.
   *
   * Positions travel because a suggestion *is* a position: the model's answer
   * has to be checkable against exactly what it was offered.
   */
  readonly headings: readonly Heading[]
}

/** What `kind`'s deterministic matching left unanswered for `headings`. */
export function residueOf(headings: readonly Heading[], kind: DocumentKind): Residue {
  // `suggestColumns` first, so an unknown kind throws here exactly as it does
  // there. An empty residue would read as "nothing to ask about", which would
  // make a mistyped kind look like a fully-matched file.
  const suggestions = suggestColumns(headings, kind)
  const { required } = targetsForKind(kind)

  const claimed = new Set(
    suggestions.flatMap((suggestion) => (suggestion.position === null ? [] : [suggestion.position])),
  )

  const filled = new Set(
    suggestions.flatMap((suggestion) => (suggestion.position === null ? [] : [suggestion.target])),
  )

  return {
    unfilled: required.filter((target) => !filled.has(target)),
    // The same caps the port publishes, imported rather than restated — a
    // residue that ignored them would hand story 5.6b exactly what story 5.6
    // bounded. A blank heading is dropped too: there is nothing a model can say
    // about one, and `readHeadings` reports blanks rather than refusing a file.
    headings: headings
      .slice(0, MAX_SUGGESTIBLE_HEADINGS)
      .filter(
        (heading) =>
          !claimed.has(heading.position) &&
          heading.text.trim() !== '' &&
          heading.text.length <= MAX_HEADING_LENGTH,
      ),
  }
}
