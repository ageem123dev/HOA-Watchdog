/**
 * "A pre-render validator rejects any unreferenced numeral and **forces a
 * retry**" — AD-7, and the epic adds the word that shapes this file: the retry
 * is *invisible*.
 *
 * Two failures this exists to prevent, and the second is the quiet one:
 *
 * 1. A rejected answer being shown anyway.
 * 2. A rejected answer being *repaired* — scrubbed, truncated, or returned with
 *    a caveat. A board member cannot act on a figure that was wrong a moment ago
 *    and has been edited, and an answer that admits it was retried invites
 *    exactly the manual re-checking this product exists to remove.
 */

import { describe, expect, it, vi } from 'vitest'

import { AnswerNotGrounded, groundedAnswer } from './grounded-answer'

const ROWS = [{ unitNumber: '4B', balanceOutstanding: '240.00' }]

const TRUE_ANSWER = 'Unit 4B owes $240.00.'
const INVENTED = 'Unit 4B owes $9,999.00.'

describe('the ordinary case', () => {
  it('returns an answer whose numbers came from the rows', async () => {
    await expect(groundedAnswer(ROWS, async () => TRUE_ANSWER)).resolves.toBe(TRUE_ANSWER)
  })

  it('asks for one answer when the first is good', async () => {
    const produce = vi.fn(async () => TRUE_ANSWER)

    await groundedAnswer(ROWS, produce)

    expect(produce).toHaveBeenCalledTimes(1)
  })

  it('does not tell the first attempt about a rejection that has not happened', async () => {
    const produce = vi.fn(async () => TRUE_ANSWER)

    await groundedAnswer(ROWS, produce)

    expect(produce).toHaveBeenCalledWith(null)
  })
})

describe('the retry', () => {
  it('asks again when the first answer is not grounded', async () => {
    const produce = vi
      .fn<(rejection: unknown) => Promise<string>>()
      .mockResolvedValueOnce(INVENTED)
      .mockResolvedValueOnce(TRUE_ANSWER)

    await expect(groundedAnswer(ROWS, produce)).resolves.toBe(TRUE_ANSWER)
    expect(produce).toHaveBeenCalledTimes(2)
  })

  it('tells the retry which numeral was refused', async () => {
    const produce = vi
      .fn<(rejection: unknown) => Promise<string>>()
      .mockResolvedValueOnce(INVENTED)
      .mockResolvedValueOnce(TRUE_ANSWER)

    await groundedAnswer(ROWS, produce)

    expect(produce).toHaveBeenLastCalledWith(
      expect.objectContaining({ numeral: '$9,999.00' }),
    )
  })

  it('returns the accepted answer and nothing else', async () => {
    // AC5. No caveat, no repair, no trace of the rejected attempt.
    const produce = vi
      .fn<(rejection: unknown) => Promise<string>>()
      .mockResolvedValueOnce(INVENTED)
      .mockResolvedValueOnce(TRUE_ANSWER)

    const answer = await groundedAnswer(ROWS, produce)

    expect(answer).toBe(TRUE_ANSWER)
    expect(answer).not.toContain('9,999')
    expect(answer).not.toMatch(/retr|correct|revis|apolog/i)
  })
})

describe('when it cannot be grounded', () => {
  it('raises rather than returning the last rejected answer', async () => {
    const produce = vi.fn(async () => INVENTED)

    await expect(groundedAnswer(ROWS, produce)).rejects.toThrow(AnswerNotGrounded)
  })

  it('never returns an empty answer instead', async () => {
    // The failure this whole module exists around: an empty answer reads as
    // "there is nothing to report", which for a balance is a wrong financial
    // answer with a confident face.
    const produce = vi.fn(async () => INVENTED)

    await expect(groundedAnswer(ROWS, produce)).rejects.toThrow()
  })

  it('stops at the attempt cap rather than trying forever', async () => {
    const produce = vi.fn(async () => INVENTED)

    await expect(groundedAnswer(ROWS, produce, { attempts: 3 })).rejects.toThrow()
    expect(produce).toHaveBeenCalledTimes(3)
  })

  it('has a default cap, so a caller that forgets one still terminates', async () => {
    const produce = vi.fn(async () => INVENTED)

    await expect(groundedAnswer(ROWS, produce)).rejects.toThrow()
    expect(produce.mock.calls.length).toBeLessThanOrEqual(5)
    expect(produce.mock.calls.length).toBeGreaterThan(1)
  })

  it('refuses an attempt cap below one rather than never calling the producer', async () => {
    const produce = vi.fn(async () => TRUE_ANSWER)

    await expect(groundedAnswer(ROWS, produce, { attempts: 0 })).rejects.toThrow(RangeError)
    expect(produce).not.toHaveBeenCalled()
  })

  it('carries the last numeral it refused, and no part of the answer', async () => {
    const produce = vi.fn(async () => 'Unit 4B, held by Jane Smith, owes $9,999.00.')

    await expect(groundedAnswer(ROWS, produce)).rejects.toThrow(/9,999/)
    await expect(groundedAnswer(ROWS, produce)).rejects.not.toThrow(/Jane Smith/)
  })
})
