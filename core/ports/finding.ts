/**
 * The ports through which a finding is raised, and through which a human
 * records that they have read it.
 *
 * AD-13: "Re-ingesting a document with an existing hash replaces that document's
 * derived rows rather than appending, and never emits a second alert for a
 * finding already raised. Alerts are keyed on `(finding_type, subject_id,
 * period)` so re-processing is a no-op. **Exactly one component owns creation of
 * each derived entity; a second write path for the same entity is a
 * violation.**"
 *
 * ## There is no `dismiss`, and there never will be
 *
 * This is the absence the file exists to argue for, so it is written down rather
 * than merely left out — a port that *lacks* a method looks like an oversight,
 * and the natural fix for an oversight is to add it.
 *
 * A board member cannot make a finding go away; they can only record that they
 * have looked at it. That is fiduciary rather than cosmetic. A register that can
 * be emptied is a register nobody can rely on, and "dismissed" is
 * indistinguishable from "hidden by whoever did not want it seen" — including
 * when the finding is about the person doing the dismissing.
 *
 * Migration 021 says the same thing where it cannot be argued with: `delete` and
 * `truncate` are revoked from `watchdog_writer` and from `public`, so a method
 * declared here would be a method the database refuses with a `42501` on its
 * first call. The type and the grant agree, which is the arrangement migration
 * 007's comment argues for — a second statement of a shape is safe when
 * something fails on disagreement.
 *
 * ## Two ports, because these are two capabilities
 *
 * `core/ports/query-log.ts` and `query-log-reader.ts` split for this reason and
 * the argument transfers exactly: a capability nothing declares is a capability
 * nothing can quietly acquire. A detector needs to raise findings and has no
 * business signing them off — an object holding both methods is one refactor
 * away from a detector that raises a finding and marks it reviewed in the same
 * breath, which is dismissal with the paperwork filled in.
 */

/**
 * The window a finding concerns: `from` inclusive, `until` exclusive.
 *
 * ## Two strings rather than two `Date`s, and that is deliberate
 *
 * A `Date` is an instant; a period boundary is a calendar day. `new
 * Date('2026-03-01')` is midnight **UTC**, and formatting it anywhere west of
 * Greenwich gives 2026-02-28 — a March finding filed under February, in the
 * column the whole table is keyed on. Nothing in the type system catches that,
 * and it appears only for the users in the wrong timezone.
 *
 * ## Both ends required
 *
 * Matching `finding_period_is_bounded` in migration 021. An open-ended period is
 * a window that grows with the date it is read on: "from June onwards", read in
 * 2030, covers four years it did not cover when it was written, and a register
 * of evidence cannot hold an entry that quietly means more each year. A detector
 * meaning "still ongoing" bounds it at today, which says the same thing and
 * keeps saying it.
 *
 * Half-open (`[from, until)`) because that is the form Postgres canonicalises a
 * `daterange` into, so the same month has exactly one spelling on both sides of
 * the adapter.
 */
export interface FindingPeriod {
  /** The first day the finding covers, `YYYY-MM-DD`. */
  readonly from: string
  /** The first day it does **not** cover, `YYYY-MM-DD`. */
  readonly until: string
}

/**
 * What a detector saw, as it supplies it.
 *
 * Every field of the lifecycle is missing on purpose. A detector that could set
 * `state` could raise a finding already marked reviewed; one that could set
 * `raisedAt` could place a finding outside the window an auditor is looking at.
 * Both are stamped by the database, so neither is a caller's to choose — the
 * same argument `QueryLogEntry` makes for omitting `executedAt`.
 */
export interface FindingObservation {
  /** What kind of thing was noticed, `verb_noun`. */
  readonly findingType: string

  /**
   * What it is about — a document, a unit, or a vendor depending on the type.
   *
   * Untyped as a foreign key for the reason migration 021 gives: constraining it
   * to one table would mean three tables, and three tables would mean three ways
   * to raise the same finding twice.
   */
  readonly subjectId: string

