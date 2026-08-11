/**
 * An answer whose every number came from the rows, or no answer at all.
 *
 * AD-7: "A pre-render validator rejects any unreferenced numeral and **forces a
 * retry**." The epic adds the word that shapes this file — the retry is
 * *invisible*. A caller receives either an accepted answer or a failure, and an
 * accepted answer carries no trace that earlier attempts were refused.
 *
 * ## Why it does not repair
 *
 * The tempting alternative is to scrub the offending numeral and return the rest.
 * That produces a sentence nobody wrote, about a member's money, with the one
 * figure a reader most wanted removed from it. Worse, an answer that admits it
 * was corrected invites exactly the manual re-checking this product exists to
 * remove. Retry or fail.
 *
 * ## Why the cap exists
 *
 * A model that cannot ground its answer usually cannot ground it on the fourth
 * try either — most often because the rows genuinely do not carry the figure the
 * question needs, which is an AD-6 problem and a new catalog entry, not a
 * retry. An uncapped loop turns that into spend without end, and hides the
 * signal that a catalog entry is missing.
 *
 * Story 3.7 owns what a board member is shown when this raises.
 */

import { validateAnswer, type Rejection } from './validate-answer'

/** Enough to clear a one-off slip; few enough that a real gap surfaces fast. */
const DEFAULT_ATTEMPTS = 3

/**
 * A blank answer is refused, and finding that out was worth a whole finding.
 *
 * `validateAnswer` is about numerals against rows, so an answer with no numerals
 * has nothing to object to — and an empty string has no numerals. It was
 * therefore *accepted*, and a caller would have shown a board member nothing at
 * all, which reads as "there is nothing to report". For a balance that is a
 * wrong financial answer with a confident face.
 *
 * The gap surfaced because CodeRabbit pointed out that a test named "never
 * returns an empty answer" duplicated the test above it and never produced one.
 * Writing the case it claimed is what exposed the behaviour.
 *
 * `numeral` is empty because nothing in particular was refused — the whole
 * answer was. The reason carries the meaning.
 */
const BLANK_ANSWER: Rejection = {
  numeral: '',
  index: 0,
  reason: 'was blank, and an empty answer reads as "there is nothing to report"',
}

export class AnswerNotGrounded extends Error {
  override readonly name = 'AnswerNotGrounded'

  constructor(
    readonly attempts: number,
    readonly lastRejection: Rejection,
  ) {
    // The numeral and the reason — never the answer. This message reaches a log,
    // and the answer it came from carries a member's balance and possibly their
    // name.
    super(
      `no grounded answer after ${attempts} attempt(s); last refused ${lastRejection.numeral} ` +
        `because it ${lastRejection.reason}`,
    )
  }
}

/**
 * Ask `produce` for an answer until one is grounded in `rows`, or give up.
 *
 * `produce` is called with `null` first, then with the rejection that refused
 * its previous attempt — so a caller can tell the model which numeral was
 * refused without this module knowing anything about models.
 */
export async function groundedAnswer(
  rows: readonly unknown[],
  produce: (rejection: Rejection | null) => Promise<string>,
  options: { attempts?: number } = {},
): Promise<string> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS

  // Checked before the first call, not after. A cap of zero with the check at
  // the bottom would call the producer once and contradict its own
  // configuration — quietly, which is the worst way for a bound to be wrong.
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError(`attempts must be a positive integer; got ${String(attempts)}`)
  }

  // The throw lives *inside* the loop, after `rejection` has been assigned a
  // non-null value. Written the obvious way — loop, then throw underneath — the
  // compiler cannot prove a rejection exists at the throw, since it cannot know
  // the body ran; the choices then are an `as` assertion or an unreachable
  // branch, and this project has no use for either. An assertion is a claim
  // nothing checks, and an unreachable branch is a guard no test can reach.
  let rejection: Rejection | null = null

  for (let attempt = 1; ; attempt += 1) {
    const answer = await produce(rejection)
    const verdict = answer.trim() === '' ? BLANK_ANSWER : validateAnswer(answer, rows)

    if (verdict === null) return answer

    rejection = verdict
    if (attempt >= attempts) throw new AnswerNotGrounded(attempts, rejection)
  }
}
