/**
 * The review action: three distinguishable failures become three
 * distinguishable answers (AC7).
 *
 * **The defect this file exists to prevent is a test that cannot tell them
 * apart.** `AlreadyReviewedError` means somebody got here first and the page
 * should show the review that exists; `FindingNotFoundError` means the id came
 * from somewhere it should not have. Merging them disguises the second as the
 * first, and `core/ports/finding.ts` argues the split at length.
 *
 * The guard is asserted by **the write port never being called**, not only by
 * the value returned. A server action is its own entry point, reachable without
 * the page ever rendering, so the page's session check protects nothing here —
 * the same argument `app/quarantine/actions.test.ts` makes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AlreadyReviewedError, FindingNotFoundError } from '@/core/ports/finding'
import type { FindingDetail } from '@/core/ports/finding-reader'

const auth = vi.fn()
const markReviewed = vi.fn<(findingId: string, reviewerId: string) => Promise<void>>(
  async () => undefined,
)
const byId = vi.fn<(id: string) => Promise<FindingDetail | null>>(async () => null)
/** Installed once in `beforeEach` and read by the two tests that care. */
let logged: ReturnType<typeof vi.spyOn>

vi.mock('@/adapters/auth/auth', () => ({ auth: () => auth() }))
vi.mock('@/adapters/db/finding-postgres', () => ({
  createFindingReviewer: () => ({ markReviewed }),
}))
vi.mock('@/adapters/db/finding-reader-postgres', () => ({
  createFindingReader: () => ({ byId, unreviewed: vi.fn() }),
}))

const { markFindingReviewed } = await import('./actions')

/** A real uuid, because the action refuses anything that is not one. */
const FINDING = '018f3a2b-4c5d-7e8f-9a0b-1c2d3e4f5a6b'

function reviewed(overrides: Partial<FindingDetail> = {}): FindingDetail {
  return {
    id: FINDING,
    findingType: 'possible_duplicate_invoice',
    subjectId: 'document-1',
    period: { from: '2026-04-01', until: '2026-05-01' },
    evidence: {},
    raisedOn: '2026-04-14',
    reviewed: { by: 'R. Mbeki', on: '2026-04-20' },
    ...overrides,
  }
}