  /** The window it concerns. Part of the key, so it is never optional. */
  readonly period: FindingPeriod

  /**
   * What the detector computed.
   *
   * AD-6: derived values, not the ingredients — the percentage over the trailing
   * average, not the invoices that were averaged.
   */
  readonly evidence: Readonly<Record<string, unknown>>
}

/**
 * What raising one gives back.
 *
 * `wasAlreadyKnown` is the field story 4.8 needs and cannot work out for itself.
 * AD-13 forbids emitting "a second alert for a finding already raised", and a
 * mailer that fired on every raise would do exactly that — the no-op would hold
 * in the table and fail in the inbox, which is the failure a board member
 * actually experiences.
 *
 * It is returned rather than discovered by a preceding `select`, because a
 * read-then-write cannot answer it correctly: two detection runs arriving
 * together would both read "absent" and both believe they raised it.
 */
export interface RaisedFinding {
  /** The row's id, so the caller can cite or review it. */
  readonly id: string

  /** True when the finding was already on the register and this call amended it. */
  readonly wasAlreadyKnown: boolean
}

export interface FindingRegister {
  /**
   * Raise the finding, or amend the one already there. Never append a second.
   *
   * The contract is **raise or update**, and the no-op is the database's
   * guarantee rather than this code's: the key `(finding_type, subject_id,
   * period)` is a unique constraint, so two concurrent detection runs produce
   * one row whatever order they arrive in.
   *
   * Amending touches the evidence and **nothing else**. A re-raise must not
   * resurrect a reviewed finding as unreviewed: that would let a re-upload
   * quietly undo a board member's review, which is dismissal wearing a different
   * hat and would arrive by accident rather than by decision.
   */
  raise(observation: FindingObservation): Promise<RaisedFinding>
}

/**
 * Reviewing a finding that has already been reviewed.
 *
 * **Refused rather than silently accepted, and the choice matters.** Letting the
 * second review through would overwrite `reviewed_by`, erasing the first board
 * member's name from the record of who looked — the register's whole purpose is
 * to answer *which human*. Treating it as a quiet no-op fails the other way: the
 * caller is told their review was recorded when the row names somebody else.
 *
 * So it fails loudly, carrying the id, and the surface can say what is true —
 * this was already reviewed, and here is by whom.
 */
export class AlreadyReviewedError extends Error {
  override readonly name = 'AlreadyReviewedError'

  constructor(readonly findingId: string) {
    super(`finding ${findingId} has already been reviewed; this review was refused`)
  }
}

/**
 * No such finding.
 *
 * Distinct from `AlreadyReviewedError` because the two mean opposite things to
 * whoever reads the surface. "Somebody got here first" is ordinary and the page
 * should show the review that exists; "no such finding" means the id came from
 * somewhere it should not have, and merging them would disguise the second as
 * the first.
 */
export class FindingNotFoundError extends Error {
  override readonly name = 'FindingNotFoundError'

  constructor(readonly findingId: string) {
    super(`finding ${findingId} does not exist`)
  }
}

export interface FindingReviewer {
  /**
   * Record that a board member has read the finding.
   *
   * One-way. There is no argument for the target state because there is only one
   * — `unreviewed → reviewed`, and migration 021's
   * `finding_review_is_attributed` refuses any row that claims to be reviewed
   * without naming who did it and when.
   *
   * `reviewedAt` is not a parameter for the same reason `QueryLogEntry` has no
   * `executedAt`: the database stamps it, so nobody can record that they looked
   * at something last Tuesday.
   *
   * Rejects with `AlreadyReviewedError` or `FindingNotFoundError`. Both are
   * failures the caller must not swallow — a review that did not happen must not
   * look like one that did.
   */
  markReviewed(findingId: string, reviewerId: string): Promise<void>
}
