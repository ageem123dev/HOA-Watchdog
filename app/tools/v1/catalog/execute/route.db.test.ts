/**
 * The tool endpoint against the real database — the test that proves the parts
 * are connected rather than that each one works.
 *
 * `route.test.ts` mocks the executor, so it can prove the route *calls* it. It
 * cannot prove the door opens onto anything. Story 2.7's first learning is the
 * reason this file exists: "a green unit test proves a part works; only a test
 * that runs the path proves the parts are connected" — three epic-2 stories were
 * written because something built correctly was called by nothing, and story 3.1
 * shipped an executor with no caller at all.
 *
 * AC7 is the assertion: a successful call leaves exactly one `query_log` row
 * naming the actor the request supplied. Nothing but the real database can
 * answer that, because the provenance write happens under a different role on a
 * different connection.
 */

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  ACTOR_ASSERTION_AUDIENCE,
  ACTOR_ASSERTION_TTL_MS,
  mintActorAssertion,
} from '@/core/auth/actor-assertion'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const adminUrl = process.env.DATABASE_URL
/**
 * `DATABASE_URL` is required here, unlike the sibling database suites, and the
 * reason is a foreign key.
 *
 * `query_log.actor_id` references `board_member(id)` with no `ON DELETE
 * CASCADE`, and migration 020 revokes DELETE on `query_log` from
 * `watchdog_writer` — deliberately, since that table is the audit trail. So the
 * writer cannot remove this run's provenance rows, and its final
 * `delete from board_member` then fails with a foreign-key violation.
 *
 * An earlier draft ran without the owner and argued that only log rows would
 * remain. That was true while cleanup failures were being swallowed; once they
 * were made to surface, the same run fails outright. Skipping loudly beats
 * failing for a reason that has nothing to do with the code under test. Raised
 * by CodeRabbit on MR !37.
 */
const configured = Boolean(writerUrl && readerUrl && adminUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  tool endpoint database tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL, ' +
      'WATCHDOG_READER_DATABASE_URL and DATABASE_URL must all be set.\n' +
      '  DATABASE_URL is needed because only the owner may delete query_log rows,\n' +
      '  and board_member cannot be removed while they reference it.\n',
  )
}

const TOKEN = 'r7Qx-4kP9mVt2LbN8sYw0aZc'
const ASSERTION_KEY = 'route-db-test-actor-assertion-key'

/**
 * A live assertion for the seeded board member. Minted per call: it carries an
 * expiry, and one made once at module scope would age across a slow database
 * suite until these failed on the clock rather than on the code.
 */
const assertionFor = (subject: string) =>
  mintActorAssertion(subject, {
    key: ASSERTION_KEY,
    now: Date.now(),
    ttlMs: ACTOR_ASSERTION_TTL_MS,
    audience: ACTOR_ASSERTION_AUDIENCE,
  })
/** Lower-case and letter-initial, so it also satisfies `query_log_entry_id_shaped`. */
const RUN_PREFIX = `t${randomBytes(4).toString('hex')}`

const { POST } = await import('./route')

