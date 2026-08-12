/**
 * Migration 021: a finding, and the life it leads.
 *
 * AD-13 — "Alerts are keyed on `(finding_type, subject_id, period)` so
 * re-processing is a no-op."
 *
 * Three properties are under test, and they fail in different ways.
 *
 * **The key has to be un-defeatable.** Not "the application does not raise
 * twice" — the database must refuse. The interesting case is not two identical
 * inserts, which any unique constraint catches; it is two *spellings* of the
 * same period, which a `text` column would have let through and which is exactly
 * how a duplicate-detection product manufactures duplicates.
 *
 * **The state and its evidence cannot disagree.** A row claiming to be reviewed
 * while naming nobody says a human looked and cannot say which human, which is
 * precisely what the register exists to answer.
 *
 * **Never-dismissed has to be a grant, not a habit.** Migration 002's default
 * privileges hand `watchdog_writer` DELETE on every table created after it, so
 * this table arrives deletable unless 021 takes it away. That is the failure
 * worth naming: the table would look right, the application would never issue a
 * DELETE, and the property would hold only for as long as nobody wrote one.
 */

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { executable } from './executable-sql'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const adminUrl = process.env.DATABASE_URL
/**
 * All three, and `DATABASE_URL` is not optional.
 *
 * Cleanup runs as the owner because the writer cannot delete — that is the point
 * of the migration — so without the admin URL these tests would run, pass, and
 * leave every row they wrote behind. An `owner` that might be null makes the
 * leak silent; requiring it here makes the absence say so. Raised by Argus.
 */
const configured = Boolean(writerUrl && readerUrl && adminUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  finding migration tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL, ' +
      'WATCHDOG_READER_DATABASE_URL and DATABASE_URL must all be set.\n',
  )
}

const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'
const INSUFFICIENT_PRIVILEGE = '42501'
/** What a plpgsql `raise exception` reports when it names no other errcode. */
const RAISE_EXCEPTION = 'P0001'

/**
 * Every row this file writes carries this in its `finding_type`.
 *
 * Lower-case and starting with a letter, because `finding_type_is_verb_noun`
 * holds the column to that shape and a prefix of raw hex beginning with a digit
 * would be rejected by the very constraint under test.
 *
 * Cleanup runs as the **owner**, not as `watchdog_writer`, and cannot be done
 * any other way: the writer's inability to DELETE is the point of the migration.
 */
const RUN_PREFIX = `f${randomBytes(4).toString('hex')}`

// `__dirname` under `type: module`, matching the other six migration tests and
// relying on the same Vitest polyfill. The open action item from Epic 1 asks for
// one choice **across the repo** rather than per file, so converting this one
// alone is the churn that item exists to prevent. Raised by Argus; deferred to
// the sweep, deliberately.
const MIGRATION = readFileSync(join(__dirname, '021_finding.sql'), 'utf8')

describe('the migration says what it does', () => {
  const sql = executable(MIGRATION)

  it('strips the prose before any of the assertions below read it', () => {
    // The control for the comment stripping, and it has to be a phrase really in
    // the prose and really not in the SQL. A control asserting the absence of
    // something never present holds with the stripping deleted.
    expect(MIGRATION).toContain('Never dismissed" is a grant, not a habit')
    expect(sql).not.toContain('Never dismissed" is a grant, not a habit')
  })

  it('revokes delete rather than trusting the application', () => {
    expect(sql).toMatch(/revoke\s+delete,\s*truncate\s+on\s+finding\s+from\s+watchdog_writer/i)
    expect(sql).toMatch(/revoke\s+delete,\s*truncate\s+on\s+finding\s+from\s+public/i)
  })

  it('does not revoke update, because reviewing is an update', () => {
    // The distinction this migration turns on: a finding must be amendable and
    // must never leave. Revoking UPDATE here would make the lifecycle
    // unimplementable, and the reviewer would discover it at runtime.
    expect(sql).not.toMatch(/revoke[^;]*\bupdate\b[^;]*on\s+finding/i)
  })

  it('grants the reader nothing', () => {
    expect(sql).not.toMatch(/grant[^;]*on\s+finding\s+to\s+watchdog_reader/i)
  })
})

