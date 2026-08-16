'use server'

import { auth } from '@/adapters/auth/auth'
import { createFindingReviewer } from '@/adapters/db/finding-postgres'
import { createFindingReader } from '@/adapters/db/finding-reader-postgres'
import { isFindingId } from '@/core/findings/finding-id'
import type { ReviewOutcome } from '@/core/findings/review'
import { AlreadyReviewedError, FindingNotFoundError } from '@/core/ports/finding'

/**
 * Recording that a board member has read a finding — the composition root for
 * the only write in the pilot.
 *
 * ## The session is checked here, not only on the page
 *
 * A server action is its own entry point, reachable without the page ever
 * rendering, so a page-only guard protects the view and nothing else. This is
 * the surface that writes, and the write names a person permanently.
 *
 * ## Three failures stay three answers (AC7)
 *
 * `AlreadyReviewedError` means somebody got here first — ordinary, and the page
 * should show the review that exists. `FindingNotFoundError` means the id came
 * from somewhere it should not have. An unreachable register is a third thing
 * again, and the only one worth pressing twice. Collapsing any pair of them
 * disguises a real fault as a routine one.
 */
export async function markFindingReviewed(findingId: string): Promise<ReviewOutcome> {
  const session = await auth()
  const reviewerId = session?.user?.id

  // Both shapes, as the pages distinguish them: a session object carrying no
  // user satisfies a truthiness check on the session alone. And a member with
  // no id is not somebody a review can be attributed to —
  // `finding_review_is_attributed` refuses a reviewed row that does not name
  // who did it, so writing one is a constraint violation dressed as a click.
  if (typeof reviewerId !== 'string' || reviewerId === '') return { outcome: 'refused' }

  // **Before Postgres sees it.** `finding.id` is a `uuid`, so a malformed value
  // raises 22P02 on the cast and would surface as "the register could not be
  // reached" — naming the wrong thing as broken. There is simply no such
  // finding, and this id arrives off a URL path where anything is typeable.
  if (!isFindingId(findingId)) return { outcome: 'not-found' }

  try {
    await createFindingReviewer().markReviewed(findingId, reviewerId)
    return { outcome: 'recorded' }
  } catch (error) {
    if (error instanceof AlreadyReviewedError) return await whoGotThereFirst(findingId)
    if (error instanceof FindingNotFoundError) return { outcome: 'not-found' }

    // Logged before it is discarded. A deleted row, an exhausted pool, a
    // statement timeout and a broken migration all reach the board member as
    // one sentence, and this is the only write path in the story — so it is the
    // one that most needs a trace of which actually happened. The two refusals
    // above are *answers*, not faults, and are deliberately not logged.
    console.error('recording a finding review failed', error)
    return { outcome: 'failed' }
  }
}

/**
 * Who reviewed it and when, for a review that was refused as already made.
 *
 * **A failure here is not a failed review.** The register has already said the
 * finding is reviewed; this second query only puts a name and a date to it.
 * Reporting `failed` because it did not answer would tell a board member the
 * register was unreachable at the moment it had just answered them — so what is
 * unknown stays null and the copy says only what is known.
 */
async function whoGotThereFirst(findingId: string): Promise<ReviewOutcome> {
  try {
    const finding = await createFindingReader().byId(findingId)
    const review = finding?.reviewed ?? null

    return { outcome: 'already-reviewed', by: review?.by ?? null, on: review?.on ?? null }
  } catch (error) {
    // Logged, like the write path's own failure. The answer to the board member
    // is unchanged — the review exists either way — but "reviewed by nobody in
    // particular" and "reviewed by someone we could not look up" are the same
    // sentence on screen, and only this line tells them apart afterwards. The
    // refusal itself stays unlogged: that is an answer, not a fault. Raised by
    // CodeRabbit.
    console.error('reading who reviewed a finding failed', error)
    return { outcome: 'already-reviewed', by: null, on: null }
  }
}
