/**
 * Recording that a board member has read a finding — the one action in the
 * pilot, and the only place a click changes the record.
 *
 * EXPERIENCE.md: *"Destructive and irreversible actions do not exist in the
 * pilot beyond marking a finding reviewed."* Everything else the board can do is
 * reading. What this file holds is the shape of that one exception.
 */

/**
 * How long the surface holds the write before issuing it.
 *
 * ## Why a held write rather than an undo
 *
 * EXPERIENCE.md requires the action to be undoable — *"a misclick must not
 * require database access to correct"* — and migration 021 makes it permanent in
 * a trigger, revoking `delete` from the writer role and refusing any change to a
 * reviewed row. Both are load-bearing: the undo protects a board member from
 * their own mouse, and the permanence is why a register nobody can quietly empty
 * is worth having.
 *
 * They are only in conflict if the write happens first. So it does not. Nothing
 * is issued until this window closes, and the undo cancels a write that never
 * happened — no database access, no constraint touched, and migration 021 stands
 * exactly as written.
 *
 * ## Why five seconds, and what the number is trading off
 *
 * **Longer is not safer here, and that is the opposite of the usual intuition.**
 * An interrupted window records nothing — navigating away, closing the tab, or a
 * crash all resolve to "not written", which is the conservative direction for a
 * record that names a person. But it means every second of this window is a
 * second in which a board member who has moved on loses a review they believe
 * they made.
 *
 * So the window is bounded by the impatience of the person who just clicked:
 * long enough to notice a misclick and reach the control, short enough that
 * clicking and leaving is very likely to record. Five seconds is the same order
 * as the undo affordances people already know, and it is a judgement rather than
 * a derivation — which is why it is named, reasoned about here, and asserted by
 * the tests rather than typed inline.
 */
export const REVIEW_UNDO_WINDOW_MS = 5_000

/**
 * What issuing the review turned out to mean.
 *
 * The three failures are kept apart on purpose, and `core/ports/finding.ts`
 * makes the argument at length: *somebody got here first* is ordinary and the
 * page should show the review that exists, where *no such finding* means the id
 * came from somewhere it should not have. Collapsing them would disguise the
 * second as the first, and `failed` — the register being unreachable — is a
 * third thing again, because it is the only one worth trying twice.
 */
export type ReviewOutcome =
  | { readonly outcome: 'recorded' }
  /**
   * `on` is nullable because the date is read *after* the refusal, in a second
   * query that can itself fail. The review still exists when it does, and
   * reporting that as `failed` would tell a board member the register was
   * unreachable at the moment it had just answered them.
   */
  | { readonly outcome: 'already-reviewed'; readonly by: string | null; readonly on: string | null }
  | { readonly outcome: 'not-found' }
  | { readonly outcome: 'failed' }
  /**
   * The caller is not signed in. Distinct from `failed`: nothing was attempted,
   * and nothing about the register is known to be wrong.
   */
  | { readonly outcome: 'refused' }

/** What the surface says, and whether pressing again could change the answer. */
export interface ReviewMessage {
  readonly text: string
  /**
   * Whether another attempt could give a different answer.
   *
   * **A fiduciary judgement rather than a styling detail.** Three of the four
   * outcomes are answers — it landed, somebody got there first, that finding is
   * not on the register — and offering to retry an answer invites a board member
   * to press until the register agrees with them. Only an unreachable register
   * is worth a second attempt, because only that one might say something else.
   */
  readonly canRetry: boolean
}

/**
 * What the board member is told, in one place.
 *
 * Never a system error. Every sentence here is read by somebody deciding what to
 * do next, and "500" or "failed to update finding" tells them nothing they can
 * act on while implying the register is broken.
 */
export function reviewMessage(outcome: ReviewOutcome): ReviewMessage {
  switch (outcome.outcome) {
    case 'recorded':
      // Past tense, and only here. EXPERIENCE.md: "Every action states its
      // outcome in the past tense afterwards" — the point being *afterwards*.
      return { text: 'Moved to register.', canRetry: false }

    case 'already-reviewed':
      return {
        // The name is omitted rather than filled in when the reviewer never had
        // one. `board_member.display_name` is nullable, and this is the one
        // surface whose whole purpose is to answer *which human* — inventing a
        // name here is the worst available answer, and "by null" is the second
        // worst. The date is guaranteed by `finding_review_is_attributed`.
        text: alreadyReviewed(outcome.by, outcome.on),
        canRetry: false,
      }

    case 'not-found':
      // Not an error, and not the same sentence as the one above. The id came
      // from somewhere it should not have; pressing again cannot change that.
      return { text: 'That finding is not on the register. Nothing was recorded.', canRetry: false }

    case 'failed':
      return { text: 'The register could not be reached. Nothing was recorded.', canRetry: true }

    case 'refused':
      // Not a retry: pressing again signed out does the same nothing.
      return { text: 'You are not signed in. Nothing was recorded.', canRetry: false }
  }
}

/**
 * Who reviewed it and when, saying only what is known.
 *
 * Shared by the refusal and by the ordinary already-reviewed page, which are the
 * same fact reached two ways — a board member who arrives late and one who
 * presses the control a moment too late must not be told it in two different
 * sentences.
 */
function alreadyReviewed(by: string | null, on: string | null): string {
  if (by === null && on === null) return 'Already reviewed.'
  if (by === null) return `Already reviewed on ${on}.`
  if (on === null) return `Already reviewed by ${by}.`
  return `Already reviewed by ${by} on ${on}.`
}