describeWithDatabase('the key AD-13 names', () => {
  let writer: Client
  let owner: Client
  let subject: string

  // No board member is seeded here. Nothing in this suite reviews anything —
  // the key is about `(finding_type, subject_id, period)` — and the seed was
  // copied from the lifecycle suite below, where a reviewer is genuinely
  // needed. Raised by Argus; a fixture nothing reads is a row nothing explains.
  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    owner = new Client({ connectionString: adminUrl })
    await owner.connect()
  })

  afterAll(async () => {
    // As the owner: the writer cannot delete, which is the property under test.
    await owner.query(`delete from finding where finding_type like $1`, [`${RUN_PREFIX}%`])
    await owner.end()
    await writer.end()
  })

  const raise = (type: string, period: string, evidence = '{"seen": 1}') =>
    writer.query(
      `insert into finding (finding_type, subject_id, period, evidence)
       values ($1, $2, $3::daterange, $4::jsonb)`,
      [type, subject, period, evidence],
    )

  beforeAll(() => {
    subject = '00000000-0000-0000-0000-0000000000aa'
  })

  it('refuses the same finding twice', async () => {
    const type = `${RUN_PREFIX}_twice`
    await raise(type, '[2026-03-01,2026-04-01)')

    await expect(raise(type, '[2026-03-01,2026-04-01)')).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
    })
  })

  it('refuses a second spelling of the same period', async () => {
    // **The case a text column would have let through.** `[2026-05-01,2026-06-01)`
    // and `[2026-05-01,2026-05-31]` are the same month written two ways, and
    // Postgres canonicalises both to the half-open form before comparing. A
    // detector writing '2026-5' where another wrote '2026-05' is the mechanism
    // by which a duplicate-detection product manufactures duplicates.
    const type = `${RUN_PREFIX}_spelling`
    await raise(type, '[2026-05-01,2026-06-01)')

    await expect(raise(type, '[2026-05-01,2026-05-31]')).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
    })
  })

  it('allows the same finding for a different period', async () => {
    // The positive control. A key that refused everything would satisfy both
    // tests above while making the table useless — the same unit can miss its
    // dues in March and again in April, and those are two findings.
    const type = `${RUN_PREFIX}_periods`
    await raise(type, '[2026-03-01,2026-04-01)')

    await expect(raise(type, '[2026-04-01,2026-05-01)')).resolves.toBeDefined()
  })

  it('does not collide a monthly window with the annual one containing it', async () => {
    // The recorded domain note: dues cycles are per member — monthly,
    // six-monthly or annual. A monthly payer and an annual payer must be able to
    // hold findings in the same year without one displacing the other.
    const type = `${RUN_PREFIX}_cadence`
    await raise(type, '[2026-01-01,2027-01-01)')

    await expect(raise(type, '[2026-03-01,2026-04-01)')).resolves.toBeDefined()
  })

  it('refuses a period that is no time at all', async () => {
    // **The one way the key can still be defeated, found by probing rather than
    // by reasoning.** Postgres canonicalises *every* empty range to the single
    // value `empty`, so `[2026-05-01,2026-05-01)` and `[2026-09-09,2026-09-09)`
    // — May and September, nothing alike — compare equal and collide on
    // `finding_identity`. Measured: the second upsert updated the first row and
    // reported `inserted: false`.
    //
    // That is the same defect a text column would have had, arriving through a
    // different door: a May finding silently replaced by a September one. And it
    // is not hypothetical arithmetic — a detector computing a window from two
    // dates that turn out equal produces exactly this.
    const type = `${RUN_PREFIX}_empty`

    await expect(raise(type, '[2026-05-01,2026-05-01)')).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    })
  })

  it('refuses a period with no end', async () => {
    // An unbounded upper bound is a window whose meaning changes with the date
    // it is read on: "from June onwards", read in 2030, covers four years it did
    // not cover when it was written. This table is a register of evidence, and
    // an entry that quietly grows is not evidence.
    //
    // A detector meaning "still ongoing" bounds it at today, which says the same
    // thing and keeps saying it.
    const type = `${RUN_PREFIX}_open`

    await expect(raise(type, '[2026-06-01,)')).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    })
  })
})

