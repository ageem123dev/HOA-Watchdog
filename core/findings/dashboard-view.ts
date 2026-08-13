import type { UnreviewedQueue } from '../ports/finding-reader'
import type { DocumentsChecked } from '../ports/checked-documents'
import { toFindingRow, type FindingRow } from './finding-view'

/**
 * Which of three things the dashboard is showing.
 *
 * ## A union rather than three flags on the page
 *
 * AC7's two empty states are different sentences with different actions behind
 * them, and a page distinguishing them with `if (rows.length === 0)` gets the
 * *reassuring* one in both cases — telling a board member their records are
 * clear on the day they signed up, before anything had been looked at. Deciding
 * it once, here, is the same argument `core/quarantine/queue-view.ts` makes for
 * deciding emptiness in one place instead of per surface.
 *
 * **UX-DR24 is enforced by the shape.** `documentsChecked` is a field of
 * `nothing-to-review`, so the copy that reassures cannot be reached without the
 * count that justifies it. That rule is otherwise the kind a component quietly
 * drops during a layout change.
 */
export type DashboardView =
  /** Nothing has been read yet — either nothing was uploaded, or extraction has not finished. */
  | { readonly kind: 'nothing-checked' }
  /** Documents were read and none of them raised anything still outstanding. */
  | {
      readonly kind: 'nothing-to-review'
      readonly documentsChecked: number
      readonly asOf: string | null
    }
  | {
      readonly kind: 'findings'
      /** In the order the register gave them. */
      readonly rows: readonly FindingRow[]
      /** Every unreviewed finding, which may exceed `rows.length`. */
      readonly total: number
      readonly documentsChecked: number
      readonly asOf: string | null
    }

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The date the figures are as of, or `null` while they are current.
 *
 * UX-DR3 asks for the label "whenever underlying documents predate the current
 * period", and the period is the calendar month. Inside it the label would sit
 * on every figure on the page all month, which is how a staleness warning stops
 * being read.
 *
 * Compared as `YYYY-MM-DD` strings, which sort chronologically — but only while
 * both are well-formed. `2026-4-14` sorts *below* `2026-03-31`, so a malformed
 * `today` would silently stop labelling anything at all. That is why the caller
 * is checked rather than trusted: it is a programming error, not bad data, and
 * the honest response to one is to stop.
 */
function asOfDate(latestUploadOn: string | null, today: string): string | null {
  if (!CALENDAR_DATE.test(today)) {
    throw new RangeError(`not a calendar date: ${today}`)
  }
  if (latestUploadOn === null) return null

  const startOfMonth = `${today.slice(0, 7)}-01`
  return latestUploadOn < startOfMonth ? latestUploadOn : null
}

export function toDashboardView(
  queue: UnreviewedQueue,
  checked: DocumentsChecked,
  today: string,
): DashboardView {
  // Before the branch, so a malformed clock fails on every path rather than
  // only on the ones that happen to render a figure.
  const asOf = asOfDate(checked.latestUploadOn, today)

  // **`total`, never `findings.length`.** The rows are a bounded window; the
  // total is the register. Deciding emptiness from the window means any
  // disagreement between the two — a zero `limit`, a finding reviewed between
  // the count and the select — renders the reassuring copy over an outstanding
  // queue. A findings state holding no rows is visibly wrong, which is the
  // right way for this to fail. Raised by Argus.
  if (queue.total === 0) {
    return checked.count === 0
      ? { kind: 'nothing-checked' }
      : { kind: 'nothing-to-review', documentsChecked: checked.count, asOf }
  }

  return {
    kind: 'findings',
    // Mapped, never sorted. The adapter fixed the order — newest first, with a
    // tie-break so two renders of an unchanged register agree — and a second
    // answer here would be a sort nobody could see.
    rows: queue.findings.map(toFindingRow),
    total: queue.total,
    documentsChecked: checked.count,
    asOf,
  }
}
