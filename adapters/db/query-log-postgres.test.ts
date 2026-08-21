/**
 * The provenance write, against a real database.
 *
 * This adapter had no test of its own. `catalog-execution.test.ts` drove it end
 * to end, which proves it is wired up but says nothing about the one thing it
 * decides alone: **which association a query is recorded — and now run — under.**
 *
 * That association is derived in SQL, from the board member the query is for,
 * inside the same INSERT that writes the record. Deriving it a second time for
 * the query itself would be two statements of one rule with nothing failing on
 * disagreement, so `record` returns what it derived and the executor binds
 * *that*. The property this file exists to hold: **the association a query runs
 * under is the association its audit row records.** They cannot drift, because
 * there is only one of them.
 *
 * Requires a database and skips without one.
 */

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createQueryLog } from './query-log-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL

/**
 * The owner connection exists for teardown alone, and it is required rather
 * than optional. Migration 020 revokes DELETE on `query_log` from
 * `watchdog_writer` — the audit trail is append-only, and the role that writes
 * it deliberately cannot unwrite it. So this file's own rows can only be
 * removed by the owner, and the `board_member` rows they reference cannot go
 * until they do.
 */
const adminUrl = process.env.DATABASE_URL
const configured = Boolean(writerUrl && adminUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  query-log tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and DATABASE_URL ' +
      'must both be set — the second is needed to clean up an append-only table.\n',
  )
}

/** Lower-case and letter-initial, so it also satisfies `query_log_entry_id_shaped`. */
const RUN_PREFIX = `q${randomBytes(4).toString('hex')}`

const entryFor = (actorId: string) => ({
  actorId,
  entryId: `${RUN_PREFIX}_entry`,
  entryVersion: 1,
  parameters: { unitNumber: '4B' },
  sqlText: 'select 1',
})

describeWithDatabase('the Postgres query log', () => {
  const client = new Client({ connectionString: writerUrl })
  const owner = new Client({ connectionString: adminUrl })
  const log = createQueryLog()

  let associationA = ''
  let associationB = ''
  let ada = ''
  let bo = ''

  beforeAll(async () => {
    await client.connect()
    await owner.connect()

    const association = async (label: string) => {
      const { rows } = await client.query<{ id: string }>(
        'insert into association (name) values ($1) returning id',
        [`${RUN_PREFIX}-${label}`],
      )
      return rows[0]!.id
    }

    const member = async (label: string, associationId: string) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into board_member (email, password_hash, association_id)
              values ($1, $2, $3) returning id`,
        [`${RUN_PREFIX}-${label}@association.example`, 'scrypt$1$1$1$AA$AA', associationId],
      )
      return rows[0]!.id
    }

    associationA = await association('a')
    associationB = await association('b')
    ada = await member('ada', associationA)
    bo = await member('bo', associationB)
  })

  afterAll(async () => {
    // Scoped to this run's own actors rather than to `entry_id`. The prefix
    // makes either safe here, but `catalog-execution.test.ts` records why the
    // actor is the right axis: a predicate on the entry would, written once
    // without a prefix, delete every provenance row that entry ever produced —
    // which on a database holding real history is the audit trail itself.
    await owner.query('delete from query_log where actor_id = any($1::uuid[])', [[ada, bo]])
    await owner.query('delete from board_member where email like $1', [`${RUN_PREFIX}-%`])
    await owner.query('delete from association where name like $1', [`${RUN_PREFIX}-%`])
    await client.end()
    await owner.end()
  })

  it('returns the id of the row it wrote', async () => {
    const { provenanceId } = await log.record(entryFor(ada))

    const { rows } = await client.query('select id from query_log where id = $1', [provenanceId])

    expect(rows).toHaveLength(1)
  })

  it('returns the association it derived from the actor', async () => {
    const { associationId } = await log.record(entryFor(ada))

    expect(associationId).toBe(associationA)
  })

  /**
   * Cross-check, and the whole point of returning the value rather than
   * deriving it twice: what the caller binds into the query and what the audit
   * trail records are read back from the same write.
   */
  it('returns the same association it wrote to the row', async () => {
    const { provenanceId, associationId } = await log.record(entryFor(ada))

    const { rows } = await client.query<{ association_id: string }>(
      'select association_id from query_log where id = $1',
      [provenanceId],
    )

    expect(associationId).toBe(rows[0]!.association_id)
  })

  /**
   * Zero-one-many across associations. A derivation that reached for "the
   * association" rather than *this actor's* association answers identically
   * while one exists, and wrongly the moment two do.
   */
  it('derives each actor its own association', async () => {
    const first = await log.record(entryFor(ada))
    const second = await log.record(entryFor(bo))

    expect(first.associationId).toBe(associationA)
    expect(second.associationId).toBe(associationB)
    expect(first.associationId).not.toBe(second.associationId)
  })

  /**
   * An actor no board holds. The subquery yields NULL, `association_id` is
   * `not null`, and the insert is refused — so the write fails loudly rather
   * than recording a query against nobody, and the executor never runs the
   * SELECT because it never gets a provenance id.
   */
  it('refuses to record a query for an actor that does not exist', async () => {
    const absent = '00000000-0000-7000-8000-0000000000ff'

    // The SQLSTATE, not a bare `rejects.toThrow()`. `23502` is not-null
    // violation — the subquery found no board member, so `association_id` came
    // out NULL against a NOT NULL column, which is *why* this is refused. A
    // generic assertion passes just as happily if the table is missing, the
    // credential is wrong, or the column was renamed, so it would keep reporting
    // success long after it had stopped testing anything.
    await expect(log.record(entryFor(absent))).rejects.toMatchObject({ code: '23502' })

    const { rows } = await client.query('select id from query_log where actor_id = $1', [absent])

    expect(rows).toHaveLength(0)
  })
})
