import type { ExtractionRecord } from '../extraction/record'
import type { RollRow } from '../extraction/roll'
import { readRows, type TableProblem } from '../extraction/tabular'
import { applyMapping } from './apply'
import { completeness, type DraftMapping } from './draft'
import type { TargetField } from './targets'

/**
 * What this mapping would produce — the last cheap moment before anything writes.
 *
 * ## Records or refusal, never both
 *
 * `readRows` accumulates row problems and then returns `{ ok: false, problems }`
 * if there are any at all: *one bad row fails the document*. It never hands back
 * seventeen records and three problems, because that is not what the importer
 * would do — it would refuse the file.
 *
 * A preview showing "17 imported, 3 refused" would therefore be lying, and lying
 * in the direction that costs most: the treasurer believes the bulk of their
 * data is fine and presses on. The union below makes that shape
 * unrepresentable rather than merely discouraged.
 *
 * ## Nothing here reaches a store
 *
 * It composes `applyMapping` and `readRows` and nothing else. The preview is the
 * step *before* anything is written, and 5.7 is where a mapping is remembered.
 */

export interface PreviewCounts {
  /** Data rows actually parsed — the bounded slice. */
  readonly read: number
  /** Data rows the file holds. UX-DR24's "of 143"; may exceed `read`. */
  readonly total: number
}

export type Preview =
  | {
      readonly status: 'incomplete'
      /** Every required target still unpaired — from `completeness`, not decided again. */
      readonly missing: readonly TargetField[]
    }
  | {
      readonly status: 'would-import'
      readonly records: readonly ExtractionRecord[]
      readonly rollRows: readonly RollRow[]
      readonly counts: PreviewCounts
    }
  | {
      readonly status: 'would-refuse'
      /** Every one of them, with row numbers — not the first. */
      readonly problems: readonly TableProblem[]
      readonly counts: PreviewCounts
    }

export function previewMapping(
  rows: readonly (readonly string[])[],
  draft: DraftMapping,
  totalDataRows: number,
): Preview {
  // **Asked, not decided.** `completeness` owns which required targets remain —
  // 5.4 built it — and a second opinion here would be the two-lists defect one
  // layer out. Previewing an incomplete draft anyway would hand the treasurer
  // `missing-headers` from the parser instead of "you still need to map Amount".
  const remaining = completeness(draft)

  if (!remaining.complete) return { status: 'incomplete', missing: remaining.missing }

  const applied = applyMapping(rows, draft)

  // `read` is the rows actually parsed, not the records produced. Taken from
  // the records it reads 0 on a refusal, and the treasurer is told nothing was
  // read when in fact rows were read and found wanting.
  const counts: PreviewCounts = {
    read: Math.max(applied.length - 1, 0),
    total: totalDataRows,
  }

  // The kind comes from the draft. Previewed as the wrong kind, a roll's rows
  // vanish and the screen shows an import that would create no units.
  const result = readRows(applied, draft.kind)

  if (!result.ok) return { status: 'would-refuse', problems: result.problems, counts }

  return {
    status: 'would-import',
    records: result.records,
    rollRows: result.rollRows,
    counts,
  }
}
