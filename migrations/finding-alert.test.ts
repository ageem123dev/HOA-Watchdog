/**
 * Migration 023: the record of what the board was told.
 *
 * AD-13 — "never emits a second alert for a finding already raised". Until this
 * table existed that sentence was a property of code nobody had written. The
 * unique constraint below makes it a property of the database, which is the
 * arrangement migration 021 uses for the finding itself.
 *
 * Four properties are under test, and they fail in different ways.
 *
 * **One alert per finding, refused by the database.** Not "the mailer remembers
 * not to send twice". The interesting case is two concurrent detection runs, and
 * no amount of application care makes a read-then-write correct there.
 *
 * **The sent state and its recipients cannot disagree.** A row claiming to be
 * sent while naming nobody says a director was warned and cannot say which one,
 * which is precisely what a delivery record exists to answer. The shape is
 * `finding_review_is_attributed` from migration 021, applied to a different
 * lifecycle.
 *
 * **A delivery cannot be un-sent.** The mirror of 021's one-way finding
 * lifecycle, and it carries 021's correction with it: that trigger first fired
 * on UPDATE alone, and a plain INSERT carrying the finished state walked past
 * it. Both ends, from the start, because the sibling already paid for learning
 * that.
 *
 * **Un-deletable is a grant, not a habit.** Migration 002's default privileges
 * hand `watchdog_writer` DELETE on every table created after it, so this table
 * arrives deletable unless 023 takes it away.
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
 * All three, and `DATABASE_URL` is not optional — the same reason migration
 * 021's suite gives. Cleanup runs as the owner because the writer cannot delete,
 * which is the property under test, so without the admin URL these tests would
 * run, pass, and leave every row they wrote behind.
 */
const configured = Boolean(writerUrl && readerUrl && adminUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  finding_alert migration tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL, ' +
      'WATCHDOG_READER_DATABASE_URL and DATABASE_URL must all be set.\n',
  )
}

const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'
const INSUFFICIENT_PRIVILEGE = '42501'
/** What a plpgsql `raise exception` reports when it names no other errcode. */
const RAISE_EXCEPTION = 'P0001'

/**
 * Every finding this file raises carries this in its `finding_type`.
 *
 * Lower-case and starting with a letter, because migration 021's
 * `finding_type_is_verb_noun` holds that column to `^[a-z][a-z0-9_]*$` and a
 * prefix of raw hex beginning with a digit would be refused by a constraint this
 * suite is not testing.
 *
 * Cleanup runs as the **owner** and cannot be done any other way: the writer's
 * inability to DELETE is the point of the migration.
 */
const RUN_PREFIX = `a${randomBytes(4).toString('hex')}`

// `__dirname` under `type: module`, matching the seven migration tests beside it
// and relying on the same Vitest polyfill. The open action item from Epic 1 asks
// for one choice across the repo rather than per file, so converting this one
// alone is the churn that item exists to prevent.
const MIGRATION = readFileSync(join(__dirname, '023_finding_alert.sql'), 'utf8')

