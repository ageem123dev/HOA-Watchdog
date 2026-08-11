/**
 * One turn, from the gateway's side: ask, ground, or refuse.
 *
 * This is where story 3.5's validator meets story 3.6a's wire. The agent writes
 * the prose because AD-3 gives it the only model credential; AD-7 then decides
 * whether that prose may be shown, by checking every numeral against the rows of
 * the same turn.
 *
 * **One attempt, then fail** — decided 2026-08-11. AD-7 says a rejected answer
 * "forces a retry", and since 3.6a the model is across a wire, so a retry means
 * another turn: `route_question` runs again, the catalog entry is *re-executed*,
 * and different rows come back. The validator would then be checking attempt two
 * against attempt one's evidence, and AD-12 would record a second `query_log`
 * row for one question — something a board member reading the access log would
 * have to have explained to them.
 *
 * So `attempts: 1`. The producer runs once and a rejection is final. Nothing is
 * deleted: `groundedAnswer` still holds the retry for the day a narrate-only
 * endpoint exists, and the decision is a number somebody can change rather than
 * a code path somebody has to rebuild.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const askAgent = vi.fn()
const groundedAnswerSpy = vi.fn()

vi.mock('@/core/answer/grounded-answer', async () => {
  const actual =
    await vi.importActual<typeof import('@/core/answer/grounded-answer')>(
      '@/core/answer/grounded-answer',
    )
  return {
    ...actual,
    groundedAnswer: (rows: unknown, produce: unknown, options: unknown) => {
      groundedAnswerSpy(options)
      return actual.groundedAnswer(
        rows as never,
        produce as never,
        options as never,
      )
    },
  }
})

vi.mock('@/adapters/agent/chat-client', async () => {
  const actual = await vi.importActual<typeof import('@/adapters/agent/chat-client')>(
    '@/adapters/agent/chat-client',
  )
  return { ...actual, askAgent: (...args: unknown[]) => askAgent(...args) }
})

const { AnswerNotGrounded } = await import('@/core/answer/grounded-answer')
const { NoCatalogMatchError } = await import('@/adapters/agent/chat-client')
const { askOracle } = await import('./ask')

const ACTOR = '018f3a2b-0000-7000-8000-0000000000aa'

const TURN = {
  answer: 'Unit 4B owes $240.00 for 2026.',
  provenanceId: 'prov-1',
  rows: [{ unitNumber: '4B', assessmentYear: 2026, balanceOutstanding: '240.00' }],
  entryId: 'dues_status',
  version: 1,
  parameters: { unitNumber: '4B', assessmentYear: 2026 },
}

const ask = (question = 'What does 4B owe for 2026?') => askOracle({ question, actorId: ACTOR })

// `resetAllMocks`, not `clearAllMocks`. The latter clears recorded calls and
// **keeps implementations**, so a `mockResolvedValue` set in one test survives
// into the next and the next test passes against a stub it never configured.
// Verified rather than assumed. Without any reset at all the call counts also
// accumulate, and `toHaveBeenCalledTimes(1)` becomes a statement about how many
// tests have run. Raised by CodeRabbit.
beforeEach(() => {
  vi.resetAllMocks()
})

describe('a grounded answer', () => {
  it('returns the answer with the rows it came from', async () => {
    askAgent.mockResolvedValueOnce(TURN)

    const result = await ask()

    expect(result.answer).toBe('Unit 4B owes $240.00 for 2026.')
    expect(result.rows).toEqual(TURN.rows)
  })

  it('carries the entry, version and provenance id the surface needs', async () => {
    // UX-DR6 labels the disclosure `entry@version`; AD-12's id is how the
    // disclosure finds the SQL that actually ran.
    askAgent.mockResolvedValueOnce(TURN)

    const result = await ask()

    expect(result.entryId).toBe('dues_status')
    expect(result.version).toBe(1)
    expect(result.provenanceId).toBe('prov-1')
  })

  it('keeps the question, because the surface must go on showing it', async () => {
    // UX-DR11: "The question remains visible while the answer resolves." A
    // result that dropped it would make that the component's problem to
    // remember.
    askAgent.mockResolvedValueOnce(TURN)

    expect((await ask('What does 4B owe?')).question).toBe('What does 4B owe?')
  })

  it('passes the question and actor to the agent unchanged', async () => {
    askAgent.mockResolvedValueOnce(TURN)

    await ask('What does 4B owe for 2026?')

    expect(askAgent).toHaveBeenCalledWith({
      question: 'What does 4B owe for 2026?',
      actorId: ACTOR,
    })
  })
})

describe('an answer that is not grounded in the rows', () => {
  it('refuses rather than showing it', async () => {
    // The whole point of the epic, at the last moment before a screen.
    askAgent.mockResolvedValueOnce({ ...TURN, answer: 'Unit 4B owes $9,999.00 for 2026.' })

    await expect(ask()).rejects.toThrow(AnswerNotGrounded)
  })

  it.each([
    ['an invented figure', 'Unit 4B owes $9,999.00 for 2026.'],
    ['a rounded figure', 'Unit 4B owes about $241 for 2026.'],
    ['a transposed figure', 'Unit 4B owes $420.00 for 2026.'],
  ])('refuses %s', async (_label, answer) => {
    askAgent.mockResolvedValueOnce({ ...TURN, answer })

    await expect(ask()).rejects.toThrow(AnswerNotGrounded)
  })

  it('asks the agent exactly once', async () => {
    askAgent.mockResolvedValue({ ...TURN, answer: 'Unit 4B owes $9,999.00.' })

    await expect(ask()).rejects.toThrow(AnswerNotGrounded)
    expect(askAgent).toHaveBeenCalledTimes(1)
  })

})

describe('how the validator is configured', () => {
  it('configures a single attempt, which is the decision of 2026-08-11', async () => {
    // **The assertion above does not pin this**, and finding that out was the
    // point of running the sensitivity check: with a constant producer,
    // `attempts: 3` re-runs the closure without re-calling the agent, so the
    // call count is 1 either way. The decision had no observable consequence and
    // therefore no test.
    //
    // It has one now. `attempts` is what stops a future caller — one whose
    // producer *does* fetch again — from silently re-executing the catalog entry
    // and validating attempt two against attempt one's evidence.
    askAgent.mockResolvedValueOnce(TURN)

    await ask()

    expect(groundedAnswerSpy).toHaveBeenCalledWith({ attempts: 1 })
  })

  it('never returns a partially scrubbed answer', async () => {
    // Retry or fail, never repair. A sentence with the figure removed is one
    // nobody wrote, about a member's money.
    askAgent.mockResolvedValueOnce({ ...TURN, answer: 'Unit 4B owes $9,999.00 for 2026.' })

    const outcome = await ask().then(
      (r) => r,
      (e: Error) => e,
    )

    expect(outcome).toBeInstanceOf(Error)
  })
})

describe('what the surface is told when there is no answer', () => {
  it('lets a no-catalog-match through as itself', async () => {
    // Story 3.7 renders this differently from an outage, and it must not arrive
    // disguised as one.
    askAgent.mockRejectedValueOnce(new NoCatalogMatchError('no entry answers that'))

    await expect(ask()).rejects.toThrow(NoCatalogMatchError)
  })

  it('does not convert any failure into an empty answer', async () => {
    for (const failure of [
      new NoCatalogMatchError('no'),
      new Error('boom'),
    ]) {
      askAgent.mockRejectedValueOnce(failure)

      const outcome = await ask().then(() => 'resolved', () => 'rejected')

      expect(outcome).toBe('rejected')
    }
  })
})

describe('the question itself', () => {
  it.each(['', '   '])('refuses a blank question without calling the agent: %s', async (blank) => {
    // A blank question costs a model call and cannot produce an answer.
    await expect(askOracle({ question: blank, actorId: ACTOR })).rejects.toThrow(/question/)
    expect(askAgent).not.toHaveBeenCalled()
  })

  it('refuses a missing actor without calling the agent', async () => {
    // AD-12 logs who asked. A turn with no actor is a provenance row that
    // answers "who wanted to know" with nothing.
    await expect(askOracle({ question: 'q', actorId: '' })).rejects.toThrow(/actor/)
    expect(askAgent).not.toHaveBeenCalled()
  })
})
