/**
 * The access-log reader against a real database.
 *
 * The whole reason this file exists is the **grant**. Migration 020 gives
 * `select` on `query_log` to `watchdog_writer` and deliberately nothing to
 * `watchdog_reader`, and no mock can be wrong about a grant — a mocked pool
 * answers happily whichever role it was configured with, and the failure
 * appears as a `42501` in production on a page a board member just opened.
 *
 * `query-log-reader-connection.test.ts` asserts which URL the adapter asks for.
 * This asserts that the URL it asks for actually works.
 */

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createQueryLogReader } from './query-log-reader-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const configured = Boolean(writerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  query-log reader adapter tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL must be set.\n',
  )
}

let writer: Client
let memberId: string

/**
 * A fresh scope per test, not per file.
 *
 * `quarantine-queue-postgres.test.ts` learned this the hard way: scoping to the
 * run made each test see its predecessors' rows, so "returns nothing" could
 * never be true. The entry id carries the scope here because it is the column
 * this adapter filters on.
 */
let scope = ''

async function seedMember(): Promise<string> {
  // `password_hash` is `not null`, and the shape it holds is checked — the same
  // placeholder every other adapter test uses. Omitting it is how the first
  // version of this file failed, which is a fair advertisement for running these
  // against a real database rather than a mock that would have accepted it.
  const { rows } = await writer.query<{ id: string }>(
    `insert into board_member (email, password_hash, association_id) values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA', '00000000-0000-7000-8000-000000000001')
     returning id`,
    [`access-log-${randomBytes(6).toString('hex')}@example.test`],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('seeding a board member returned no id')

  return id
}

async function record(entryId: string, version = 1): Promise<void> {
  await writer.query(
    `insert into query_log (actor_id, entry_id, entry_version, parameters, sql_text, association_id) values ($1, $2, $3, $4::jsonb, $5, '00000000-0000-7000-8000-000000000001')`,
    [memberId, entryId, version, JSON.stringify({ unitNumber: '4B' }), 'select 1'],
  )
}

describeWithDatabase('reading the provenance log', () => {
  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    memberId = await seedMember()
  })

  afterAll(async () => {
    await writer.end()
  })

  beforeEach(() => {
    // A valid `verb_noun` id — migration 020 checks the shape — carrying a
    // per-test suffix so one test cannot see another's rows.
    scope = `test_${randomBytes(4).toString('hex')}`
  })

  it('can select at all, which is the grant this story depends on', async () => {
    // If the adapter were built on the reader URL this rejects with 42501, and
    // nothing else in the suite would notice.
    await expect(createQueryLogReader().recent({ limit: 1 })).resolves.toBeDefined()
  })

  it('returns a record it wrote, with the columns a reader needs', async () => {
    await record(scope)

    const [found] = await createQueryLogReader().recent({ entryId: scope, limit: 10 })

    expect(found).toBeDefined()
    expect(found!.entryId).toBe(scope)
    expect(found!.actorId).toBe(memberId)
    expect(found!.parameters).toEqual({ unitNumber: '4B' })
    expect(found!.sqlText).toBe('select 1')
    // Stamped by the database, never by a caller — which is why the writer's own
    // entry type has no field for it.
    expect(found!.executedAt).toBeInstanceOf(Date)
    expect(found!.id).toBeTruthy()
  })

  it('returns newest first', async () => {
    await record(scope, 1)
    await record(scope, 2)

    const found = await createQueryLogReader().recent({ entryId: scope, limit: 10 })

    expect(found.map((r) => r.entryVersion)).toEqual([2, 1])
  })

  it('filters by entry, in the query', async () => {
    await record(scope)
    await record(`${scope}_other`)

    const found = await createQueryLogReader().recent({ entryId: scope, limit: 10 })

    expect(found).toHaveLength(1)
  })

  it('filters by actor', async () => {
    const otherMember = await seedMember()
    await record(scope)
    await writer.query(
      `insert into query_log (actor_id, entry_id, entry_version, parameters, sql_text, association_id) values ($1, $2, 1, '{}'::jsonb, 'select 1', '00000000-0000-7000-8000-000000000001')`,
      [otherMember, scope],
    )

    const found = await createQueryLogReader().recent({
      entryId: scope,
      actorId: otherMember,
      limit: 10,
    })

    expect(found).toHaveLength(1)
    expect(found[0]!.actorId).toBe(otherMember)
  })

  it('honours the limit', async () => {
    await record(scope, 1)
    await record(scope, 2)
    await record(scope, 3)

    expect(await createQueryLogReader().recent({ entryId: scope, limit: 2 })).toHaveLength(2)
  })

  it('returns nothing rather than everything for a filter that matches nothing', async () => {
    // The failure mode this guards: a `where` clause that silently drops when a
    // value is absent would return the entire audit trail here, and the surface
    // would render it as though it matched.
    await record(scope)

    expect(
      await createQueryLogReader().recent({ entryId: `${scope}_absent`, limit: 10 }),
    ).toHaveLength(0)
  })

  it('does not let a filter value become SQL', async () => {
    await record(scope)

    // If this were interpolated it would end the string and comment out the
    // rest — on the table that records what SQL ran, which would be a uniquely
    // bad place to allow it.
    const found = await createQueryLogReader().recent({
      entryId: `${scope}' or '1'='1`,
      limit: 10,
    })

    expect(found).toHaveLength(0)
  })
})
