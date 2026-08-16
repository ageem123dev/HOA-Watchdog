/**
 * Choosing what to alert on, owning the send, and recording what happened —
 * against a real database.
 *
 * Three collaborators in one file because they share a fixture and are only
 * meaningful together: a claim is meaningless without the read that produced the
 * candidate, and the read's exclusion rule is *"no successful delivery"*, which
 * only the ledger can create.
 *
 * ## Determinism, given that `awaitingAlert` has no `where` to scope
 *
 * It reads the whole register, exactly as `unreviewed` does, so the run-prefix
 * isolation every other adapter test here uses does not apply. The technique is
 * `finding-reader-postgres.test.ts`'s, inverted:
 *
 * - **Seed into 1990.** That file seeds into 2099 because its reads are newest
 *   first. This read is *oldest* first — a warning that has been waiting longest
 *   is the one closest to being too late — so the far past is what puts this
 *   file's rows ahead of every other file's.
 * - **Assert relative order within the result**, never absolute position.
 * - **Cross-check** the exclusion against a control query written independently
 *   here, so the read is verified a second way rather than against itself.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createBoardRecipients, createFindingAlertLedger } from './finding-alert-postgres'
import { createFindingReader } from './finding-reader-postgres'
import { setPoolTimeZone } from './pool-time-zone'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const adminUrl = process.env.DATABASE_URL
const configured = Boolean(writerUrl && adminUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  finding alert tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and DATABASE_URL must both be set.\n',
  )
}

/** Underscored, because `finding_type_is_verb_noun` refuses anything else. */
const RUN_PREFIX = `alertrun_${randomBytes(4).toString('hex')}`

/** Big enough to hold every row this file seeds, so order can be read off one result. */
const ALL = 200

let writer: Client
let owner: Client

/**
 * A finding raised at an explicit instant in 1990, so it sorts ahead of every
 * other file's rows under an oldest-first read.
 *
 * Inserted directly rather than through `createFindingRegister`, which stamps
 * `raised_at` itself — correctly, since a detector must not be able to place a
 * finding outside the window an auditor is looking at. The ordering under test
 * is a property of that column, so the test has to own it.
 */
async function seedFinding(suffix: string, raisedAt: string): Promise<string> {
  const { rows } = await writer.query<{ id: string }>(
    `insert into finding (finding_type, subject_id, period, evidence, raised_at)
     values ($1, $2, daterange($3::date, $4::date, '[)'), $5::jsonb, $6::timestamptz)
     returning id`,
    [
      `${RUN_PREFIX}_${suffix}`,
      randomUUID(),
      '1990-04-01',
      '1990-05-01',
      JSON.stringify({ invoicesChecked: 3 }),
      raisedAt,
    ],
  )

  return rows[0]!.id
}

/** Every finding this file seeded, whatever its alert state. Independent of the read under test. */
async function seededIds(): Promise<readonly string[]> {
  const { rows } = await writer.query<{ id: string }>(
    `select id from finding where finding_type like $1 order by raised_at, id`,
    [`${RUN_PREFIX}%`],
  )

  return rows.map((row) => row.id)
}

async function connect() {
  writer = new Client({ connectionString: writerUrl })
  await writer.connect()
  owner = new Client({ connectionString: adminUrl })
  await owner.connect()
}

async function cleanUp(emailPrefix?: string) {
  try {
    // Alerts first: they reference findings, and the owner is not exempt from
    // the foreign key.
    await owner?.query(
      `delete from finding_alert
        where finding_id in (select id from finding where finding_type like $1)`,
      [`${RUN_PREFIX}%`],
    )
    await owner?.query(`delete from finding where finding_type like $1`, [`${RUN_PREFIX}%`])
    // The reviewer seeded by the exclusion test above, which cannot use the
    // email prefix the recipient suite uses -- a board member is a recipient,
    // and leaving one behind would change what a later suite reads.
    await owner?.query(`delete from board_member where email like $1`, [`${RUN_PREFIX}%`])
    if (emailPrefix !== undefined) {
      await owner?.query(`delete from board_member where email like $1`, [`${emailPrefix}%`])
    }
  } finally {
    await Promise.allSettled([owner, writer].map((client) => client?.end()))
  }
}

