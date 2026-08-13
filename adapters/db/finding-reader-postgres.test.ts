/**
 * Reading the queue a board member sees, against a real database.
 *
 * Four things here are only true in Postgres, and asserting them anywhere else
 * asserts a guess: whether `to_char` on a `timestamptz` survives a session
 * timezone, what a `daterange` looks like coming back out, whether `jsonb`
 * returns as an object or as a string of JSON, and whether the ordering has a
 * tie-break at all.
 *
 * ## Determinism, given that these queries have no `where` to scope
 *
 * Every other adapter test in this directory isolates itself with a run prefix,
 * because every other adapter query narrows on something. These do not — "the
 * unreviewed findings" is the whole table and "how many documents were read" is
 * the whole of `document`. Three techniques replace the prefix:
 *
 * - **Seed into 2099**, so this file's rows sort ahead of anything another test
 *   file writes. The same trick story 4.4 used for assessment years.
 * - **Assert relative order within the result**, never absolute position. A
 *   test that expects its three rows to be the first three depends on no other
 *   file having written a newer one, and on the tests in this file running in
 *   the order they are written. Neither is a promise worth relying on.
 * - **Cross-check the global numbers against a control query** written
 *   independently here. A count that cannot be isolated can still be checked
 *   against a second, obvious way of computing it.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createCheckedDocuments, createFindingReader } from './finding-reader-postgres'
import { setPoolTimeZone } from './pool-time-zone'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const adminUrl = process.env.DATABASE_URL
const configured = Boolean(writerUrl && adminUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  finding reader tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and DATABASE_URL must both be set.\n',
  )
}

/** Underscored, because `finding_type_is_verb_noun` refuses anything else. */
const RUN_PREFIX = `readerrun_${randomBytes(4).toString('hex')}`
const STORAGE_PREFIX = `finding-reader-${randomBytes(4).toString('hex')}`

/** Big enough to hold every row this file seeds, so order can be read off one result. */
const ALL = 100

let writer: Client
let owner: Client
let memberId: string

let newest: string
let middle: string
let oldest: string
let reviewed: string
let tieA: string
let tieB: string
let crossing: string

/**
 * A finding, raised at an explicit instant.
 *
 * Inserted directly rather than through `createFindingRegister`, because the
 * register stamps `raised_at` itself — correctly, since a detector must not be
 * able to place a finding outside the window an auditor is looking at. The
 * ordering under test is a property of that column, so the test has to own it.
 */
async function seedFinding(suffix: string, raisedAt: string): Promise<string> {
  const { rows } = await writer.query<{ id: string }>(
    `insert into finding (finding_type, subject_id, period, evidence, raised_at)
     values ($1, $2, daterange($3::date, $4::date, '[)'), $5::jsonb, $6::timestamptz)
     returning id`,
    [
      `${RUN_PREFIX}_${suffix}`,
      randomUUID(),
      '2099-04-01',
      '2099-05-01',
      JSON.stringify({ invoicesChecked: 3 }),
      raisedAt,
    ],
  )

  return rows[0]!.id
}

async function seedDocument(label: string, state: string, uploadedAt: string): Promise<void> {
  await writer.query(
    `insert into document
       (content_hash, storage_key, filename, content_type, byte_size,
        uploaded_by, uploaded_at, extraction_state)
     values ($1, $2, $3, 'text/csv', 512, $4, $5::timestamptz, $6)`,
    [
      randomBytes(32).toString('hex'),
      `${STORAGE_PREFIX}/${label}`,
      `${STORAGE_PREFIX}-${label}.csv`,
      memberId,
      uploadedAt,
      state,
    ],
  )
}

/** Written independently of the adapter, so agreement between the two means something. */
async function controlCount(from: string): Promise<number> {
  const { rows } = await owner.query<{ n: string }>(`select count(*) as n from ${from}`)

  return Number(rows[0]!.n)
}

