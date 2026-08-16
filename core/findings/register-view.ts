import type { FindingDetail, ReviewedRegister } from '../ports/finding-reader'
import { toFindingRow, type FindingRow } from './finding-view'
import { reviewMessage, type ReviewMessage } from './review'

/**
 * The register a board member reads, and which of its three states applies.
 *
 * ## Two empty screens, and telling them apart is the point
 *
 * `rows.length === 0` is true for an untouched register **and** for a search
 * that matched nothing, and the two owe opposite sentences. A surface branching
 * on the row count answers somebody who searched for one vendor with
 * reassurance about the entire record — "nothing has been reviewed yet" — which
 * is both false and the most misleading thing this page could say.
 *
 * Deciding it once, here, is the argument `core/findings/dashboard-view.ts`
 * makes for its own three states, and `core/quarantine/queue-view.ts` before it.
 *
 * ## Nothing here is a fourth wording
 *
 * This is the fourth surface to describe a finding — after the dashboard row,
 * the detail page and story 4.8's email. The row copy comes from `toFindingRow`
 * and the attribution from `reviewMessage`, both called rather than restated, so
 * the register cannot drift from the page a reader clicked through from.
 */

export interface RegisterEntry {
  /** The row copy, identical to the dashboard's for the same finding. */
  readonly row: FindingRow

  /**
   * Who reviewed it and when, in the detail page's words.
   *
   * `null` only if the register handed back a row with no review on it. The
   * port's type permits that and `finding_review_is_attributed` makes it
   * unreachable through the database — but a register row is the wrong place to
   * discover otherwise by printing "null" beside a board member's name.
   */
  readonly reviewed: ReviewMessage | null
}

export type RegisterView =
  /**
   * Nothing has been reviewed yet — the register is genuinely empty.
   *
   * EXPERIENCE.md names the copy and requires it explain that findings arrive
   * here *after review*, rather than presenting an empty record as a fault.
   */
  | { readonly kind: 'nothing-reviewed' }
  /**
   * A search that matched nothing. **Not the state above.**
   *
   * `search` is carried so the surface can name what found nothing. A reader
   * who mistyped a vendor learns that; a reader told "nothing has been reviewed
   * yet" learns something false about the whole record.
   */
  | { readonly kind: 'no-matches'; readonly search: string }
  | {
      readonly kind: 'entries'
      /** In the order the register gave them. */
      readonly entries: readonly RegisterEntry[]
      /**
       * Every finding matching the filter, which may exceed `entries.length`.
       *
       * This is the number the export control states, because it is the number
       * of rows the file will contain.
       */
      readonly total: number
      /** False when the page is a window onto a longer register, and says so. */
      readonly showingAll: boolean
    }

/**
 * The search as a filter: absent, or text with something in it.
 *
 * A blank box submits on every press of the button, so `''` and `'   '` are not
 * searches. Treating them as one puts the surface in `no-matches` and asks a
 * board member which of their three spaces was wrong.
 */
function searched(search: string | undefined): string | null {
  // **Checked at runtime, though the type says it cannot be wrong.** This value
  // comes off a URL, and `?search=a&search=b` hands Next.js a `string[]` — on
  // which `.trim()` throws and takes the page with it. `core/auth/route-policy.ts`
  // guards its own typed parameters for exactly this reason.
  //
  // Treated as absent rather than refused: a read-only surface reached by a URL
  // people edit and share should answer a repeated parameter with the register,
  // not with an error page. `app/access-log/filter.ts` makes the same call for a
  // malformed limit. Raised by Argus.
  if (typeof search !== 'string') return null

  const wanted = search.trim()

  return wanted === '' ? null : wanted
}

export function toRegisterView(
  register: ReviewedRegister,
  search?: string,
): RegisterView {
  const wanted = searched(search)

  if (register.findings.length === 0) {
    // **A contradiction rather than a state.** Zero rows against a non-zero
    // total means the register reported matches and handed back none, and there
    // is no honest sentence for it: "nothing has been reviewed" and "no matches"
    // are both claims the record does not support. The dashboard hit the same
    // disagreement between a window and its count, and Argus raised it there —
    // the difference is that this one cannot be resolved by preferring the
    // total, because there are no rows to show.
    if (register.total > 0) {
      throw new RangeError(
        `the register reported ${register.total} findings and returned none`,
      )
    }


    return wanted === null ? { kind: 'nothing-reviewed' } : { kind: 'no-matches', search: wanted }
  }

  // **The mirror of the contradiction above, refused for the same reason.** The
  // export control states this total as the number of rows the file will hold,
  // so a register that cannot state its own size is one an auditor must not be
  // handed. Unreachable through the adapter — `count(*) over ()` cannot be
  // smaller than the rows it counted — which is why it is a refusal rather than
  // a repair: preferring the larger number would invent a count to paper over a
  // port that had already gone wrong. Raised by Argus.
  if (register.findings.length > register.total) {
    throw new RangeError(
      `the register returned ${register.findings.length} findings and reported ${register.total}`,
    )
  }

  return {
    kind: 'entries',
    entries: register.findings.map(toEntry),
    total: register.total,
    // Said only when it is true, which is the rule story 4.5 set for the
    // dashboard: a reader who is shown a window and not told is a reader who
    // believes they have seen the whole record.
    showingAll: register.findings.length >= register.total,
  }
}

function toEntry(finding: FindingDetail): RegisterEntry {
  return {
    row: toFindingRow(finding),
    reviewed:
      // `== null`, catching `undefined` as well. A port omitting the field
      // entirely satisfies neither the type nor a strict check, and a strict
      // check then reads `.by` off nothing — so the register row becomes the
      // place a disagreement between layers first shows up, as a crash. Raised
      // by Argus.
      finding.reviewed == null
        ? null
        : reviewMessage({
            outcome: 'already-reviewed',
            by: finding.reviewed.by,
            on: finding.reviewed.on,
          }),
  }
}