describeWithDatabase('POST /tools/v1/catalog/execute, end to end', () => {
  let writer: Client
  let owner: Client | null = null
  let actorId = ''
  let unitNumber = ''

  const call = (body: unknown, token: string | null = TOKEN) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (token !== null) headers.authorization = `Bearer ${token}`

    return POST(
      new Request('https://gateway.example/tools/v1/catalog/execute', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    )
  }

  beforeAll(async () => {
    vi.stubEnv('AGENT_SERVICE_TOKEN', TOKEN)
    vi.stubEnv('ACTOR_ASSERTION_KEY', ASSERTION_KEY)

    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    if (adminUrl) {
      owner = new Client({ connectionString: adminUrl })
      await owner.connect()
    }

    const member = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash, association_id) values ($1, 'scrypt$1$1$1$x$y', '00000000-0000-7000-8000-000000000001') returning id`,
      [`${RUN_PREFIX}@example.com`],
    )
    actorId = member.rows[0]!.id

    unitNumber = `${RUN_PREFIX}-7C`
    const unit = await writer.query<{ id: string }>(
      'insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\') returning id',
      [unitNumber],
    )
    await writer.query(
      `insert into assessment (unit_id, assessment_year, annual_amount, billing_cycle, association_id) values ($1, 2026, '3600.00', 'monthly', '00000000-0000-7000-8000-000000000001')`,
      [unit.rows[0]!.id],
    )
  })

  afterAll(async () => {
    vi.unstubAllEnvs()

    // `query_log` first, and only the owner can do it: migration 020 revokes
    // DELETE from `watchdog_writer`, which is the whole point of that table. If
    // `DATABASE_URL` is absent those rows remain, and that is what append-only
    // means — but it must not take the rest of the cleanup down with it.
    // Each step is independently guarded. Grouping them means the first failure
    // skips every cleanup after it — and an owner failure used to abort the
    // writer's cleanup entirely, leaking both the rows and the connection.
    // Raised by Argus on story 3.2.
    const failures: string[] = []
    const attempt = async (what: string, run: () => Promise<unknown>) => {
      try {
        await run()
      } catch (error) {
        // Collected, not swallowed. Logging alone lets a broken cleanup pass
        // silently and leak rows on every run afterwards — the failure would
        // only ever be noticed as unexplained data. Raised by Argus.
        failures.push(`${what}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (owner) {
      await attempt('query_log', () =>
        owner!.query('delete from query_log where actor_id = $1', [actorId]),
      )
      await attempt('owner.end', () => owner!.end())
    }

    // Everything else is the writer's to remove, so it happens whether or not an
    // owner connection exists. The first draft nested all of it under `if
    // (owner)` and leaked units, assessments and board members on every run
    // without an admin URL — raised by Argus, and the same shape sits in
    // `adapters/db/catalog-execution.test.ts` from story 3.1.
    await attempt('assessment', () =>
      writer.query(
        'delete from assessment where unit_id in (select id from unit where unit_number like $1)',
        [`${RUN_PREFIX}%`],
      ),
    )
    await attempt('unit', () =>
      writer.query('delete from unit where unit_number like $1', [`${RUN_PREFIX}%`]),
    )
    await attempt('board_member', () =>
      writer.query('delete from board_member where email like $1', [`${RUN_PREFIX}%`]),
    )
    await attempt('writer.end', () => writer.end())

    // Reported after every step has had its turn, so one failure neither hides
    // the others nor stops them running.
    if (failures.length > 0) {
      throw new Error(`cleanup failed and rows may remain: ${failures.join('; ')}`)
    }
  })

  it('answers with the catalog rows the entry produces', async () => {
    const response = await call({
      entryId: 'dues_status',
      version: 1,
      parameters: { unitNumber, assessmentYear: 2026 },
      actorAssertion: assertionFor(actorId),
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { provenanceId: string; rows: unknown[] }

    expect(payload.rows).toHaveLength(1)
    expect(payload.rows[0]).toMatchObject({
      unitNumber,
      assessmentYear: 2026,
      annualAmount: '3600.00',
      amountPaid: '0.00',
      balanceOutstanding: '3600.00',
    })
    expect(payload.provenanceId).toMatch(/^[0-9a-f-]{36}$/)
  })

  /** AC7. The row is the assertion, and only the real database can produce it. */
  it('leaves exactly one provenance row naming the actor the request supplied', async () => {
    const before = await logRowCount()

    const response = await call({
      entryId: 'dues_status',
      version: 1,
      parameters: { unitNumber, assessmentYear: 2026 },
      actorAssertion: assertionFor(actorId),
    })
    const { provenanceId } = (await response.json()) as { provenanceId: string }

    expect(await logRowCount()).toBe(before + 1)

    const { rows } = await writer.query(
      'select actor_id, entry_id, entry_version, parameters from query_log where id = $1',
      [provenanceId],
    )
    expect(rows[0]).toEqual({
      actor_id: actorId,
      entry_id: 'dues_status',
      entry_version: 1,
      parameters: { unitNumber, assessmentYear: 2026 },
    })
  })

  /**
   * The rejection path, against the real executor rather than a mock. An
   * unauthenticated call must leave the audit trail untouched — a provenance row
   * for a request that was never authorised would be worse than none, because it
   * would attribute the query to a director who did not make it.
   */
  it('writes no provenance row for a caller it refuses', async () => {
    const before = await logRowCount()

    const response = await call(
      { entryId: 'dues_status', version: 1, parameters: { unitNumber, assessmentYear: 2026 }, actorAssertion: assertionFor(actorId) },
      'not-the-token',
    )

    expect(response.status).toBe(401)
    expect(await logRowCount()).toBe(before)
  })

  it('answers 404 for an entry the catalog does not hold, and logs nothing', async () => {
    const before = await logRowCount()

    const response = await call({
      entryId: 'drop_everything',
      version: 1,
      parameters: {},
      actorAssertion: assertionFor(actorId),
    })

    expect(response.status).toBe(404)
    expect(await logRowCount()).toBe(before)
  })

  async function logRowCount(): Promise<number> {
    const { rows } = await writer.query<{ count: string }>(
      'select count(*) as count from query_log where actor_id = $1',
      [actorId],
    )

    return Number(rows[0]!.count)
  }
})