describeWithDatabase('what the board has not been told about yet', () => {
  const reader = createFindingReader()
  const ledger = createFindingAlertLedger()

  let never: string
  let claimedUnsent: string
  let delivered: string

  beforeAll(async () => {
    await connect()

    // Ordered so the assertion below reads the sort, not the insertion order.
    never = await seedFinding('never', '1990-01-01T00:00:00Z')
    claimedUnsent = await seedFinding('claimed', '1990-02-01T00:00:00Z')
    delivered = await seedFinding('delivered', '1990-03-01T00:00:00Z')

    await ledger.claim(claimedUnsent, new Date('1990-01-01T00:00:00Z'))
    await ledger.claim(delivered, new Date('1990-01-01T00:00:00Z'))
    await ledger.recordSent(delivered, ['treasurer@example.test'])
  })

  afterAll(() => cleanUp())

  it('offers the findings nobody has been told about, oldest first', async () => {
    const awaiting = await reader.awaitingAlert(ALL)
    const ours = awaiting.filter((finding) => finding.findingType.startsWith(RUN_PREFIX))

    expect(ours.map((finding) => finding.id)).toEqual([never, claimedUnsent])
  })

  it('excludes a finding whose alert was delivered', async () => {
    const awaiting = await reader.awaitingAlert(ALL)

    expect(awaiting.map((finding) => finding.id)).not.toContain(delivered)
  })

  it('still offers a finding whose claim is held but unsent', async () => {
    // Candidates, not instructions. Arbitration is `claim`'s job, and it can do
    // it in one statement against a unique constraint; a read that tried to
    // exclude live claims would answer a question that has changed by the time
    // the caller acts on it.
    const awaiting = await reader.awaitingAlert(ALL)

    expect(awaiting.map((finding) => finding.id)).toContain(claimedUnsent)
  })

  it('agrees with a control query written independently of it', async () => {
    // Cross-check. The read's rule is "no successful delivery"; this computes
    // the same set the obvious slow way and the two must agree over the rows
    // this file owns.
    const awaiting = await reader.awaitingAlert(ALL)
    const offered = new Set(awaiting.map((finding) => finding.id))

    const { rows } = await writer.query<{ id: string }>(
      `select f.id
         from finding f
        where f.finding_type like $1
          and f.state = 'unreviewed'
          and not exists (
                select 1 from finding_alert a
                 where a.finding_id = f.id and a.sent_at is not null
              )`,
      [`${RUN_PREFIX}%`],
    )

    const control = rows.map((row) => row.id).sort()
    const seeded = await seededIds()
    const mine = seeded.filter((id) => offered.has(id)).sort()

    expect(mine).toEqual(control)
  })

  it('excludes a finding a board member has already reviewed', async () => {
    // **Found by the whole-story integration pass, and only reachable through
    // two tasks interacting.** The read excludes findings with a delivered
    // alert; it said nothing about state, and "it will always be unreviewed
    // anyway" was true only while an alert went out in the same request that
    // raised the finding.
    //
    // The retry path and the unconfigured-then-configured path both break that.
    // Mail unset for a week, a board working through the dashboard, mail then
    // configured -- and every finding they had already dealt with arrives as an
    // email asking them to go and look at it. Worse than noise: the link lands
    // on the already-reviewed state, so a second director is invited to review
    // something the register has already answered.
    //
    // An alert exists to make somebody look. If somebody has looked, there is
    // nothing left for it to do.
    const findingId = await seedFinding('reviewed', '1990-04-01T00:00:00Z')

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash)
       values ($1, 'scrypt$1$1$1$x$y')
       returning id`,
      [`${RUN_PREFIX}-reviewer@example.test`],
    )
    await writer.query(
      `update finding set state = 'reviewed', reviewed_by = $2, reviewed_at = now()
        where id = $1`,
      [findingId, rows[0]!.id],
    )

    const awaiting = await reader.awaitingAlert(ALL)

    expect(awaiting.map((entry) => entry.id)).not.toContain(findingId)
  })

  it('carries the evidence and the dates the message is built from', async () => {
    const awaiting = await reader.awaitingAlert(ALL)
    const found = awaiting.find((finding) => finding.id === never)

    expect(found).toBeDefined()
    expect(found!.period).toEqual({ from: '1990-04-01', until: '1990-05-01' })
    expect(found!.raisedOn).toBe('1990-01-01')
    expect(found!.evidence).toEqual({ invoicesChecked: 3 })
    // Never alerted means never reviewed, and the shape has to say so rather
    // than leaving the field absent — `toFindingDetail` reads it.
    expect(found!.reviewed).toBeNull()
  })

  it('renders dates in UTC whatever the session timezone is', async () => {
    // The defect story 4.4 shipped in two readers. `to_char` on a `timestamptz`
    // renders in the session's zone, so a finding raised at midnight UTC answers
    // the day before on a connection set west of Greenwich.
    await setPoolTimeZone('America/Los_Angeles')
    try {
      const awaiting = await reader.awaitingAlert(ALL)
      const found = awaiting.find((finding) => finding.id === never)

      expect(found!.raisedOn).toBe('1990-01-01')
    } finally {
      await setPoolTimeZone('UTC')
    }
  })

  it('refuses a limit that is not a bound', async () => {
    // The rule `unreviewed` and `register` already carry, and for the same
    // reason: a caller that forgets a bound is the one reading a table that
    // only ever grows.
    await expect(reader.awaitingAlert(0)).rejects.toBeInstanceOf(RangeError)
    await expect(reader.awaitingAlert(-1)).rejects.toBeInstanceOf(RangeError)
    await expect(reader.awaitingAlert(1.5)).rejects.toBeInstanceOf(RangeError)
    await expect(reader.awaitingAlert(1_000_000)).rejects.toBeInstanceOf(RangeError)
  })
})

describeWithDatabase('owning the send', () => {
  const ledger = createFindingAlertLedger()

  const PAST = new Date('1990-01-01T00:00:00Z')

  beforeAll(connect)
  afterAll(() => cleanUp())

  /** Anything claimed before now is stale, so a stale claim is always re-claimable. */
  const everythingIsStale = () => new Date(Date.now() + 60_000)

  it('grants the claim to the first caller', async () => {
    const findingId = await seedFinding('first', '1990-01-01T00:00:00Z')

    await expect(ledger.claim(findingId, PAST)).resolves.toBe(true)
  })

  it('refuses a second caller while the first claim is fresh', async () => {
    // The duplicate AD-13 forbids, refused at the one place it can be: a caller
    // that cannot tell "I own this" from "somebody else does" sends anyway.
    const findingId = await seedFinding('contended', '1990-01-01T00:00:00Z')

    await expect(ledger.claim(findingId, PAST)).resolves.toBe(true)
    await expect(ledger.claim(findingId, PAST)).resolves.toBe(false)
  })

  it('grants the claim again once the first has gone stale', async () => {
    // The recovery path. Without it a run that claimed and then died leaves the
    // board never warned, which is the silence this whole story exists to
    // remove.
    const findingId = await seedFinding('stale', '1990-01-01T00:00:00Z')

    await expect(ledger.claim(findingId, PAST)).resolves.toBe(true)
    await expect(ledger.claim(findingId, everythingIsStale())).resolves.toBe(true)
  })

  it('refuses the claim once the alert has been delivered, however stale', async () => {
    // Staleness must not reopen a finished delivery. A sent alert is sent.
    const findingId = await seedFinding('done', '1990-01-01T00:00:00Z')

    await ledger.claim(findingId, PAST)
    await ledger.recordSent(findingId, ['treasurer@example.test'])

    await expect(ledger.claim(findingId, everythingIsStale())).resolves.toBe(false)
  })

  it('records who the alert went to, and reads back exactly that', async () => {
    const findingId = await seedFinding('recorded', '1990-01-01T00:00:00Z')

    await ledger.claim(findingId, PAST)
    await ledger.recordSent(findingId, ['treasurer@example.test', 'president@example.test'])

    // Reverse it: what was recorded is what comes back, in the order recorded.
    const { rows } = await writer.query<{ recipients: string[]; sent_at: Date }>(
      `select recipients, sent_at from finding_alert where finding_id = $1`,
      [findingId],
    )

    expect(rows[0]!.recipients).toEqual(['treasurer@example.test', 'president@example.test'])
    expect(rows[0]!.sent_at).toBeInstanceOf(Date)
  })

  it('leaves the alert unsent when it records a failure', async () => {
    // Deliberately not a swallowed error. The claim stays, goes stale, and a
    // later run takes it over — which is the whole of the recovery story.
    const findingId = await seedFinding('failed', '1990-01-01T00:00:00Z')

    await ledger.claim(findingId, PAST)
    await ledger.recordFailure(findingId, 'the provider refused')

    const { rows } = await writer.query<{ sent_at: Date | null; failure: string | null }>(
      `select sent_at, failure from finding_alert where finding_id = $1`,
      [findingId],
    )

    expect(rows[0]!.sent_at).toBeNull()
    expect(rows[0]!.failure).toBe('the provider refused')
    await expect(ledger.claim(findingId, everythingIsStale())).resolves.toBe(true)
  })

  it('truncates a failure the database would refuse rather than losing the record of it', async () => {
    // A provider echoing the request back would otherwise write past the column
    // cap, the insert would throw, and the *only* record that the send failed
    // would be lost to the failure of recording it.
    const findingId = await seedFinding('verbose', '1990-01-01T00:00:00Z')

    await ledger.claim(findingId, PAST)
    await expect(ledger.recordFailure(findingId, 'x'.repeat(5000))).resolves.toBeUndefined()

    const { rows } = await writer.query<{ failure: string }>(
      `select failure from finding_alert where finding_id = $1`,
      [findingId],
    )

    expect(rows[0]!.failure.length).toBeLessThanOrEqual(2000)
  })

  it('records a blank failure as something rather than refusing it', async () => {
    // The truncation's defect from the other end, and it is representable in a
    // `string`: a provider that fails with an empty body gives `''`, and
    // `finding_alert_failure_is_useful` refuses that — so recording *that the
    // send failed* would itself throw, and the alert would look like one nobody
    // had ever tried.
    const findingId = await seedFinding('blank', '1990-01-01T00:00:00Z')

    await ledger.claim(findingId, PAST)
    await expect(ledger.recordFailure(findingId, '   ')).resolves.toBeUndefined()

    const { rows } = await writer.query<{ failure: string | null }>(
      `select failure from finding_alert where finding_id = $1`,
      [findingId],
    )

    expect(rows[0]!.failure).toBeTruthy()
    expect(rows[0]!.failure!.trim()).not.toBe('')
  })

  it('lets a losing worker record a failure without disturbing a delivered alert', async () => {
    // At-least-once means two runs can both reach the send. Migration 023's
    // trigger makes "sent, and also failed" unrepresentable — it raises rather
    // than allowing it — so an unguarded update here would *throw* out of the
    // loser's failure path and look like the failure-recording itself broke.
    // The honest outcome is a no-op: somebody else delivered it, and there is
    // nothing left to record.
    const findingId = await seedFinding('loser', '1990-01-01T00:00:00Z')

    await ledger.claim(findingId, PAST)
    await ledger.recordSent(findingId, ['treasurer@example.test'])

    await expect(ledger.recordFailure(findingId, 'the provider refused')).resolves.toBeUndefined()

    const { rows } = await writer.query<{ sent_at: Date | null; failure: string | null }>(
      `select sent_at, failure from finding_alert where finding_id = $1`,
      [findingId],
    )

    expect(rows[0]!.sent_at).toBeInstanceOf(Date)
    expect(rows[0]!.failure).toBeNull()
  })

  it('lets a losing worker record a send without disturbing the delivery already recorded', async () => {
    // The same collision on the success path, and it matters more: the loser
    // would otherwise throw *after* having actually sent an email, and the
    // caller cannot tell that from a send that failed.
    const findingId = await seedFinding('double_send', '1990-01-01T00:00:00Z')

    await ledger.claim(findingId, PAST)
    await ledger.recordSent(findingId, ['treasurer@example.test'])

    await expect(ledger.recordSent(findingId, ['someone-else@example.test'])).resolves.toBeUndefined()

    const { rows } = await writer.query<{ recipients: string[] }>(
      `select recipients from finding_alert where finding_id = $1`,
      [findingId],
    )

    // The first delivery's record stands. It is the one that says what actually
    // happened first, and migration 023 refuses to let it be rewritten anyway.
    expect(rows[0]!.recipients).toEqual(['treasurer@example.test'])
  })
})

describeWithDatabase('who an alert goes to', () => {
  const recipients = createBoardRecipients()
  const EMAIL_PREFIX = `alert-recipient-${randomBytes(4).toString('hex')}`

  let enabled: string
  let disabled: string

  beforeAll(async () => {
    await connect()

    enabled = `${EMAIL_PREFIX}-enabled@example.test`
    disabled = `${EMAIL_PREFIX}-disabled@example.test`

    // **Inserted last-first**, so physical order and sorted order disagree. A
    // fixture seeded in alphabetical order makes an ordering assertion pass
    // whether or not the query sorts, which is the defect the test below was
    // rewritten for.
    for (const address of [`${EMAIL_PREFIX}-z@example.test`, enabled, `${EMAIL_PREFIX}-a@example.test`]) {
      await writer.query(
        `insert into board_member (email, password_hash) values ($1, 'scrypt$1$1$1$x$y')`,
        [address],
      )
    }
    await writer.query(
      `insert into board_member (email, password_hash, disabled_at)
       values ($1, 'scrypt$1$1$1$x$y', now())`,
      [disabled],
    )
  })

  afterAll(() => cleanUp(EMAIL_PREFIX))

  it('includes a member who is on the board', async () => {
    await expect(recipients.active()).resolves.toContain(enabled)
  })

  it('excludes a member who has left it', async () => {
    // The only difference between these two rows is `disabled_at`, and the only
    // difference in the outcome is this address. A director who has left keeps
    // their audit trail and stops receiving mail — the rule sign-in applies.
    await expect(recipients.active()).resolves.not.toContain(disabled)
  })

  it('answers in a defined order, not merely a repeatable one', async () => {
    // **Two identical reads of an unchanged table agree whatever the planner
    // does**, so comparing them proves nothing: the first version of this test
    // passed with `order by email` deleted. Raised by CodeRabbit, and it is the
    // shape this project keeps finding -- a guard that holds whether or not the
    // thing it guards is there.
    //
    // The addresses are written into the delivery record, and a record whose
    // order depends on the planner is one nobody can diff against another. So
    // assert the order itself.
    const active = await recipients.active()
    const ours = active.filter((address) => address.startsWith(EMAIL_PREFIX))

    expect(ours).toEqual([...ours].sort())
    expect(ours.length).toBeGreaterThan(1)
  })
})
