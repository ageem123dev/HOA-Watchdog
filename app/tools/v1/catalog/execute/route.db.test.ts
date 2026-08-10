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

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const adminUrl = process.env.DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  tool endpoint database tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL must both be set.\n',
  )
}

const TOKEN = 'r7Qx-4kP9mVt2LbN8sYw0aZc'
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

    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    if (adminUrl) {
      owner = new Client({ connectionString: adminUrl })
      await owner.connect()
    }

    const member = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash)
       values ($1, 'scrypt$1$1$1$x$y') returning id`,
      [`${RUN_PREFIX}@example.com`],
    )
    actorId = member.rows[0]!.id

    unitNumber = `${RUN_PREFIX}-7C`
    const unit = await writer.query<{ id: string }>(
      'insert into unit (unit_number) values ($1) returning id',
      [unitNumber],
    )
    await writer.query(
      `insert into assessment (unit_id, assessment_year, annual_amount, billing_cycle)
       values ($1, 2026, '3600.00', 'monthly')`,
      [unit.rows[0]!.id],
    )
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    if (owner) {
      // Scoped to this run's actor. `query_log` cannot be cleaned by the writer
      // at all — migration 020 revokes DELETE, which is the point of it.
      await owner.query('delete from query_log where actor_id = $1', [actorId])
      await owner.query(
        'delete from assessment where unit_id in (select id from unit where unit_number like $1)',
        [`${RUN_PREFIX}%`],
      )
      await owner.query('delete from unit where unit_number like $1', [`${RUN_PREFIX}%`])
      await owner.query('delete from board_member where email like $1', [`${RUN_PREFIX}%`])
      await owner.end()
    }
    await writer?.end()
  })

  it('answers with the catalog rows the entry produces', async () => {
    const response = await call({
      entryId: 'dues_status',
      version: 1,
      parameters: { unitNumber, assessmentYear: 2026 },
      actorId,
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
      actorId,
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
      { entryId: 'dues_status', version: 1, parameters: { unitNumber, assessmentYear: 2026 }, actorId },
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
      actorId,
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