beforeEach(() => {
  auth.mockResolvedValue({ user: { id: 'member-1', email: 'board@example.org' } })
  markReviewed.mockResolvedValue(undefined)
  byId.mockResolvedValue(reviewed())
  logged = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('the guard, and that it runs before the write', () => {
  it('records nothing when there is no session', async () => {
    auth.mockResolvedValue(null)

    await expect(markFindingReviewed(FINDING)).resolves.toEqual({ outcome: 'refused' })
    expect(markReviewed).not.toHaveBeenCalled()
  })

  it('records nothing when the session carries no user', async () => {
    // A truthiness check on the session alone passes this, which is why the
    // pages check both shapes and so does this.
    auth.mockResolvedValue({})

    await expect(markFindingReviewed(FINDING)).resolves.toEqual({ outcome: 'refused' })
    expect(markReviewed).not.toHaveBeenCalled()
  })

  it('records nothing when the signed-in user has no id to attribute it to', async () => {
    // `finding_review_is_attributed` refuses a reviewed row that does not name
    // who did it, so a review with no reviewer is not a review — it is a
    // constraint violation dressed as a click.
    auth.mockResolvedValue({ user: { email: 'board@example.org' } })

    await expect(markFindingReviewed(FINDING)).resolves.toEqual({ outcome: 'refused' })
    expect(markReviewed).not.toHaveBeenCalled()
  })
})

describe('AC8: an id that is not a finding id never reaches Postgres', () => {
  it.each([
    ['plainly not a uuid', 'not-a-uuid'],
    ['empty', ''],
    ['a path traversal attempt', '../../etc/passwd'],
    ['SQL-shaped', "' or '1'='1"],
    ['a uuid with a character too many', '018f3a2b-4c5d-7e8f-9a0b-1c2d3e4f5a6bb'],
  ])('answers not-found for an id that is %s, without writing', async (_name, id) => {
    // A malformed value raises 22P02 on the `uuid` cast, which would surface as
    // `failed` — "the register could not be reached" — naming the wrong thing
    // as broken. The honest answer is that there is no such finding.
    await expect(markFindingReviewed(id)).resolves.toEqual({ outcome: 'not-found' })
    expect(markReviewed).not.toHaveBeenCalled()
  })
})

describe('AC7: the three answers stay three answers', () => {
  it('records the review, attributed to the signed-in member', async () => {
    await expect(markFindingReviewed(FINDING)).resolves.toEqual({ outcome: 'recorded' })
    expect(markReviewed).toHaveBeenCalledWith(FINDING, 'member-1')
  })

  it('reports a second review as already-reviewed, naming who got there first', async () => {
    markReviewed.mockRejectedValue(new AlreadyReviewedError(FINDING))

    await expect(markFindingReviewed(FINDING)).resolves.toEqual({
      outcome: 'already-reviewed',
      by: 'R. Mbeki',
      on: '2026-04-20',
    })
  })

  it('reports an absent finding as not-found, which is a different answer', async () => {
    markReviewed.mockRejectedValue(new FindingNotFoundError(FINDING))

    await expect(markFindingReviewed(FINDING)).resolves.toEqual({ outcome: 'not-found' })
  })

  it('never returns the same answer for the two refusals', async () => {
    // The assertion AC7 is actually about. A surface that cannot separate these
    // tells a board member somebody reviewed a finding that does not exist.
    markReviewed.mockRejectedValueOnce(new AlreadyReviewedError(FINDING))
    const first = await markFindingReviewed(FINDING)

    markReviewed.mockRejectedValueOnce(new FindingNotFoundError(FINDING))
    const second = await markFindingReviewed(FINDING)

    expect(first.outcome).not.toBe(second.outcome)
  })

  it('says what is known when the reviewer has no display name', async () => {
    markReviewed.mockRejectedValue(new AlreadyReviewedError(FINDING))
    byId.mockResolvedValue(reviewed({ reviewed: { by: null, on: '2026-04-20' } }))

    await expect(markFindingReviewed(FINDING)).resolves.toEqual({
      outcome: 'already-reviewed',
      by: null,
      on: '2026-04-20',
    })
  })

  it('still reports already-reviewed when the read of who and when fails', async () => {
    // The review exists — the register said so. Reporting `failed` here would
    // say it was unreachable at the moment it had just answered.
    markReviewed.mockRejectedValue(new AlreadyReviewedError(FINDING))
    byId.mockRejectedValue(new Error('pool exhausted'))

    await expect(markFindingReviewed(FINDING)).resolves.toEqual({
      outcome: 'already-reviewed',
      by: null,
      on: null,
    })
    // "Reviewed by nobody in particular" and "reviewed by someone we could not
    // look up" are the same sentence on screen; only the log tells them apart.
    expect(logged).toHaveBeenCalled()
  })

  it('still reports already-reviewed when the finding cannot be read back', async () => {
    markReviewed.mockRejectedValue(new AlreadyReviewedError(FINDING))
    byId.mockResolvedValue(null)

    await expect(markFindingReviewed(FINDING)).resolves.toEqual({
      outcome: 'already-reviewed',
      by: null,
      on: null,
    })
  })

  it('reports an unreachable register as failed, and leaves it retryable', async () => {
    markReviewed.mockRejectedValue(new Error('connection terminated unexpectedly'))

    await expect(markFindingReviewed(FINDING)).resolves.toEqual({ outcome: 'failed' })
  })

  it('leaves a trace of what actually went wrong', async () => {
    // A deleted row, an exhausted pool, a statement timeout and a broken
    // migration all reach the board member as one sentence, and this is the
    // only write path in the story — so it is the one that most needs a record
    // of which of them happened. The same argument `app/quarantine/actions.ts`
    // makes for its own catch.
    markReviewed.mockRejectedValue(new Error('connection terminated unexpectedly'))

    await markFindingReviewed(FINDING)

    expect(logged).toHaveBeenCalled()
  })

  it('does not log a refusal, which is an ordinary answer rather than a fault', async () => {
    markReviewed.mockRejectedValue(new AlreadyReviewedError(FINDING))

    await markFindingReviewed(FINDING)

    expect(logged).not.toHaveBeenCalled()
  })
})