describeWithDatabase('the lifecycle is one-way', () => {
  let writer: Client
  let owner: Client
  let memberId: string

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    owner = new Client({ connectionString: adminUrl })
    await owner.connect()
    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash)
       values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA') returning id`,
      [`life-${RUN_PREFIX}@example.test`],
    )
    memberId = rows[0]!.id
  })

  afterAll(async () => {
    await owner.query(`delete from finding where finding_type like $1`, [`${RUN_PREFIX}%`])
    await owner.query(`delete from board_member where email like $1`, [`life-${RUN_PREFIX}%`])
    await owner.end()
    await writer.end()
  })

  async function raised(suffix: string): Promise<string> {
    const { rows } = await writer.query<{ id: string }>(
      `insert into finding (finding_type, subject_id, period, evidence)
       values ($1, gen_random_uuid(), '[2026-06-01,2026-07-01)'::daterange, '{}'::jsonb)
       returning id`,
      [`${RUN_PREFIX}_${suffix}`],
    )

    return rows[0]!.id
  }

  it('starts unreviewed', async () => {
    const id = await raised('start')
    const { rows } = await writer.query<{ state: string }>(
      'select state from finding where id = $1',
      [id],
    )

    expect(rows[0]!.state).toBe('unreviewed')
  })

  it('refuses a reviewed row that names nobody', async () => {
    // The row would say a human looked and be unable to say which human, which
    // is precisely what the register exists to answer.
    const id = await raised('anon')

    await expect(
      writer.query(`update finding set state = 'reviewed' where id = $1`, [id]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('accepts a review that names its reviewer and time', async () => {
    const id = await raised('named')

    await expect(
      writer.query(
        `update finding set state = 'reviewed', reviewed_by = $2, reviewed_at = now()
         where id = $1`,
        [id, memberId],
      ),
    ).resolves.toBeDefined()
  })

  it('refuses an unreviewed row that carries a reviewer', async () => {
    // The other direction, and not redundant: without it a row could be reverted
    // to unreviewed while keeping the reviewer, which reads as "nobody has looked
    // at this" beside the name of somebody who did.
    const id = await raised('reverted')

    await expect(
      writer.query(`update finding set reviewed_by = $2 where id = $1`, [id, memberId]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('refuses a state that is neither', async () => {
    const id = await raised('dismissed')

    await expect(
      writer.query(`update finding set state = 'dismissed' where id = $1`, [id]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  /**
   * One-way has to be a rule of the table, not of the port.
   *
   * Found by auditing AC4 — "no un-reviewing, and attempting it fails loudly" —
   * against what the database would actually do, rather than against what the
   * port declares. It was a habit: `FindingReviewer` has no un-review method, so
   * nothing in the application could do this, and a check constraint cannot see
   * the previous row. A plain UPDATE setting the three columns back to their
   * unreviewed values is internally consistent and was accepted. Measured.
   *
   * That is the same argument this migration makes about DELETE one suite below,
   * arriving at the other end of the lifecycle: the property held only for as
   * long as nobody wrote the statement.
   */
  it('refuses to un-review a reviewed finding', async () => {
    const id = await raised('unreview')
    await writer.query(
      `update finding set state = 'reviewed', reviewed_by = $2, reviewed_at = now() where id = $1`,
      [id, memberId],
    )

    await expect(
      writer.query(
        `update finding set state = 'unreviewed', reviewed_by = null, reviewed_at = null
         where id = $1`,
        [id],
      ),
    ).rejects.toMatchObject({ code: RAISE_EXCEPTION })
  })

  it('refuses to replace the reviewer of a reviewed finding', async () => {
    // The second half of AC5. "The treasurer looked at this on the 3rd" stops
    // being evidence if a later statement can make it say somebody else. The
    // adapter refuses a second review, but the adapter is not the only thing
    // that can issue an UPDATE.
    const id = await raised('reattribute')
    await writer.query(
      `update finding set state = 'reviewed', reviewed_by = $2, reviewed_at = now() where id = $1`,
      [id, memberId],
    )
    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash)
       values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA') returning id`,
      [`life-${RUN_PREFIX}-second@example.test`],
    )

    await expect(
      writer.query(`update finding set reviewed_by = $2 where id = $1`, [id, rows[0]!.id]),
    ).rejects.toMatchObject({ code: RAISE_EXCEPTION })
  })

  it('still lets a reviewed finding have its evidence amended', async () => {
    // **The positive control, and the one that matters most here.** A rule
    // freezing a reviewed row entirely would pass both refusals above and break
    // AC3: a second detection run must still be able to correct what a finding
    // says, whether or not somebody has read it.
    const id = await raised('amend')
    await writer.query(
      `update finding set state = 'reviewed', reviewed_by = $2, reviewed_at = now() where id = $1`,
      [id, memberId],
    )

    await expect(
      writer.query(`update finding set evidence = '{"corrected": true}'::jsonb where id = $1`, [id]),
    ).resolves.toBeDefined()
  })
})

describeWithDatabase('never dismissed is a grant, not a habit', () => {
  let writer: Client
  let owner: Client
  let id: string

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    owner = new Client({ connectionString: adminUrl })
    await owner.connect()
    const { rows } = await writer.query<{ id: string }>(
      `insert into finding (finding_type, subject_id, period, evidence)
       values ($1, gen_random_uuid(), '[2026-08-01,2026-09-01)'::daterange, '{}'::jsonb)
       returning id`,
      [`${RUN_PREFIX}_grant`],
    )
    id = rows[0]!.id
  })

  afterAll(async () => {
    await owner.query(`delete from finding where finding_type like $1`, [`${RUN_PREFIX}%`])
    await owner.end()
    await writer.end()
  })

  it('refuses DELETE to the writer', async () => {
    // Scoped by id rather than unbounded. `migrations/roles.test.ts` still runs
    // an unbounded `delete from board_member` to prove the same kind of thing,
    // and on the run where the grant has regressed that test is the thing that
    // wipes the table. Postgres checks the privilege before matching rows, so
    // scoping costs the assertion nothing — this is the shape story 3.1 adopted
    // for query_log and the open action item asks for elsewhere.
    await expect(
      writer.query('delete from finding where id = $1', [id]),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
  })

  /**
   * TRUNCATE is asserted, never executed.
   *
   * It has no scoped form — there is no `where` to add — so the DELETE test's
   * fix does not transfer, and the first version of this file ran a bare
   * `truncate finding` two tests below a comment congratulating itself on not
   * doing that. On the one run where the grant has regressed, which is the only
   * run where the test does anything at all, it would have emptied the table
   * before reporting it.
   *
   * The second version wrapped it in a transaction and rolled back. That worked
   * — verified by granting TRUNCATE and watching the rows survive — but it is
   * not what this repo decided. `query-log.test.ts` had the identical problem
   * and settled it: *"the privilege set is the same proof without the loaded
   * gun"*, and the open action item from story 3.1 names the exact-set assertion
   * as the fix wherever this shape appears. A third answer to a settled question
   * is churn, and executing a denied TRUNCATE still takes an ACCESS EXCLUSIVE
   * lock on a table other test files are using. Raised by Argus, twice.
   *
   * **Both catalogs, both as exact sets.** Column-level grants do not appear in
   * `table_privileges` at all — `roles.test.ts` records a live
   * `GRANT UPDATE (note)` that a table-level assertion reported as clean — and a
   * subset check would pass against a table that had quietly picked up DELETE.
   */
  it('holds no privilege beyond INSERT, SELECT and UPDATE', async () => {
    // `distinct` on both: a privilege granted by more than one grantor appears
    // once per grantor, and the exact-array assertions would then fail for a
    // reason that has nothing to do with what the writer can do.
    const { rows: table } = await writer.query<{ privilege_type: string }>(
      `select distinct privilege_type
         from information_schema.table_privileges
        where grantee = 'watchdog_writer'
          and table_schema = 'public'
          and table_name = 'finding'
        order by privilege_type`,
    )
    const { rows: column } = await writer.query<{ privilege_type: string }>(
      `select distinct privilege_type
         from information_schema.column_privileges
        where grantee = 'watchdog_writer'
          and table_schema = 'public'
          and table_name = 'finding'
        order by privilege_type`,
    )

    // UPDATE is present on purpose, and its absence would be the other failure:
    // reviewing a finding is an update, so a migration that revoked it would
    // pass every refusal in this file and make story 4.6 unimplementable.
    expect(table.map((row) => row.privilege_type)).toEqual(['INSERT', 'SELECT', 'UPDATE'])
    expect(column.map((row) => row.privilege_type)).toEqual(['INSERT', 'SELECT', 'UPDATE'])
  })

  it('still allows UPDATE, or the lifecycle could not happen', async () => {
    // The positive control for the revoke above. A migration that revoked UPDATE
    // as well would pass both refusals and make reviewing impossible — a
    // discovery that would otherwise wait for story 4.6.
    await expect(
      writer.query(`update finding set evidence = '{"amended": true}'::jsonb where id = $1`, [id]),
    ).resolves.toBeDefined()
  })

  it('refuses the reader entirely', async () => {
    // Migration 003 revoked the reader's blanket SELECT so read access is a
    // per-table decision. Findings are not one of the tables it gets: a catalog
    // entry that could read them would let a question about dues surface an
    // unreviewed accusation about a member.
    const reader = new Client({ connectionString: readerUrl })
    await reader.connect()
    try {
      await expect(reader.query('select 1 from finding limit 1')).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      })
    } finally {
      await reader.end()
    }
  })

  it('holds no privilege of any kind for the reader', async () => {
    // The catalogue half of the assertion above. A `select` refusal proves the
    // reader cannot read; this proves it cannot do anything else either, which
    // is what migration 021's silence is meant to mean.
    const { rows } = await writer.query(
      `select privilege_type
         from information_schema.table_privileges
        where grantee = 'watchdog_reader'
          and table_schema = 'public'
          and table_name = 'finding'`,
    )

    expect(rows).toEqual([])
  })
})
