import type { FindingPeriod } from './finding'

/**
 * One finding as a surface reads it.
 *
 * Named for the record rather than for the queue, because both reads return it
 * and only one of them is about unreviewed findings. `UnreviewedFinding` was
 * the earlier name and became a lie the moment a detail page could show a
 * reviewed one.
 *
 * A separate shape from what `FindingObservation` supplies, because these are
 * opposite directions through the same row: a detector writes what it computed
 * and is deliberately unable to set the lifecycle, while a surface reads the
 * lifecycle and is deliberately unable to write anything.
 */
export interface FindingRecord {
  /** The row's id, so a later story can link to it and cite it. */
  readonly id: string

  /** What kind of thing was noticed, `verb_noun`. */
  readonly findingType: string

  /** What it is about — a document, a unit, or a vendor depending on the type. */
  readonly subjectId: string

  /** The window it concerns. A shortfall that does not say *which year* is unreadable. */
  readonly period: FindingPeriod

  /**
   * What the detector computed — and `unknown`, on purpose.
   *
   * Migration 021 constrains the column to a JSON object, so
   * `Record<string, unknown>` would be true of every row written so far. It
   * would also let a view reach straight for `.kind` on a finding raised by a
   * detector that never had one, and evidence shapes are exactly what changes
   * as Epic 4 adds detectors. `unknown` makes that a compile error rather than
   * a blank row on the board's dashboard.
   */
  readonly evidence: unknown

  /**
   * The day it was noticed, `YYYY-MM-DD`.
   *
   * A date rather than an instant, for the reason `FindingPeriod` gives at
   * length: formatting a `timestamptz` west of Greenwich moves the calendar day
   * it lands on. EXPERIENCE.md requires findings to show their detection date,
   * and it must be the same date for every reader.
   */
  readonly raisedOn: string
}

/**
 * The queue, and how much of it there is.
 *
 * **One value rather than two, and that is the point.** The dashboard is a
 * bounded window onto an unbounded register — EXPERIENCE.md calls it "a queue of
 * what nobody has looked at, not a list of everything ever found" — so a caller
 * able to obtain the rows without the count could render twenty and let a board
 * member believe that was all of them. There is no shape here in which that is
 * possible.
 *
 * `total` counts every unreviewed finding, not the ones returned. When the two
 * differ the surface has to say so; it cannot quietly report the smaller one.
 */
export interface UnreviewedQueue {
  readonly findings: readonly FindingRecord[]
  readonly total: number
}

/**
 * The port through which a surface reads the queue.
 *
 * ## It cannot review, and that absence is the design
 *
 * The same argument `core/ports/finding.ts` makes for splitting `FindingRegister`
 * from `FindingReviewer`, applied to the third capability. A detector that could
 * review would sign off its own findings; a *page* that could review through the
 * object it lists them with is one careless refactor from a dashboard that
 * empties its own queue — and a board member would have no way to tell that from
 * one that was genuinely clear.
 *
 * Marking a finding reviewed is story 4.6, and it arrives through
 * `FindingReviewer`, which is a different object obtained separately.
 */
/**
 * Who signed a finding off, and when.
 *
 * `by` is nullable because `board_member.display_name` is. A reviewer who never
 * had a name still reviewed it, and saying what is known beats inventing a name
 * on the one surface whose whole purpose is to answer *which human*.
 *
 * Present as a whole or absent as a whole, which mirrors
 * `finding_review_is_attributed` — the constraint refuses a row claiming to be
 * reviewed without naming who did it and when. The shape says the same thing,
 * so nothing downstream has to handle half a review.
 */
export interface Reviewed {
  readonly by: string | null
  /** The day, `YYYY-MM-DD`, in UTC like every other date this port hands out. */
  readonly on: string
}

/**
 * One finding, with its place in the lifecycle.
 *
 * `reviewed` lives here and not on `FindingRecord` because the queue returns
 * unreviewed findings by definition — the field would be permanently null on
 * the one surface that reads it, and a caller that started trusting it there
 * would be trusting an accident of the query rather than a fact about the row.
 */
export interface FindingDetail extends FindingRecord {
  readonly reviewed: Reviewed | null
}

export interface FindingReader {
  /**
   * The unreviewed findings, newest first, and how many there are in total.
   *
   * `limit` is required rather than optional. An optional bound is one a caller
   * forgets, and the caller that forgets is a page rendering every finding the
   * association has ever accumulated into a single response.
   *
   * **It must be a whole number of at least 1, and adapters bound it from above
   * as well** — the Postgres one refuses anything over 200. Out of range, the
   * returned promise rejects with `RangeError`; it is never clamped, because a
   * caller who asked for more than a queue wanted something other than this,
   * and quietly handing them a page of it answers a question they did not ask.
   * The bound was undocumented here while the adapter enforced it, which is a
   * contract the caller could only discover by violating it. Raised by
   * CodeRabbit.
   */
  unreviewed(limit: number): Promise<UnreviewedQueue>

  /**
   * One finding, or `null` when there is no such row.
   *
   * **`null` rather than a rejection, and that is a contract.** "No such
   * finding" is an ordinary outcome here: this surface is reached by a link
   * somebody kept, and story 4.8 will send those links by email. A rejection
   * would put it in the same channel as a database failure, where the surface
   * could no longer tell "that id was never real" from "the register is down" —
   * and those two owe a board member completely different sentences.
   *
   * Distinct again from a finding that exists and has been reviewed, which
   * `core/ports/finding.ts` argues for at length: somebody got there first is
   * ordinary, and an id from nowhere is not.
   */
  byId(id: string): Promise<FindingDetail | null>
}
