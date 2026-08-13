/**
 * What the surface says about a review, and whether it offers to try again.
 *
 * The copy lives in `core/` for the reason `finding-view.ts`'s header gives, and
 * one addition this file supplies: **`canRetry` is a fiduciary judgement, not a
 * styling detail.** Three of the four outcomes are answers — the review landed,
 * somebody got there first, that finding does not exist — and offering to retry
 * an answer invites a board member to press until the register agrees with them.
 * Only an unreachable register is worth a second attempt.
 */

import { describe, expect, it } from 'vitest'

import { REVIEW_UNDO_WINDOW_MS, reviewMessage } from './review'

describe('the window', () => {
  it('is long enough to reach the undo and short enough to leave', () => {
    // Asserted as a range rather than as the number, because the number is a
    // judgement and the range is the requirement. Below a second nobody catches
    // a misclick; above ten, a board member who clicks and navigates away
    // routinely loses a review they believe they recorded — and an interrupted
    // window records nothing by design.
    expect(REVIEW_UNDO_WINDOW_MS).toBeGreaterThanOrEqual(1_000)
    expect(REVIEW_UNDO_WINDOW_MS).toBeLessThanOrEqual(10_000)
  })
})

describe('what the surface says once the register has answered', () => {
  it('speaks in the past tense when the review was recorded', () => {
    expect(reviewMessage({ outcome: 'recorded' })).toEqual({
      text: 'Moved to register.',
      canRetry: false,
    })
  })

  it('names who got there first, and when', () => {
    const message = reviewMessage({ outcome: 'already-reviewed', by: 'R. Mbeki', on: '2026-04-02' })

    expect(message.text).toBe('Already reviewed by R. Mbeki on 2026-04-02.')
    // Not a failure to retry. The register is right and the reader is late.
    expect(message.canRetry).toBe(false)
  })

  it('says what is known when the reviewer never had a display name', () => {
    // `board_member.display_name` is nullable, and inventing a name on the one
    // surface whose purpose is to answer *which human* is the worst available
    // answer. `finding_review_is_attributed` still guarantees the date.
    const message = reviewMessage({ outcome: 'already-reviewed', by: null, on: '2026-04-02' })

    expect(message.text).toBe('Already reviewed on 2026-04-02.')
    expect(message.text).not.toMatch(/null|undefined|by\s*\./i)
  })

  it('says a finding that does not exist was not recorded, and does not offer to retry', () => {
    const message = reviewMessage({ outcome: 'not-found' })

    expect(message.text).toMatch(/nothing was recorded/i)
    expect(message.canRetry).toBe(false)
  })

  it('offers another attempt only when the register could not be reached', () => {
    const message = reviewMessage({ outcome: 'failed' })

    expect(message.text).toMatch(/nothing was recorded/i)
    expect(message.canRetry).toBe(true)
  })

  it('never claims the move except when the move happened', () => {
    const others = [
      reviewMessage({ outcome: 'already-reviewed', by: 'R. Mbeki', on: '2026-04-02' }),
      reviewMessage({ outcome: 'not-found' }),
      reviewMessage({ outcome: 'failed' }),
    ]

    for (const message of others) {
      expect(message.text).not.toMatch(/moved to register/i)
    }
  })

  it('says nothing that reads as a system error to a board member', () => {
    const all = [
      reviewMessage({ outcome: 'recorded' }),
      reviewMessage({ outcome: 'already-reviewed', by: null, on: '2026-04-02' }),
      reviewMessage({ outcome: 'not-found' }),
      reviewMessage({ outcome: 'failed' }),
    ]

    for (const message of all) {
      expect(message.text).not.toMatch(/error|exception|null|undefined|500|failed to/i)
    }
  })
})
