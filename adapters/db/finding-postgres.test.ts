/**
 * The finding adapters against a real database.
 *
 * Two of this story's acceptance criteria are enforced by the *database* and
 * cannot be asserted anywhere else. A mocked pool answers happily whatever the
 * SQL says:
 *
 * - **AC2, raising twice yields one row.** The no-op is the unique constraint's
 *   guarantee, not this code's. An adapter that read-then-wrote would pass every
 *   sequential test and produce two rows the first time two detection runs
 *   arrived together.
 * - **AC3, re-raising must not resurrect a reviewed finding.** The whole defect
 *   lives in which columns the `on conflict` branch touches, which is a property
 *   of one SQL statement and of nothing else.
 *
 * Cleanup runs as the **owner** rather than as `watchdog_writer`, and there is
 * no other way: the writer's inability to DELETE is the point of migration 021.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  AlreadyReviewedError,
  FindingNotFoundError,
  type FindingObservation,
} from '../../core/ports/finding'
import { createFindingRegister, createFindingReviewer } from './finding-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const adminUrl = process.env.DATABASE_URL
/**
 * Both, and `DATABASE_URL` is not optional.
 *
 * Cleanup runs as the owner because the writer cannot delete, so an absent admin
 * URL would leave these tests passing and every row they wrote behind — a leak
 * with nothing to report it. Raised by Argus.
 */
const configured = Boolean(writerUrl && adminUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn('\n  finding adapter tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and DATABASE_URL must both be set.\n')
}

const CHECK_VIOLATION = '23514'
const FOREIGN_KEY_VIOLATION = '23503'

/** Lower-case and letter-initial, because `finding_type_is_verb_noun` says so. */
const RUN_PREFIX = `a${randomBytes(4).toString('hex')}`

let writer: Client
let owner: Client
let memberId: string

/**
 * A fresh finding type per test.
 *
 * Scoped per test rather than per file for the reason
 * `quarantine-queue-postgres.test.ts` recorded: a run-wide scope lets each test
 * see its predecessors' rows, and on a table keyed for uniqueness that turns
 * "this raised a new finding" into a result that depends on test order.
 */
let type = ''
let subject = ''

/**
 * The document a finding was surfaced by. Required since 5.1: the adapter reads
 * `association_id` from it rather than taking one, so a finding raised against
 * no document has no association and the not-null constraint refuses it.
 */
let sourceDocumentId = ''

const MARCH = { from: '2026-03-01', until: '2026-04-01' } as const

function observation(overrides: Partial<FindingObservation> = {}): FindingObservation {
  return {
    findingType: type,
    subjectId: subject,
    documentId: sourceDocumentId,
    period: MARCH,
    evidence: { invoiceCount: 2 },
    ...overrides,
  }
}

/**
 * A board member, scoped to this run by email.
 *
 * The scope is not cosmetic. Cleanup deletes findings for this run's prefix and
 * then the members it seeded; an unscoped `finding-adapter-%` would also match
 * members left by an earlier aborted run, whose findings are still there and
 * still reference them — a `23503` thrown out of `afterAll`, which reads as a
 * failing suite for a reason that has nothing to do with the code.
 */