describe('the migration says what it does', () => {
  const sql = executable(MIGRATION)

  it('strips the prose before any of the assertions below read it', () => {
    // The control for the comment stripping, and it has to be a phrase really in
    // the prose and really not in the SQL. A control asserting the absence of
    // something never present holds with the stripping deleted.
    expect(MIGRATION).toContain('Un-deletable is a grant, not a habit')
    expect(sql).not.toContain('Un-deletable is a grant, not a habit')
  })

  it('revokes delete rather than trusting the application', () => {
    expect(sql).toMatch(
      /revoke\s+delete,\s*truncate\s+on\s+finding_alert\s+from\s+watchdog_writer/i,
    )
    expect(sql).toMatch(/revoke\s+delete,\s*truncate\s+on\s+finding_alert\s+from\s+public/i)
  })

  it('does not revoke update, because recording the send is an update', () => {
    // The distinction this migration turns on. The claim is inserted before the
    // send and stamped after it, so revoking UPDATE would make the flow
    // unimplementable — and the mailer would discover it at runtime, on the
    // first real alert, having already sent the email.
    expect(sql).not.toMatch(/revoke[^;]*\bupdate\b[^;]*on\s+finding_alert/i)
  })

  it('pins the search path on the function a check constraint calls', () => {
    // A CHECK evaluated under a caller's search_path could otherwise resolve
    // `unnest` or `btrim` to something else. A constraint that can be steered
    // by a session setting is not a constraint.
    expect(sql).toMatch(/set\s+search_path\s*=\s*pg_catalog/i)
  })

  it('grants the reader nothing', () => {
    // Migration 021's silence, for the same reason and one step further on: a
    // catalog entry that could read this table would let a question about dues
    // disclose which directors were warned about whom.
    expect(sql).not.toMatch(/grant[^;]*on\s+finding_alert\s+to\s+watchdog_reader/i)
  })
})

describeWithDatabase('one alert per finding', () => {
  let writer: Client
  let owner: Client

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    owner = new Client({ connectionString: adminUrl })
    await owner.connect()
  })

  afterAll(async () => {
    try {
      // Alerts first: they reference findings, and the owner is not exempt from
      // the foreign key. Deleting the findings first would fail and leave both
      // sets behind.
      await owner?.query(
        `delete from finding_alert
          where finding_id in (select id from finding where finding_type like $1)`,
        [`${RUN_PREFIX}%`],
      )
      await owner?.query(`delete from finding where finding_type like $1`, [`${RUN_PREFIX}%`])
    } finally {
      // `allSettled` rather than two awaits: `owner.end()` rejecting would leave
      // `writer.end()` unreached and leak the connection this `finally` exists
      // to close. The idiom migration 021's suite and `pool.ts` both reached.
      await Promise.allSettled([owner, writer].map((client) => client?.end()))
    }
  })

  /** A fresh finding to hang an alert on, returning its id. */
  const raiseFinding = async (suffix: string): Promise<string> => {
    const result = await writer.query<{ id: string }>(
      `insert into finding (finding_type, subject_id, period, evidence)
       values ($1, gen_random_uuid(), $2::daterange, $3::jsonb)
       returning id`,
      [`${RUN_PREFIX}_${suffix}`, '[2026-03-01,2026-04-01)', '{"seen": 1}'],
    )

    return result.rows[0]!.id
  }

  it('refuses a second alert for a finding already alerted', async () => {
    const findingId = await raiseFinding('twice')

    await writer.query(`insert into finding_alert (finding_id) values ($1)`, [findingId])

    await expect(
      writer.query(`insert into finding_alert (finding_id) values ($1)`, [findingId]),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION })
  })

  it('refuses an alert for a finding that does not exist', async () => {
    // Not a cosmetic constraint: an alert row whose finding is absent claims a
    // director was warned about something nobody can look up, which reads as
    // answered.
    await expect(
      writer.query(`insert into finding_alert (finding_id) values (gen_random_uuid())`),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION })
  })

  it('accepts the claim, then the send, and reads back both', async () => {
    const findingId = await raiseFinding('roundtrip')

    await writer.query(`insert into finding_alert (finding_id) values ($1)`, [findingId])
    await writer.query(
      `update finding_alert set sent_at = now(), recipients = $2 where finding_id = $1`,
      [findingId, ['treasurer@example.test', 'president@example.test']],
    )

    // Reverse it: what the claim-then-send wrote is what a reader gets back,
    // including the order of the addresses. A `text[]` that arrived as a string
    // would round-trip as one element and this would catch it.
    const read = await writer.query<{
      sent_at: Date | null
      recipients: string[] | null
      failure: string | null
    }>(`select sent_at, recipients, failure from finding_alert where finding_id = $1`, [findingId])

    expect(read.rows).toHaveLength(1)
    expect(read.rows[0]!.sent_at).toBeInstanceOf(Date)
    expect(read.rows[0]!.recipients).toEqual(['treasurer@example.test', 'president@example.test'])
    expect(read.rows[0]!.failure).toBeNull()
  })
})