/** The newest read upload, computed a second way. Same UTC rule, written separately. */
async function controlLatestRead(): Promise<string | null> {
  const { rows } = await owner.query<{ on: string | null }>(
    `select to_char(max(uploaded_at) at time zone 'UTC', 'YYYY-MM-DD') as on
       from document where extraction_state = 'read'`,
  )

  return rows[0]!.on
}

/** This file's rows, in the order the reader returned them, with everyone else's dropped. */
function ours(ids: readonly string[], wanted: readonly string[]): readonly string[] {
  return ids.filter((id) => wanted.includes(id))
}

describeWithDatabase('the finding reader', () => {
  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    owner = new Client({ connectionString: adminUrl })
    await writer.connect()
    await owner.connect()

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash, display_name)
       values ($1, 'scrypt$fixture', 'Finding Reader Fixture')
       returning id`,
      [`${STORAGE_PREFIX}@example.test`],
    )
    memberId = rows[0]!.id

    newest = await seedFinding('newest', '2099-04-14T12:00:00Z')
    middle = await seedFinding('middle', '2099-04-13T12:00:00Z')
    oldest = await seedFinding('oldest', '2099-04-12T12:00:00Z')

    // Two in the same instant, which is not exotic: one detection run raises
    // several, and they land on the same `now()`.
    tieA = await seedFinding('tie_a', '2099-06-01T09:00:00Z')
    tieB = await seedFinding('tie_b', '2099-06-01T09:00:00Z')

    // 02:00Z is the *previous* day in Los Angeles, which is what makes this
    // fixture able to fail. A noon timestamp is the same calendar day in both
    // zones and would prove nothing.
    crossing = await seedFinding('crossing', '2099-05-02T02:00:00Z')

    // Raised unreviewed and then reviewed, because the lifecycle trigger
    // refuses a row that claims to have been born reviewed. Deliberately the
    // newest of them all, so a query that forgot to filter returns it first.
    reviewed = await seedFinding('reviewed', '2099-07-01T12:00:00Z')
    await writer.query(
      `update finding set state = 'reviewed', reviewed_by = $2, reviewed_at = now() where id = $1`,
      [reviewed, memberId],
    )

    // One of each state that is not `read`, so "does it count everything" has
    // something to be wrong about.
    await seedDocument('read-newest', 'read', '2099-03-04T02:00:00Z')
    await seedDocument('read-older', 'read', '2098-11-02T09:00:00Z')
    await seedDocument('still-held', 'held', '2099-03-05T09:00:00Z')
    await seedDocument('unreadable', 'unreadable', '2099-03-06T09:00:00Z')
  })

  afterAll(async () => {
    try {
      await owner.query(`delete from finding where finding_type like $1`, [`${RUN_PREFIX}%`])
      await owner.query(`delete from document where storage_key like $1`, [`${STORAGE_PREFIX}/%`])
      await owner.query(`delete from board_member where id = $1`, [memberId])
    } finally {
      await Promise.allSettled([owner.end(), writer.end()])
    }
  })

  it('returns the unreviewed findings newest first', async () => {
    // AC1, asserted on relative order so no other file's rows can disturb it.
    const queue = await createFindingReader().unreviewed(ALL)

    expect(ours(queue.findings.map((finding) => finding.id), [newest, middle, oldest])).toEqual([
      newest,
      middle,
      oldest,
    ])
  })

  it('leaves a reviewed finding out entirely', async () => {
    // EXPERIENCE.md: "The dashboard shows only unreviewed findings." The
    // reviewed fixture is the newest row this file writes, so a query that
    // forgot to filter would put it at the top.
    const ids = (await createFindingReader().unreviewed(ALL)).findings.map((finding) => finding.id)

    expect(ids).not.toContain(reviewed)
    expect(ids).toContain(newest)
  })

  it('breaks a tie on raised_at the same way every time', async () => {
    // Without a second sort key Postgres may return two rows raised in the same
    // instant in either order, so the board's queue would reshuffle between two
    // refreshes of a register that had not changed.
    const expected = [tieA, tieB].sort().reverse()

    const once = await createFindingReader().unreviewed(ALL)
    const again = await createFindingReader().unreviewed(ALL)

    expect(ours(once.findings.map((finding) => finding.id), [tieA, tieB])).toEqual(expected)
    expect(ours(again.findings.map((finding) => finding.id), [tieA, tieB])).toEqual(expected)
  })

  it('counts the whole register even when it hands back a window of it', async () => {
    // The number the figure block shows, cross-checked against an independently
    // written query. It cannot be asserted by isolation, because the total is a
    // fact about the table rather than about this file's rows — and it is what
    // stops a bounded list reading as the whole queue.
    //
    // **Bracketed rather than compared to one control read.** Other files in
    // this directory raise and review findings concurrently, so a single
    // `toBe(control)` asserts that nothing else committed between two
    // statements — which is not a property of this adapter, and would fail on a
    // busy run for a reason that has nothing to do with the code. Raised by
    // Argus. Bounded by a control on each side, it is exact when the table is
    // quiet and still correct when it is not.
    const before = await controlCount(`finding where state = 'unreviewed'`)
    const queue = await createFindingReader().unreviewed(1)
    const after = await controlCount(`finding where state = 'unreviewed'`)

    expect(queue.findings).toHaveLength(1)
    expect(queue.total).toBeGreaterThanOrEqual(Math.min(before, after))
    expect(queue.total).toBeLessThanOrEqual(Math.max(before, after))
    // And it is not the page size, which is the way this could be wrong while
    // still lying inside the bracket above if the register happened to hold one.
    expect(queue.total).toBeGreaterThan(queue.findings.length)
  })

  it.each([0, -1, 2.5, 201, 1_000_000])('refuses a limit of %s', async (limit) => {
    // Both directions, and the reason differs. Below one, the call returns no
    // rows over a non-zero total — the disagreement `dashboard-view.ts` had to
    // be hardened against. Above the cap, the bound is not a bound: the port
    // made `limit` required because "an optional bound is one a caller
    // forgets", and a caller passing a million forgets it just as thoroughly
    // with the extra step of looking deliberate.
    //
    // The message is asserted, not just the type, so a `RangeError` thrown for
    // some unrelated reason cannot stand in for this refusal. Raised by
    // CodeRabbit.
    await expect(createFindingReader().unreviewed(limit)).rejects.toThrow(
      /findings limit must be a whole number between 1 and 200/,
    )
  })

  it('accepts the largest limit it allows', async () => {
    // **The fencepost, and nothing tested it.** `limit > MOST_ROWS` and
    // `limit >= MOST_ROWS` both pass every rejection case above; only the
    // boundary itself separates them, and getting it wrong makes the documented
    // maximum unusable. Raised by CodeRabbit.
    const queue = await createFindingReader().unreviewed(200)

    expect(queue.findings.length).toBeGreaterThan(0)
  })

  it('hands back the period as two calendar dates', async () => {
    // node-pg has no parser for `daterange`, so `select period` yields the raw
    // literal `[2099-04-01,2099-05-01)` — a string that happens to have
    // brackets in it. The ends are projected explicitly for that reason.
    const queue = await createFindingReader().unreviewed(ALL)
    const found = queue.findings.find((finding) => finding.id === newest)

    expect(found?.period).toEqual({ from: '2099-04-01', until: '2099-05-01' })
  })

  it('hands back evidence as an object rather than a string of JSON', async () => {
    const queue = await createFindingReader().unreviewed(ALL)
    const found = queue.findings.find((finding) => finding.id === newest)

    expect(found?.evidence).toEqual({ invoicesChecked: 3 })
  })

  it('reads the raised date as the same calendar day in any session timezone', async () => {
    // **Story 4.4's defect, guarded in a third reader.** `to_char` on a
    // `timestamptz` renders in the session timezone, and 2099-05-02T02:00Z is
    // 2099-05-01 in Los Angeles.
    await setPoolTimeZone('America/Los_Angeles')

    try {
      const queue = await createFindingReader().unreviewed(ALL)
      const found = queue.findings.find((finding) => finding.id === crossing)

      expect(found?.raisedOn).toBe('2099-05-02')
    } finally {
      await setPoolTimeZone('UTC')
    }
  })

  it('counts the documents that were read, and not the ones that were not', async () => {
    // UX-DR24's denominator, and the one number on this surface that must not
    // be generous: a document that was held or could not be opened was not
    // checked, and counting it tells a board member the system examined
    // something it failed to read.
    // **Bracketed, for the same reason the findings total is.** Half of this
    // race was fixed when Argus raised it and this half was left comparing
    // against a single control read — which asserts that no other file in this
    // directory committed a document between two statements, and several of
    // them do. It flaked once in five runs of the suite before this change.
    const before = await controlCount(`document where extraction_state = 'read'`)
    const checked = await createCheckedDocuments().checked()
    const after = await controlCount(`document where extraction_state = 'read'`)
    const all = await controlCount('document')

    expect(checked.count).toBeGreaterThanOrEqual(Math.min(before, after))
    expect(checked.count).toBeLessThanOrEqual(Math.max(before, after))
    // Deterministic whatever else is in the table: this file seeded a held and
    // an unreadable document, so the two counts cannot be equal.
    expect(after).toBeLessThan(all)
  })

  it('reports the newest upload among the documents it counted', async () => {
    // The "as of" date UX-DR3 hangs on has to describe the same set as the
    // figure beside it, so it is the newest *read* document. The held one
    // seeded a day later must not move it.
    // **Against a control query, bracketed — the same shape as the count above.**
    // Two weaker versions came before this one, and each was wrong in a way the
    // other was not. The literal `toBe('2099-03-04')` asserted that no other
    // file had seeded into 2099, which is the technique this file documents at
    // the top and recommends. Replacing it with `>= '2099-03-04'` and two
    // `not.toBe` exclusions was worse: both pass trivially the moment another
    // file seeds anything later, so the filtering under test stops being
    // checked at all. Raised by CodeRabbit, then by Argus against the fix.
    const before = await controlLatestRead()
    const checked = await createCheckedDocuments().checked()
    const after = await controlLatestRead()

    expect(checked.latestUploadOn).not.toBeNull()
    expect([before, after]).toContain(checked.latestUploadOn)
    // And the control is genuinely narrower than the table: this file seeded a
    // held and an unreadable document *later* than its newest read one, so a
    // reader that counted every state would answer with one of those.
    expect(checked.latestUploadOn).not.toBe('2099-03-06')
  })

  it('reads that date as the same calendar day in any session timezone', async () => {
    // A figure block labelled "as of 3 March" for one board member and "4 March"
    // for another is the register disagreeing with itself.
    //
    // **Asserted as "the answer does not move", not as a literal date.** A
    // literal only holds while this file owns the newest read document; a
    // `>=` comparison holds even when the answer has moved a day, which is the
    // whole bug. Reading the same value either side of the timezone change
    // asks the actual question, and keeps asking it whatever else is in the
    // table. Raised by Argus against the previous fix.
    const inUtc = await createCheckedDocuments().checked()

    let inLosAngeles
    try {
      await setPoolTimeZone('America/Los_Angeles')
      inLosAngeles = await createCheckedDocuments().checked()
    } finally {
      await setPoolTimeZone('UTC')
    }
    const utcAgain = await createCheckedDocuments().checked()

    // **The second UTC read has to happen after the timezone is put back.** An
    // earlier draft took it inside the Los Angeles block and called it
    // `stillInUtc`; it was a second Los Angeles read, so the buggy value was in
    // its own bracket and the test passed against the defect it exists for.
    //
    // Bracketed, because a concurrent insert can move the maximum forward
    // between reads. It cannot move it backwards, which is the direction the
    // timezone defect shifts it.
    expect([inUtc.latestUploadOn, utcAgain.latestUploadOn]).toContain(inLosAngeles.latestUploadOn)
  })
})