async function seedMember(): Promise<string> {
  const { rows } = await writer.query<{ id: string }>(
    `insert into board_member (email, password_hash, association_id) values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA', '00000000-0000-7000-8000-000000000001')
     returning id`,
    [`finding-adapter-${RUN_PREFIX}-${randomBytes(4).toString('hex')}@example.test`],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('seeding a board member returned no id')

  return id
}

async function seedDocument(uploadedBy: string): Promise<string> {
  const { rows } = await writer.query<{ id: string }>(
    `insert into document
       (content_hash, storage_key, filename, content_type, byte_size, uploaded_by,
        association_id)
     select $1, $2, $3, 'text/csv', 12, $4, uploader.association_id
       from board_member as uploader
      where uploader.id = $4
     returning id`,
    [
      `${RUN_PREFIX}-${randomBytes(8).toString('hex')}`,
      `${RUN_PREFIX}/source.csv`,
      `${RUN_PREFIX}-source.csv`,
      uploadedBy,
    ],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('seeding a document returned no id')

  return id
}

async function stateOf(id: string) {
  const { rows } = await writer.query<{
    state: string
    reviewed_by: string | null
    reviewed_at: Date | null
    evidence: Record<string, unknown>
    period: string
  }>(`select state, reviewed_by, reviewed_at, evidence, period::text from finding where id = $1`, [
    id,
  ])

  const row = rows[0]
  if (row === undefined) throw new Error(`no finding ${id}`)

  return row
}

describeWithDatabase('raising a finding', () => {
  // No board member is seeded here. Nothing in this suite reviews anything, so
  // the seed was a row nothing explained -- the same fixture Argus found unused
  // in `migrations/finding.test.ts`, surviving in the file it was copied to. A
  // defect found in one place is worth looking for in its siblings.
  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    owner = new Client({ connectionString: adminUrl })
    await owner.connect()
    memberId = await seedMember()
    sourceDocumentId = await seedDocument(memberId)
  })

  afterAll(async () => {
    try {
      await owner.query(`delete from finding where finding_type like $1`, [`${RUN_PREFIX}%`])
    } finally {
      // Closed whatever the cleanup did. A delete that throws — a foreign key
      // from a row some later test added, say — would otherwise leak both
      // connections, and a suite that cannot close its connections is the shape
      // `pool.ts` exists to stop. Raised by Argus.
      //
      // `allSettled` rather than two awaits, which is the same defect one level
      // in: `owner.end()` rejecting would leave `writer.end()` unreached and
      // leak the connection this `finally` was added to close. `pool.ts`
      // reached the same idiom for the same reason — one client refusing must
      // not make the caller's teardown fail. Raised by CodeRabbit.
      await Promise.allSettled([owner.end(), writer.end()])
    }
  })

  beforeEach(() => {
    type = `${RUN_PREFIX}_${randomBytes(3).toString('hex')}`
    subject = randomUUID()
  })

  it('records the finding and says it is new', async () => {
    const raised = await createFindingRegister().raise(observation())

    expect(raised.id).toBeTruthy()
    expect(raised.wasAlreadyKnown).toBe(false)

    const stored = await stateOf(raised.id)
    expect(stored.state).toBe('unreviewed')
    expect(stored.evidence).toEqual({ invoiceCount: 2 })
    expect(stored.reviewed_by).toBeNull()
  })

  it('writes the period as the half-open range the key is built on', async () => {
    // Postgres canonicalises to `[)`, so this is what the column holds whatever
    // the adapter sent. Asserting the stored text is how a `[]` here would be
    // caught: it would silently make `until` inclusive, and the boundary test
    // below is the behaviour that follows from it.
    const raised = await createFindingRegister().raise(observation())

    expect((await stateOf(raised.id)).period).toBe('[2026-03-01,2026-04-01)')
  })

  it('keeps two windows that start on the same day apart', async () => {
    // The key is the whole range, not the day it opens. A detector working in
    // 30-day windows and one working in calendar months both start on the 1st,
    // and an `on conflict` reading only the lower bound would let the shorter
    // window overwrite the longer one's evidence.
    //
    // It does **not** catch an inclusive upper bound — under `[]` these two
    // ranges are still distinct, so both rows still appear. The test above is
    // what catches that, by reading the stored period; measured, because the
    // first version of this comment claimed otherwise.
    const register = createFindingRegister()
    const march = await register.raise(observation())
    const almost = await register.raise(
      observation({ period: { from: '2026-03-01', until: '2026-03-31' } }),
    )

    expect(almost.wasAlreadyKnown).toBe(false)
    expect(almost.id).not.toBe(march.id)
  })

  it('raises the same finding twice as one finding', async () => {
    // AC2, and the reason the story exists. Not "one visible finding" — one row.
    const register = createFindingRegister()
    const first = await register.raise(observation())
    const second = await register.raise(observation())

    expect(second.id).toBe(first.id)
    expect(second.wasAlreadyKnown).toBe(true)

    const { rows } = await writer.query<{ n: string }>(
      `select count(*) as n from finding where finding_type = $1`,
      [type],
    )
    expect(rows[0]?.n).toBe('1')
  })

  it('amends the evidence when the same finding is raised again', async () => {
    // A second run over corrected data must be able to say something different.
    // Without this the register would hold the first thing ever computed, which
    // is the wrong half of "never append".
    const register = createFindingRegister()
    const first = await register.raise(observation())
    await register.raise(observation({ evidence: { invoiceCount: 3 } }))

    expect((await stateOf(first.id)).evidence).toEqual({ invoiceCount: 3 })
  })

  it('keeps the same finding for a different subject apart', async () => {
    // The positive control. An `on conflict` clause naming too few columns would
    // satisfy every assertion above while merging two members' findings into one.
    const register = createFindingRegister()
    const mine = await register.raise(observation())
    const theirs = await register.raise(observation({ subjectId: randomUUID() }))

    expect(theirs.wasAlreadyKnown).toBe(false)
    expect(theirs.id).not.toBe(mine.id)
  })

  it('refuses a period of no length rather than storing one', async () => {
    // Every empty `daterange` canonicalises to the same value, so an unrefused
    // empty period would collide across unrelated windows. The adapter must let
    // that failure out rather than swallowing it — a detector whose arithmetic
    // produced an empty window needs to hear about it.
    await expect(
      createFindingRegister().raise(observation({ period: { from: '2026-03-01', until: '2026-03-01' } })),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })
})

describeWithDatabase('reviewing a finding', () => {
  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    owner = new Client({ connectionString: adminUrl })
    await owner.connect()
    memberId = await seedMember()
    sourceDocumentId = await seedDocument(memberId)
  })

  afterAll(async () => {
    try {
      // Findings first: `reviewed_by` references `board_member`, so the member
      // cannot go while a finding still names them.
      await owner.query(`delete from finding where finding_type like $1`, [`${RUN_PREFIX}%`])
      await owner.query(`delete from board_member where email like $1`, [`finding-adapter-${RUN_PREFIX}%`])
    } finally {
      await Promise.allSettled([owner.end(), writer.end()])
    }
  })

  beforeEach(() => {
    type = `${RUN_PREFIX}_${randomBytes(3).toString('hex')}`
    subject = randomUUID()
  })

  it('records who looked and when', async () => {
    // AC5. "Somebody looked at this" is not evidence.
    const raised = await createFindingRegister().raise(observation())

    await createFindingReviewer().markReviewed(raised.id, memberId)

    const stored = await stateOf(raised.id)
    expect(stored.state).toBe('reviewed')
    expect(stored.reviewed_by).toBe(memberId)
    expect(stored.reviewed_at).toBeInstanceOf(Date)
  })

  it('leaves a reviewed finding reviewed when it is raised again', async () => {
    // **AC3, and the defect this whole file is here for.** A second detection
    // run must not resurrect a reviewed finding as unreviewed: that would let a
    // re-upload quietly undo a board member's review, which is dismissal wearing
    // a different hat and would arrive by accident rather than by decision.
    const register = createFindingRegister()
    const raised = await register.raise(observation())
    await createFindingReviewer().markReviewed(raised.id, memberId)

    const again = await register.raise(observation({ evidence: { invoiceCount: 9 } }))

    expect(again.id).toBe(raised.id)
    const stored = await stateOf(raised.id)
    expect(stored.state).toBe('reviewed')
    expect(stored.reviewed_by).toBe(memberId)
    // The evidence still updates — that is the half of the contract that must
    // keep working, and a fix that froze the whole row would pass the three
    // assertions above.
    expect(stored.evidence).toEqual({ invoiceCount: 9 })
  })

  it('refuses a second review and keeps the first reviewer', async () => {
    // Decided explicitly rather than left to whatever the UPDATE happened to do:
    // a silently accepted second review overwrites `reviewed_by`, erasing the
    // first board member's name from the record of who looked, which is exactly
    // what the register exists to answer.
    const raised = await createFindingRegister().raise(observation())
    const reviewer = createFindingReviewer()
    const second = await seedMember()

    await reviewer.markReviewed(raised.id, memberId)

    await expect(reviewer.markReviewed(raised.id, second)).rejects.toBeInstanceOf(
      AlreadyReviewedError,
    )
    expect((await stateOf(raised.id)).reviewed_by).toBe(memberId)
  })

  it('says a finding does not exist rather than reporting success', async () => {
    // The failure mode a `rowCount === 0` check merges with the one above: an
    // UPDATE matching nothing succeeds. Told "already reviewed", a surface would
    // show a review that does not exist for a finding that does not exist.
    await expect(
      createFindingReviewer().markReviewed(randomUUID(), memberId),
    ).rejects.toBeInstanceOf(FindingNotFoundError)
  })

  it('refuses a reviewer who is not a board member', async () => {
    // The attribution has to be worth something. `reviewed_by` references
    // `board_member`, so this is the database's refusal rather than the
    // adapter's — and it is here because an adapter that caught and reshaped it
    // into "already reviewed" or into silence would be the easy mistake.
    const raised = await createFindingRegister().raise(observation())

    await expect(
      createFindingReviewer().markReviewed(raised.id, randomUUID()),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION })

    expect((await stateOf(raised.id)).state).toBe('unreviewed')
  })
})