describeWithDatabase('the sent state and its recipients cannot disagree', () => {
  let writer: Client
  let owner: Client

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    owner = new Client({ connectionString: adminUrl })
    await owner.connect()
  })

  afterAll(async () => {
    try {
      await owner?.query(
        `delete from finding_alert
          where finding_id in (select id from finding where finding_type like $1)`,
        [`${RUN_PREFIX}%`],
      )
      await owner?.query(`delete from finding where finding_type like $1`, [`${RUN_PREFIX}%`])
    } finally {
      await Promise.allSettled([owner, writer].map((client) => client?.end()))
    }
  })

  const raiseFinding = async (suffix: string): Promise<string> => {
    const result = await writer.query<{ id: string }>(
      `insert into finding (finding_type, subject_id, period, evidence)
       values ($1, gen_random_uuid(), $2::daterange, $3::jsonb)
       returning id`,
      [`${RUN_PREFIX}_${suffix}`, '[2026-03-01,2026-04-01)', '{"seen": 1}'],
    )

    return result.rows[0]!.id
  }

  /**
   * The claim, as the mailer writes it.
   *
   * Every case below reaches the check constraint through an UPDATE, because
   * that is the only way the real flow can reach it: the lifecycle trigger
   * refuses an INSERT carrying `sent_at` or `recipients` at all, so an
   * inconsistent row can only be *arrived at*, never born.
   */
  const claim = (findingId: string) =>
    writer.query(`insert into finding_alert (finding_id) values ($1)`, [findingId])

  it('refuses a row that claims to be sent while naming nobody', async () => {
    const findingId = await raiseFinding('sent_nobody')
    await claim(findingId)

    await expect(
      writer.query(`update finding_alert set sent_at = now() where finding_id = $1`, [findingId]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('refuses a row that claims to be sent to an empty list', async () => {
    // The other spelling of the same lie, and the one a mailer that found no
    // enabled board members would actually write.
    const findingId = await raiseFinding('sent_empty')
    await claim(findingId)

    await expect(
      writer.query(
        `update finding_alert set sent_at = now(), recipients = $2 where finding_id = $1`,
        [findingId, []],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('refuses a recipient list with a hole in it', async () => {
    // `array_length` counts a null element, so a list of two where one is null
    // passes a non-empty check and still cannot say who was told. This is the
    // same failure as the empty list wearing a longer coat.
    const findingId = await raiseFinding('sent_hole')
    await claim(findingId)

    await expect(
      writer.query(
        `update finding_alert set sent_at = now(), recipients = $2 where finding_id = $1`,
        [findingId, ['treasurer@example.test', null]],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('refuses a recipient that is a blank string', async () => {
    const findingId = await raiseFinding('sent_blank')
    await claim(findingId)

    await expect(
      writer.query(
        `update finding_alert set sent_at = now(), recipients = $2 where finding_id = $1`,
        [findingId, ['treasurer@example.test', '   ']],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('refuses recipients on a row that was never sent', async () => {
    const findingId = await raiseFinding('unsent_named')
    await claim(findingId)

    await expect(
      writer.query(`update finding_alert set recipients = $2 where finding_id = $1`, [
        findingId,
        ['treasurer@example.test'],
      ]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('refuses a failure message long enough to be a provider echoing the request', async () => {
    const findingId = await raiseFinding('long_failure')

    await expect(
      writer.query(`insert into finding_alert (finding_id, failure) values ($1, $2)`, [
        findingId,
        'x'.repeat(2001),
      ]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })
})

describeWithDatabase('a delivery cannot be un-sent', () => {
  let writer: Client
  let owner: Client

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    owner = new Client({ connectionString: adminUrl })
    await owner.connect()
  })

  afterAll(async () => {
    try {
      await owner?.query(
        `delete from finding_alert
          where finding_id in (select id from finding where finding_type like $1)`,
        [`${RUN_PREFIX}%`],
      )
      await owner?.query(`delete from finding where finding_type like $1`, [`${RUN_PREFIX}%`])
    } finally {
      await Promise.allSettled([owner, writer].map((client) => client?.end()))
    }
  })

  const raiseFinding = async (suffix: string): Promise<string> => {
    const result = await writer.query<{ id: string }>(
      `insert into finding (finding_type, subject_id, period, evidence)
       values ($1, gen_random_uuid(), $2::daterange, $3::jsonb)
       returning id`,
      [`${RUN_PREFIX}_${suffix}`, '[2026-03-01,2026-04-01)', '{"seen": 1}'],
    )

    return result.rows[0]!.id
  }

  const claimAndSend = async (findingId: string) => {
    await writer.query(`insert into finding_alert (finding_id) values ($1)`, [findingId])
    await writer.query(
      `update finding_alert set sent_at = now(), recipients = $2 where finding_id = $1`,
      [findingId, ['treasurer@example.test']],
    )
  }

  it('refuses to clear sent_at once it is set', async () => {
    const findingId = await raiseFinding('unsend')
    await claimAndSend(findingId)

    // `finding_alert_sent_is_attributed` cannot express this: a check constraint
    // sees one row, and a row with both `sent_at` and `recipients` cleared is
    // internally consistent. Migration 021 hit the identical wall and answered
    // it with a trigger.
    await expect(
      writer.query(
        `update finding_alert set sent_at = null, recipients = null where finding_id = $1`,
        [findingId],
      ),
    ).rejects.toMatchObject({ code: RAISE_EXCEPTION })
  })

  it('refuses to rewrite who a sent alert went to', async () => {
    const findingId = await raiseFinding('rewrite')
    await claimAndSend(findingId)

    await expect(
      writer.query(`update finding_alert set recipients = $2 where finding_id = $1`, [
        findingId,
        ['someone-else@example.test'],
      ]),
    ).rejects.toMatchObject({ code: RAISE_EXCEPTION })
  })

  it('refuses to move an unsent alert onto a different finding', async () => {
    // The identity branch of the trigger, which nothing exercised. It matters
    // for the same reason migration 021's does: one UPDATE could otherwise
    // carry a delivery record from the finding it was about to a different one
    // with its timestamps intact -- worse than a missing record, because the
    // register still looks complete. Raised by CodeRabbit.
    //
    // Left unsent deliberately, so the refusal comes from the identity rule
    // rather than from the whole-row freeze that applies once sent.
    const first = await raiseFinding('identity_a')
    const second = await raiseFinding('identity_b')

    await writer.query(`insert into finding_alert (finding_id) values ($1)`, [first])

    await expect(
      writer.query(`update finding_alert set finding_id = $2 where finding_id = $1`, [
        first,
        second,
      ]),
    ).rejects.toMatchObject({ code: RAISE_EXCEPTION })
  })

  it('refuses an alert inserted already sent', async () => {
    // Migration 021 shipped this hole: its trigger fired on UPDATE alone, and a
    // plain INSERT carrying the finished state walked straight past it. The
    // sibling paid for that lesson; this table starts with both ends covered.
    const findingId = await raiseFinding('born_sent')

    await expect(
      writer.query(
        `insert into finding_alert (finding_id, sent_at, recipients)
         values ($1, now(), $2)`,
        [findingId, ['treasurer@example.test']],
      ),
    ).rejects.toMatchObject({ code: RAISE_EXCEPTION })
  })

  it('refuses to re-claim an alert that has already been sent', async () => {
    // The other half of "final", and the half a trigger guarding only `sent_at`
    // and `recipients` leaves open. Moving `claimed_at` forward on a delivered
    // alert rewrites when the board was told without touching the columns that
    // look like they say so.
    const findingId = await raiseFinding('reclaim_sent')
    await claimAndSend(findingId)

    await expect(
      writer.query(`update finding_alert set claimed_at = now() where finding_id = $1`, [
        findingId,
      ]),
    ).rejects.toMatchObject({ code: RAISE_EXCEPTION })
  })

  it('refuses to write a failure onto an alert that succeeded', async () => {
    // A delivered alert acquiring a failure message afterwards is a record that
    // contradicts itself, and the contradiction is the kind an operator would
    // resolve in the wrong direction.
    const findingId = await raiseFinding('fail_sent')
    await claimAndSend(findingId)

    await expect(
      writer.query(`update finding_alert set failure = $2 where finding_id = $1`, [
        findingId,
        'the provider refused',
      ]),
    ).rejects.toMatchObject({ code: RAISE_EXCEPTION })
  })

  it('still allows a claim to be retried while it is unsent', async () => {
    // The mutable half, and it is load-bearing: the at-least-once guarantee
    // depends on a stale claim being re-claimable. A trigger that froze the row
    // entirely would satisfy every refusal above and strand every failed send.
    const findingId = await raiseFinding('reclaim')

    await writer.query(`insert into finding_alert (finding_id, failure) values ($1, $2)`, [
      findingId,
      'the provider refused',
    ])

    await expect(
      writer.query(
        `update finding_alert set claimed_at = now(), failure = null where finding_id = $1`,
        [findingId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 })
  })
})

describeWithDatabase('un-deletable, and invisible to the reader', () => {
  let writer: Client
  let reader: Client
  let owner: Client
  let findingId: string

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    reader = new Client({ connectionString: readerUrl })
    await reader.connect()
    owner = new Client({ connectionString: adminUrl })
    await owner.connect()

    const raised = await writer.query<{ id: string }>(
      `insert into finding (finding_type, subject_id, period, evidence)
       values ($1, gen_random_uuid(), $2::daterange, $3::jsonb)
       returning id`,
      [`${RUN_PREFIX}_grants`, '[2026-03-01,2026-04-01)', '{"seen": 1}'],
    )
    findingId = raised.rows[0]!.id

    await writer.query(`insert into finding_alert (finding_id) values ($1)`, [findingId])
  })

  afterAll(async () => {
    try {
      await owner?.query(
        `delete from finding_alert
          where finding_id in (select id from finding where finding_type like $1)`,
        [`${RUN_PREFIX}%`],
      )
      await owner?.query(`delete from finding where finding_type like $1`, [`${RUN_PREFIX}%`])
    } finally {
      await Promise.allSettled([owner, reader, writer].map((client) => client?.end()))
    }
  })

  it('refuses the writer a delete of a row that is really there', async () => {
    // Scoped by id rather than left unqualified. Migration 020's suite made the
    // same correction and gives the reason: Postgres checks the privilege before
    // matching rows, so the assertion is unchanged — and on the one run where
    // the grant has regressed, an unqualified delete is the test wiping the
    // table it exists to protect.
    await expect(
      writer.query(`delete from finding_alert where finding_id = $1`, [findingId]),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })

    // The control: the row the delete was refused was genuinely present, so the
    // refusal is about the privilege and not about an empty table.
    const still = await writer.query(`select 1 from finding_alert where finding_id = $1`, [
      findingId,
    ])
    expect(still.rowCount).toBe(1)
  })

  it('refuses the writer a truncate', async () => {
    await expect(writer.query(`truncate finding_alert`)).rejects.toMatchObject({
      code: INSUFFICIENT_PRIVILEGE,
    })
  })

  it('refuses the reader any sight of the table', async () => {
    await expect(reader.query(`select 1 from finding_alert`)).rejects.toMatchObject({
      code: INSUFFICIENT_PRIVILEGE,
    })
  })
})
