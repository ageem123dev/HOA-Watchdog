/**
 * The upload action's refusals (story 5.8).
 *
 * ## Why this file did not exist until now
 *
 * `app/upload/actions.ts` had no direct tests. `upload-form.test.tsx` mocks it
 * away to render the form, and everything below the action is covered in
 * `core/ingestion`. So the guards *in* the action — session, kind, file count,
 * size — were each argued for in a comment and asserted nowhere.
 *
 * Story 5.8 adds a fifth guard whose whole point is refusing a submission, which
 * is not a thing that can be proven anywhere else.
 *
 * ## The one that would be worst to get wrong
 *
 * Refusing *every* kind rather than only deposits. A treasurer on a fresh
 * install would be unable to upload the assessment roll — the one thing that
 * clears the condition — and the trap this story exists to remove would become
 * permanent and inescapable. It is asserted for all five kinds, not just for
 * the roll.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.fn()
const hasUnits = vi.fn<(member: string) => Promise<boolean>>(async () => true)
const ingest = vi.fn(async () => [])

vi.mock('@/adapters/auth/auth', () => ({ auth: () => auth() }))
vi.mock('@/adapters/db/unit-census-postgres', () => ({
  createUnitCensus: () => ({ hasUnits: (member: string) => hasUnits(member) }),
}))
vi.mock('@/core/ingestion/ingest', () => ({ ingest: (...args: unknown[]) => ingest(...(args as [])) }))
// The composition reaches S3 and Postgres at module scope, which a unit test
// must not. What it *contains* is asserted by `app/ingestion-dependencies.test.ts`.
vi.mock('../ingestion-dependencies', () => ({ ingestionDependencies: () => ({}) }))

const SIGNED_IN = { user: { id: 'director-1' } }

const file = (name = 'march.csv') =>
  new File([new TextEncoder().encode('date,description,amount\r\n2026-03-01,x,1.00\r\n')], name, {
    type: 'text/csv',
  })

const form = (kind: string, files: readonly File[] = [file()]): FormData => {
  const data = new FormData()
  data.append('documentKind', kind)
  for (const one of files) data.append('documents', one)
  return data
}

const upload = async (kind: string, files?: readonly File[]) => {
  const { uploadDocuments } = await import('./actions')
  return uploadDocuments({ outcomes: [], error: null }, form(kind, files))
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue(SIGNED_IN)
  // `clearAllMocks` clears calls but keeps implementations, so a value set by
  // one test would survive into the next.
  hasUnits.mockResolvedValue(true)
  ingest.mockResolvedValue([])
})

describe('deposits before a roll (story 5.8)', () => {
  it('uploads deposits normally once the association holds units', async () => {
    /**
     * The control, and it is doing real work here: without it every assertion
     * below is satisfied by an action that refuses every submission. It is also
     * 2d — the refusal must not fire when units exist.
     */
    hasUnits.mockResolvedValue(true)

    const state = await upload('deposit')

    expect(state.error).toBeNull()
    expect(ingest).toHaveBeenCalledTimes(1)
  })

  it('refuses deposits while the association holds no units', async () => {
    hasUnits.mockResolvedValue(false)

    const state = await upload('deposit')

    expect(state.error).not.toBeNull()
    expect(state.outcomes).toEqual([])
    // Nothing was read, stored or recorded.
    expect(ingest).not.toHaveBeenCalled()
  })

  it('names the assessment roll as the thing to upload first', async () => {
    // A refusal that does not say what to do instead is a dead end. The
    // treasurer has no other route to units — there is no units screen.
    hasUnits.mockResolvedValue(false)

    const state = await upload('deposit')

    expect(state.error).toMatch(/roll/i)
  })

  it.each(['assessment_roll', 'invoice', 'statement', 'other'])(
    'still accepts %s when the association holds no units',
    async (kind) => {
      /**
       * 2b, and the worst failure available in this story. Refusing the roll on
       * a fresh install would make the condition permanent: the roll is the only
       * thing that creates units, and there is no other way to make them.
       */
      hasUnits.mockResolvedValue(false)

      const state = await upload(kind)

      expect(state.error).toBeNull()
      expect(ingest).toHaveBeenCalledTimes(1)
    },
  )

  it('asks about the signed-in member, not about anyone else', async () => {
    hasUnits.mockResolvedValue(false)

    await upload('deposit')

    expect(hasUnits).toHaveBeenCalledWith('director-1')
  })

  it('does not ask at all for a kind that cannot need units', async () => {
    // 2f. One query on the deposit path is worth it; a query on every upload of
    // every kind is not, and asking would also be a second place the kind rule
    // could drift from 2b.
    await upload('assessment_roll')

    expect(hasUnits).not.toHaveBeenCalled()
  })

  it('refuses the submission when the census fails, rather than throwing', async () => {
    /**
     * 2c. An unhandled rejection in a server action is a generic 500 — the
     * treasurer's file selection is gone and nothing says whether anything was
     * stored. `app/onboarding/mapping/actions.ts` set this precedent last story.
     *
     * Refusing is the safe direction: not knowing whether units exist is not a
     * reason to let deposits through.
     */
    hasUnits.mockRejectedValue(new Error('the database said no'))

    const state = await upload('deposit')

    expect(state.error).not.toBeNull()
    expect(ingest).not.toHaveBeenCalled()
    // The real error names a table or a connection; it must not reach the page.
    expect(JSON.stringify(state)).not.toContain('the database said no')
  })

  it('refuses before it reads any file', async () => {
    /**
     * 2a. The existing guards are all "before a single byte is read", and this
     * one belongs with them: a rejected batch must not first be held in memory.
     * Asserted by refusing a submission whose file is larger than the per-file
     * limit would allow — if the census check ran after the size checks, the
     * error would be about size instead.
     */
    hasUnits.mockResolvedValue(false)

    const enormous = new File([new Uint8Array(1)], 'huge.csv', { type: 'text/csv' })
    Object.defineProperty(enormous, 'size', { value: 500 * 1024 * 1024 })

    const state = await upload('deposit', [enormous])

    expect(state.error).toMatch(/roll/i)
  })

  it('reads no bytes from the file it refuses', async () => {
    /**
     * The other half of the same claim, and it needs its own fixture.
     *
     * CodeRabbit asked for the byte-read to be asserted directly rather than
     * inferred from which message won. Adding the spy to the test above would
     * not have worked: that file is deliberately oversized, so with the census
     * guard removed the *size* guard would refuse it and `arrayBuffer` would
     * still never be called - the assertion would pass for a reason unrelated to
     * what it claims.
     *
     * An ordinary file has nothing else to stop it, so the spy is only silent if
     * this guard is the one that fired.
     */
    hasUnits.mockResolvedValue(false)

    const ordinary = file()
    const read = vi.spyOn(ordinary, 'arrayBuffer')

    await upload('deposit', [ordinary])

    expect(read).not.toHaveBeenCalled()
  })
})

describe('the guards that were never asserted', () => {
  it('refuses without a session', async () => {
    auth.mockResolvedValue(null)

    const state = await upload('deposit')

    expect(state.error).toMatch(/sign in/i)
    expect(ingest).not.toHaveBeenCalled()
  })

  it('refuses a submission that names no kind', async () => {
    const state = await upload('')

    expect(state.error).not.toBeNull()
    expect(ingest).not.toHaveBeenCalled()
  })

  it('refuses a submission with no files', async () => {
    const state = await upload('deposit', [])

    expect(state.error).toMatch(/at least one file/i)
    expect(ingest).not.toHaveBeenCalled()
  })
})
