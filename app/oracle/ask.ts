import { askAgent } from '@/adapters/agent/chat-client'
import { groundedAnswer } from '@/core/answer/grounded-answer'

/**
 * One Oracle turn: ask the agent, and let AD-7 decide whether the answer may be
 * shown.
 *
 * This is where story 3.5's validator meets story 3.6a's wire. The agent writes
 * the prose, because AD-3 gives it the only model credential and Node has none.
 * AD-7 then checks every numeral in that prose against the rows of the same
 * turn, and nothing ungrounded reaches a screen.
 *
 * ## One attempt, then fail
 *
 * Decided 2026-08-11, and **AD-7 was amended to match on 2026-08-12** — the
 * retry is the reader's now, not the system's. A refusal is shown honestly and
 * asking again is a new question, logged as one.
 *
 * The reason, recorded because the amendment turns on it: since story 3.6a the
 * model is across a wire, so an automatic retry means *another turn* —
 * `route_question` runs again, the catalog entry is **re-executed**, and
 * different rows come back. Two things go wrong at once: the validator would be
 * checking attempt two against attempt one's evidence, and AD-12 would record a
 * second `query_log` row for one question, which a board member reading the
 * access log would have to have explained to them.
 *
 * The fix that keeps the retry is a narrate-only endpoint taking the rows
 * already returned, and that collides with AD-17's request clause. Rather than
 * amend a second AD for a capability nothing yet needs, this passes
 * `attempts: 1`.
 *
 * **`attempts: 1` rather than calling `validateAnswer` directly**, deliberately.
 * The retry still exists in `groundedAnswer`, tested and ready for the day that
 * endpoint does; the decision is a number somebody can change rather than a code
 * path somebody has to rebuild. And the failure a board member eventually sees
 * is `AnswerNotGrounded` either way, so story 3.7 has one thing to render rather
 * than two.
 */

export interface OracleQuestion {
  readonly question: string
  readonly actorId: string
}

export interface OracleAnswer {
  /**
   * The question, carried back.
   *
   * UX-DR11: "The question remains visible while the answer resolves." Returning
   * it makes that the surface's to *render* rather than its to *remember* — a
   * component holding the question separately is a component that can lose it.
   */
  readonly question: string

  readonly answer: string
  readonly rows: readonly Record<string, unknown>[]

  /** UX-DR6 labels the query disclosure with these. */
  readonly entryId: string
  readonly version: number

  /**
   * AD-12's receipt, and how the disclosure finds the SQL that *actually ran*
   * rather than what the catalog says today.
   */
  readonly provenanceId: string
}

export async function askOracle({ question, actorId }: OracleQuestion): Promise<OracleAnswer> {
  // Refused before the agent is called. A blank question costs a model call and
  // cannot produce an answer; a turn with no actor writes a provenance row that
  // answers "who wanted to know" with nothing.
  if (question.trim() === '') throw new RangeError('a question is required')
  if (actorId.trim() === '') throw new RangeError('an actorId is required')

  const turn = await askAgent({ question, actorId })

  // The rows are fetched once, and the answer is validated against those rows —
  // never against a later turn's. `produce` ignores its rejection argument
  // because there is no second attempt for it to inform.
  const answer = await groundedAnswer(turn.rows, async () => turn.answer, { attempts: 1 })

  return {
    question,
    answer,
    rows: turn.rows,
    entryId: turn.entryId,
    version: turn.version,
    provenanceId: turn.provenanceId,
  }
}
