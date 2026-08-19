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
    `insert into finding (finding_type, subject_id, period, evidence, raised_at, association_id) values ($1, $2, daterange($3::date, $4::date, '[)'), $5::jsonb, $6::timestamptz, '00000000-0000-7000-8000-000000000001')
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
    `insert into document (content_hash, storage_key, filename, content_type, byte_size,
        uploaded_by, uploaded_at, extraction_state, association_id) values ($1, $2, $3, 'text/csv', 512, $4, $5::timestamptz, $6, '00000000-0000-7000-8000-000000000001')`,
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
      `insert into board_member (email, password_hash, display_name, association_id) values ($1, 'scrypt$fixture', 'Finding Reader Fixture', '00000000-0000-7000-8000-000000000001')
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
      // By prefix, not by id: individual tests seed extra members, and one that
      // cleaned up after its own assertions would skip the cleanup on failure.
      await owner.query(`delete from board_member where email like $1`, [`${STORAGE_PREFIX}%`])
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

  it('reads one finding by its id', async () => {
    const found = await createFindingReader().byId(newest)

    expect(found).toMatchObject({
      id: newest,
      period: { from: '2099-04-01', until: '2099-05-01' },
      evidence: { invoicesChecked: 3 },
      raisedOn: '2099-04-14',
      reviewed: null,
    })
  })

  it('reads a reviewed finding, and names who reviewed it', async () => {
    // The already-reviewed state (AC6) rests entirely on this read. The queue
    // can never return this row, so nothing else in the suite exercises the
    // reviewed branch of the join.
    const found = await createFindingReader().byId(reviewed)

    expect(found?.reviewed?.by).toBe('Finding Reader Fixture')
    expect(found?.reviewed?.on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('answers with nothing for an id no finding has', async () => {
    // A well-formed uuid that is simply not there — the ordinary outcome for a
    // link somebody kept after the finding was removed from the fixture, and
    // the one the surface turns into a 404.
    expect(await createFindingReader().byId(randomUUID())).toBeNull()
  })

  it('answers with nothing for an id that is not a uuid at all', async () => {
    // **Postgres raises 22P02 on a malformed uuid cast**, which would reach the
    // page as a database error rather than as "no such finding". The id comes
    // straight off the URL, so this is reachable by typing.
    expect(await createFindingReader().byId('not-a-uuid')).toBeNull()
    expect(await createFindingReader().byId('')).toBeNull()
  })

  it('reads a reviewed finding whose reviewer has no display name', async () => {
    // `board_member.display_name` is nullable. The finding was still reviewed,
    // and the page has to say so without inventing a name.
    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash, association_id) values ($1, 'scrypt$fixture', '00000000-0000-7000-8000-000000000001') returning id`,
      [`${STORAGE_PREFIX}-nameless@example.test`],
    )
    const nameless = rows[0]!.id
    const finding = await seedFinding('nameless_reviewer', '2099-08-01T12:00:00Z')
    await writer.query(
      `update finding set state = 'reviewed', reviewed_by = $2, reviewed_at = now() where id = $1`,
      [finding, nameless],
    )

    const found = await createFindingReader().byId(finding)

    // No cleanup here on purpose. Deleting after the assertions leaks the row
    // whenever one of them fails, which is exactly when the suite is least
    // tidy; `afterAll` now removes every fixture member by email prefix, so
    // this test has nothing left to remember. Raised by Argus.
    expect(found?.reviewed).not.toBeNull()
    expect(found?.reviewed?.by).toBeNull()
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

    // Bounded rather than matched against the two endpoints. `max` is
    // monotonic, so the adapter's answer lies between the controls — but with
    // two concurrent inserts it can be an *intermediate* value that equals
    // neither, and `toContain` would flake. The count assertion above already
    // used bounds; this one did not, which is the inconsistency Argus caught.
    expect(checked.latestUploadOn).not.toBeNull()
    expect(checked.latestUploadOn! >= before!).toBe(true)
    expect(checked.latestUploadOn! <= after!).toBe(true)
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

/**
 * The register (story 4.7, AC1–AC3).
 *
 * ## Every total here is exact, and that is deliberate
 *
 * Story 4.6's queue tests bracket their counts between two control reads,
 * because other files in this directory raise and review findings concurrently
 * and a bare `toBe(n)` asserts that nobody else committed between two
 * statements. Argus raised it there, and the bracket was the fix — but a bracket
 * can still be straddled by a concurrent insert *and* delete, which 4.6 recorded
 * as an accepted residual.
 *
 * The register does not need it. `search` narrows to this file's own rows, so
 * every assertion below scopes to its prefix and the total is exactly what was
 * seeded. A test that can be exact should not be approximate.
 */
describeWithDatabase('the register', () => {
  let registerWriter: Client
  let registerOwner: Client

  /** Scopes every search to this file's findings, which is what makes totals exact. */
  const REGISTER_PREFIX = `${RUN_PREFIX}_reg`

  let reviewerId: string
  let vendorFinding: string
  let unitFinding: string
  let typeFinding: string
  let namelessFinding: string
  let sameInstantA: string
  let sameInstantB: string
  let unreviewedFinding: string

  async function seedReviewed(
    suffix: string,
    evidence: unknown,
    reviewedAt: string,
    reviewer?: string,
  ): Promise<string> {
    const { rows } = await registerWriter.query<{ id: string }>(
      `insert into finding (finding_type, subject_id, period, evidence, raised_at, association_id) values ($1, $2, daterange('2099-04-01'::date, '2099-05-01'::date, '[)'), $3::jsonb, now(), '00000000-0000-7000-8000-000000000001')
       returning id`,
      [`${REGISTER_PREFIX}_${suffix}`, randomUUID(), JSON.stringify(evidence)],
    )
    const id = rows[0]!.id

    // Raised unreviewed and then reviewed, because migration 021's lifecycle
    // trigger refuses a row claiming to have been born reviewed.
    await registerWriter.query(
      `update finding set state = 'reviewed', reviewed_by = $2, reviewed_at = $3::timestamptz
        where id = $1`,
      [id, reviewer ?? reviewerId, reviewedAt],
    )

    return id
  }

  beforeAll(async () => {
    registerWriter = new Client({ connectionString: writerUrl })
    registerOwner = new Client({ connectionString: adminUrl })
    await registerWriter.connect()
    await registerOwner.connect()

    const named = await registerWriter.query<{ id: string }>(
      `insert into board_member (email, password_hash, display_name, association_id) values ($1, 'scrypt$fixture', 'Regina Mbeki', '00000000-0000-7000-8000-000000000001') returning id`,
      [`${REGISTER_PREFIX}-reviewer@example.test`],
    )
    reviewerId = named.rows[0]!.id

    // A reviewer with no display name. Nullable by schema, and the finding must
    // still reach the register rather than being dropped along with the name.
    const nameless = await registerWriter.query<{ id: string }>(
      `insert into board_member (email, password_hash, display_name, association_id) values ($1, 'scrypt$fixture', null, '00000000-0000-7000-8000-000000000001') returning id`,
      [`${REGISTER_PREFIX}-nameless@example.test`],
    )

    // The vendor sits *inside* the pairs array, which is where every real one
    // sits — a search reaching only top-level keys would find none of them.
    vendorFinding = await seedReviewed(
      'vendor',
      { invoicesChecked: 3, pairs: [{ vendorName: 'Coastal Landscaping', amount: '1450.00' }] },
      '2099-08-01T10:00:00Z',
    )
    unitFinding = await seedReviewed(
      'unit',
      { unitNumber: '12B', holderName: 'Dana Whitfield', shortfall: '100.00' },
      '2099-08-02T10:00:00Z',
    )
    typeFinding = await seedReviewed('dupkind', { invoicesChecked: 1 }, '2099-08-03T10:00:00Z')
    namelessFinding = await seedReviewed(
      'nameless',
      { invoicesChecked: 2 },
      '2099-08-04T10:00:00Z',
      nameless.rows[0]!.id,
    )

    sameInstantA = await seedReviewed('tiea', {}, '2099-09-01T09:00:00Z')
    sameInstantB = await seedReviewed('tieb', {}, '2099-09-01T09:00:00Z')

    // Seeded and left unreviewed, so the partition has something to be wrong
    // about in both directions.
    const raised = await registerWriter.query<{ id: string }>(
      `insert into finding (finding_type, subject_id, period, evidence, raised_at, association_id) values ($1, $2, daterange('2099-04-01'::date, '2099-05-01'::date, '[)'), '{}'::jsonb, now(), '00000000-0000-7000-8000-000000000001')
       returning id`,
      [`${REGISTER_PREFIX}_unreviewed`, randomUUID()],
    )
    unreviewedFinding = raised.rows[0]!.id
  })

  afterAll(async () => {
    try {
      await registerOwner.query(`delete from finding where finding_type like $1`, [
        `${REGISTER_PREFIX}%`,
      ])
      // This block's own prefix, so the two describes cannot delete each
      // other's fixtures while both are running. Raised by CodeRabbit.
      await registerOwner.query(`delete from board_member where email like $1`, [
        `${REGISTER_PREFIX}-%`,
      ])
    } finally {
      await Promise.allSettled([registerOwner.end(), registerWriter.end()])
    }
  })

  const ALL = 200

  /** This file's register rows, scoped by the search that makes totals exact. */
  const mine = () => createFindingReader().register({ search: REGISTER_PREFIX, limit: ALL })

  it('returns the reviewed findings and nothing else', async () => {
    const register = await mine()
    const ids = register.findings.map((finding) => finding.id)

    expect(ids).toContain(vendorFinding)
    expect(ids).not.toContain(unreviewedFinding)
  })

  it('partitions the table with the queue — every finding on exactly one surface', async () => {
    // **The property, from both sides.** EXPERIENCE.md's lifecycle has two live
    // states and no third: a finding on neither has vanished from a record meant
    // to be permanent, and one on both is counted twice by the two figures a
    // board member reads side by side.
    const register = await mine()
    const queue = await createFindingReader().unreviewed(ALL)

    const registered = new Set(register.findings.map((finding) => finding.id))
    const queued = new Set(queue.findings.map((finding) => finding.id))

    const reviewedHere = [
      vendorFinding,
      unitFinding,
      typeFinding,
      namelessFinding,
      sameInstantA,
      sameInstantB,
    ]

    // **Completeness is asserted from the register, not from the queue.** The
    // register read is scoped to this file's prefix, so it is exact; the queue
    // read is global and bounded, so a fixture of this file's can legitimately
    // fall outside its first 200 rows when other files are seeding at the same
    // time. Requiring it there made the property flake for a reason that had
    // nothing to do with the property. Raised by CodeRabbit — and it is the
    // same concurrency trap the exact totals above were chosen to avoid.
    for (const id of reviewedHere) {
      expect(registered.has(id), `${id} is missing from the register`).toBe(true)
      expect(queued.has(id), `${id} is on both surfaces`).toBe(false)
    }

    // The other direction: an unreviewed finding is never on the register.
    expect(registered.has(unreviewedFinding), 'an unreviewed finding reached the register').toBe(
      false,
    )
  })

  it('says who reviewed it and when', async () => {
    const register = await mine()

    expect(register.findings.find((finding) => finding.id === unitFinding)?.reviewed).toEqual({
      by: 'Regina Mbeki',
      on: '2099-08-02',
    })
  })

  it('keeps a finding whose reviewer has no display name', async () => {
    // Dropping the row to tidy a missing name would lose a line from a
    // permanent record, which is the worst trade available here.
    const register = await mine()

    expect(register.findings.find((finding) => finding.id === namelessFinding)?.reviewed).toEqual({
      by: null,
      on: '2099-08-04',
    })
  })

  it('orders newest review first', async () => {
    const register = await mine()
    const ids = register.findings.map((finding) => finding.id)

    expect(ours(ids, [namelessFinding, typeFinding, unitFinding, vendorFinding])).toEqual([
      namelessFinding,
      typeFinding,
      unitFinding,
      vendorFinding,
    ])
  })

  it('settles two reviews in one instant by id, newest first', async () => {
    // A board member working through the queue stamps several rows inside the
    // same second. A register that reshuffles between two refreshes is one
    // nobody can cite a line of.
    //
    // **Asserted as the exact order, not as "the same twice".** Stability was
    // the first version and the sensitivity check killed it: dropping
    // `id desc` left the suite green, because Postgres given no tie-break is
    // *free* to reshuffle and mostly does not bother. `id desc` on uuidv7 —
    // which is time-ordered — puts the later insert first, so the expected
    // order is knowable rather than merely repeatable.
    const first = await mine()
    const second = await mine()
    const order = (rows: readonly { id: string }[]) =>
      ours(
        rows.map((row) => row.id),
        [sameInstantA, sameInstantB],
      )

    expect(order(first.findings)).toEqual([sameInstantB, sameInstantA])
    expect(order(second.findings)).toEqual([sameInstantB, sameInstantA])
  })

  it('counts every match, not the page', async () => {
    const all = await mine()
    const page = await createFindingReader().register({ search: REGISTER_PREFIX, limit: 2 })

    expect(page.findings).toHaveLength(2)
    expect(page.total).toBe(all.total)
    expect(page.total).toBeGreaterThan(page.findings.length)
  })

  it.each([0, -1, 1.5, Number.NaN, 201])(
    'refuses a limit of %s rather than clamping it',
    async (limit) => {
      await expect(createFindingReader().register({ limit })).rejects.toThrow(RangeError)
    },
  )

  describe('what search matches', () => {
    const find = (search: string) => createFindingReader().register({ search, limit: ALL })
    const idsOf = async (search: string) =>
      (await find(search)).findings.map((finding) => finding.id)

    it('matches a vendor name nested inside the pairs array', async () => {
      expect(await idsOf('Coastal Landscaping')).toContain(vendorFinding)
    })

    it('matches a unit number, and the person who holds it', async () => {
      expect(await idsOf('12B')).toContain(unitFinding)
      expect(await idsOf('Dana Whitfield')).toContain(unitFinding)
    })

    it('matches the finding type', async () => {
      expect(await idsOf(`${REGISTER_PREFIX}_dupkind`)).toContain(typeFinding)
    })

    it('matches the reviewer by name', async () => {
      const ids = await idsOf('Regina Mbeki')

      expect(ids).toContain(vendorFinding)
      expect(ids).not.toContain(namelessFinding)
    })

    it('is case-insensitive, because nobody types a vendor as the invoice spelled it', async () => {
      expect(await idsOf('coastal landscaping')).toContain(vendorFinding)
    })

    it('narrows the total as well as the rows', async () => {
      // A total that ignored the filter would tell a board member the register
      // holds more than the search found — and the export control beside it
      // states a count taken from the same number.
      const narrowed = await find('Coastal Landscaping')

      expect(narrowed.total).toBe(narrowed.findings.length)
      expect(narrowed.findings.every((finding) => finding.id === vendorFinding)).toBe(true)
    })

    it('never matches a key of the evidence object', async () => {
      // **The reason this is jsonpath rather than a text search over the blob.**
      // The key is spelled `vendorName`, so `evidence::text ilike` answers a
      // search for "vendor" with every finding that has one at all — including
      // those whose vendor is nothing like what was typed.
      expect(await idsOf('vendorName')).not.toContain(vendorFinding)
    })

    it('never matches an id', async () => {
      expect(await idsOf(vendorFinding)).not.toContain(vendorFinding)
    })

    it('treats % as a character a vendor might be named with, not a wildcard', async () => {
      // Unescaped, `%` matches everything — so a board member searching for a
      // vendor with a percent sign in its name is handed the whole register and
      // told it matched.
      expect((await find('%')).findings).toHaveLength(0)
    })

    it('treats _ the same way', async () => {
      expect((await find('_oastal Landscaping')).findings).toHaveLength(0)
    })

    it('survives evidence holding scalars, nulls and arrays at every depth', async () => {
      // **A search that errors takes the whole register down, not one row.**
      // The concern raised was that `strict $.**.key` applies a member
      // accessor to a scalar descendant and aborts the query — which would
      // mean one oddly-shaped evidence blob makes the register unreachable for
      // everybody.
      //
      // Measured on this database, it does not: `.**` suppresses the
      // structural errors that a direct `strict $.n.vendorName` does raise.
      // The claim was plausible enough to be worth pinning rather than
      // arguing, so this seeds the shapes it named and asserts the search
      // still answers. Raised by CodeRabbit; see the thread for the probe.
      // Seeded and removed inside the test rather than in `beforeAll`, so a
      // deliberately malformed row is never visible to the tests asserting
      // exact totals and orders around it.
      const hostile = await seedReviewed(
        'hostile',
        {
          invoicesChecked: 3,
          note: null,
          tags: ['a', 'b'],
          nested: { deeper: { count: 1 } },
          pairs: [1, 'loose', null, { vendorName: `${REGISTER_PREFIX} Hostile Shapes` }],
        },
        '2099-06-01T00:00:00Z',
      )

      try {
        // The register still reads, and the value nested under scalars is found.
        expect(await idsOf(REGISTER_PREFIX)).toContain(hostile)
        expect(await idsOf('Hostile Shapes')).toEqual([hostile])
      } finally {
        await registerOwner.query(`delete from finding where finding_type = $1`, [
          `${REGISTER_PREFIX}_hostile`,
        ])
      }
    })

    it.each([undefined, '', '   '])('treats %o as no search at all', async (search) => {
      // A blank box submits on every press of the button. Treating it as a
      // filter narrows the register to findings matching nothing, and presents
      // that to a board member as an empty register.
      const register = await createFindingReader().register({ search, limit: ALL })
      const scoped = await mine()

      expect(register.total).toBeGreaterThanOrEqual(scoped.total)
      expect(register.findings.map((finding) => finding.id)).toContain(vendorFinding)
    })
  })

  it('reads the review date as the same calendar day in any session timezone', async () => {
    // Story 4.4's defect, guarded in a fourth read. `to_char` on a `timestamptz`
    // renders in the session timezone, and a review stamped at 02:00Z is the
    // previous day in Los Angeles.
    const crossingReview = await seedReviewed('crossing', {}, '2099-10-02T02:00:00Z')

    await setPoolTimeZone('America/Los_Angeles')

    try {
      const register = await mine()

      expect(register.findings.find((finding) => finding.id === crossingReview)?.reviewed?.on).toBe(
        '2099-10-02',
      )
    } finally {
      await setPoolTimeZone('UTC')
    }
  })
})
