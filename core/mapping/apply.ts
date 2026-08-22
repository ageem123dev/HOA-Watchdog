import type { DraftMapping } from './draft'
import { targetsForKind, type TargetField } from './targets'

/**
 * A sample's rows, re-headed with the importer's column names.
 *
 * ## Built from the mapped columns only, and that is the decision
 *
 * `readRows` matches columns by folded heading name, so "apply the mapping"
 * means producing a rectangle whose header row carries *target* names. Renaming
 * in place and leaving the unmapped columns alongside would let an unmapped
 * column headed `amount` collide with the `amount` the treasurer actually
 * mapped — and `readRows` refuses the whole file on `duplicate-headers`. The
 * treasurer would see their mapping rejected because of a column they
 * deliberately left out.
 *
 * An unmapped column cannot collide with anything if it is not there.
 *
 * ## Order is `targetsForKind`'s, not the pairings'
 *
 * `readRows` does not care about column order, but a person does: taking the
 * order from `draft.pairings` would rearrange the preview every time a pairing
 * was redone, and would make the tests depend on the order they were written in.
 */

/** The targets this draft has paired, in the importer's order. */
export function mappedTargets(draft: DraftMapping): readonly TargetField[] {
  const { required, optional } = targetsForKind(draft.kind)
  const paired = new Set(draft.pairings.map((pairing) => pairing.target))

  return [...required, ...optional].filter((target) => paired.has(target))
}

export function applyMapping(
  rows: readonly (readonly string[])[],
  draft: DraftMapping,
): readonly (readonly string[])[] {
  // Nothing in, nothing out. Not even a header: a rectangle with no header row
  // had no headings to map, and inventing one would report a column count the
  // sample never had.
  if (rows.length === 0) return []

  // Target and position resolved together, once, so the pair is a single fact
  // rather than two lookups that could disagree.
  const positionOf = new Map(draft.pairings.map((pairing) => [pairing.target, pairing.position]))
  const pairs = mappedTargets(draft).map(
    (target) => [target, positionOf.get(target) as number] as const,
  )
  const targets = pairs.map(([target]) => target)

  const [, ...dataRows] = rows

  return [
    [...targets],
    ...dataRows.map((row) =>
      // `positionOf` is built from the same pairings `mappedTargets` filtered
      // on, so every target here has one. An `undefined` branch was written
      // anyway and no test could reach it — a guard nobody asked for, which is
      // the thing this project's own directive forbids. Raised by CodeRabbit.
      pairs.map(([, position]) =>
        // **`?? ''`, never `undefined`.** A ragged row — exporters drop trailing
        // empties — would otherwise put `undefined` in the cell, which
        // stringifies to `"undefined"`: a non-empty value that parses as a
        // perfectly good vendor name. The same covers a draft built against a
        // wider sample than the rows it is applied to.
        //
        // `position` is 1-based, the number story 5.3 reports.
        row[position - 1] ?? '',
      ),
    ),
  ]
}
