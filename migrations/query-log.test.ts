/**
 * Migration 020: the provenance record every catalog execution writes.
 *
 * AD-12 — "Each catalog execution appends an immutable record — user id,
 * timestamp, catalog entry id and version, bound parameter values, and the exact
 * SQL text executed — *before* the result is returned to the caller. The log is
 * append-only; no application role may UPDATE or DELETE it."
 *
 * Two properties are under test here and they fail in different ways.
 *
 * **The row has to mean something.** A log line carrying a blank `sql_text`, a
 * `parameters` value that is a JSON array, or an `actor_id` matching no director
 * is worse than a missing line: it makes the audit trail look complete while
 * answering nothing. Every one of those is a check constraint, and every one has
 * a test that forces it.
 *
 * **Append-only has to be a grant, not a habit.** Migration 002's default
 * privileges hand `watchdog_writer` UPDATE and DELETE on every table created
 * after it, so this table arrives writable unless migration 020 takes those away
 * again. That is the failure mode worth naming out loud: the table would look
 * exactly right, the application would never issue an UPDATE, and the property
 * would hold only for as long as nobody wrote one.
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
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  query log migration tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL must both be set.\n',
  )
}

const CHECK_VIOLATION = '23514'
const FOREIGN_KEY_VIOLATION = '23503'
const INSUFFICIENT_PRIVILEGE = '42501'
const NOT_NULL_VIOLATION = '23502'

/**
 * Every row this file writes carries this in its `entry_id`.
 *
 * Lower-case letters and digits only, because `query_log_entry_id_shaped` holds
 * catalog ids to the `verb_noun` convention and a prefix of raw hex starting
 * with a digit would be rejected by the very constraint under test.
 *
 * Cleanup runs as the **owner**, not as `watchdog_writer`, and cannot be done
 * any other way: the writer's inability to DELETE from this table is the point
 * of the migration. If `DATABASE_URL` is absent the prefixed rows simply remain,
 * which is what append-only means.
 */
const RUN_PREFIX = `q${randomBytes(4).toString('hex')}`

const MIGRATION = readFileSync(join(__dirname, '020_query_log.sql'), 'utf8')

describe('the migration says what it does', () => {
  const sql = executable(MIGRATION)

  /**
   * The control for the comment stripping, and it has to be a phrase that really
   * is in the prose and really is not in the SQL — a control asserting the
   * absence of something that was never present holds with the stripping
   * deleted, which is how `unit-directory-connection.test.ts` shipped one that
   * proved nothing.
   */
  it('strips the prose before any of the assertions below read it', () => {
    expect(MIGRATION).toContain('append-only is a grant, not a habit')
    expect(sql).not.toContain('append-only is a grant, not a habit')
  })

  it('creates the query_log table', () => {
    expect(sql).toMatch(/create\s+table\s+query_log\s*\(/i)
  })

  it('takes UPDATE, DELETE and TRUNCATE away from the writer', () => {
    expect(sql).toMatch(/revoke\s+update,\s*delete,\s*truncate\s+on\s+query_log\s+from\s+watchdog_writer/i)
  })

  it('takes them away from PUBLIC too', () => {
    expect(sql).toMatch(/revoke\s+update,\s*delete,\s*truncate\s+on\s+query_log\s+from\s+public/i)
  })

  /**
   * The reader is granted nothing, and silence is how that is expressed — so the
   * assertion is over the absence of a grant rather than the presence of a
   * revoke. Migration 003 already removed the reader's blanket SELECT and its
   * default privilege, which is what makes silence sufficient here.
   */
  it('grants the reader nothing', () => {
    expect(sql).not.toMatch(/grant[^;]*\bto\s+watchdog_reader/i)
  })
})

describeWithDatabase('the provenance record', () => {
  let writer: Client
  let reader: Client
  let owner: Client | null = null
  let actorId = ''

  let counter = 0
  /** A fresh, convention-shaped catalog id per row, so no two tests collide. */
  const anEntryId = () => `${RUN_PREFIX}_entry_${(counter += 1)}`

  const record = (overrides: Record<string, unknown> = {}) => {
    const row = {
      actor_id: actorId,
      entry_id: anEntryId(),
      entry_version: 1,
      parameters: JSON.stringify({ unitNumber: '4B', assessmentYear: 2026 }),
      sql_text: 'select 1',
      ...overrides,
    }

    return writer.query(
      `insert into query_log (actor_id, entry_id, entry_version, parameters, sql_text)
       values ($1, $2, $3, $4, $5)
       returning id, executed_at, entry_id, entry_version, parameters, sql_text`,
      [row.actor_id, row.entry_id, row.entry_version, row.parameters, row.sql_text],
    )
  }

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    reader = new Client({ connectionString: readerUrl })
    await Promise.all([writer.connect(), reader.connect()])

    if (adminUrl) {
      owner = new Client({ connectionString: adminUrl })
      await owner.connect()
    }

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash)
       values ($1, 'scrypt$1$1$1$x$y')
       returning id`,
      [`${RUN_PREFIX}@example.com`],
    )
    actorId = rows[0]!.id
  })

  afterAll(async () => {
    if (owner) {
      await owner.query('delete from query_log where entry_id like $1', [`${RUN_PREFIX}%`])
      await owner.query('delete from board_member where email like $1', [`${RUN_PREFIX}%`])
      await owner.end()
    }
    await Promise.all([writer?.end(), reader?.end()])
  })

  describe('a well-formed record', () => {
    it('is written, and every field comes back as it went in', async () => {
      const entryId = anEntryId()
      const { rows } = await record({
        entry_id: entryId,
        entry_version: 3,
        sql_text: 'select unit_number from unit where id = $1',
      })

      expect(rows).toHaveLength(1)
      expect(rows[0]!.entry_id).toBe(entryId)
      expect(rows[0]!.entry_version).toBe(3)
      expect(rows[0]!.sql_text).toBe('select unit_number from unit where id = $1')
    })

    /**
     * The reverse-it test. `parameters` exists to be read back and compared
     * against what the entry declared, so writing it and reading it must be
     * lossless — a `text` column would pass every assertion above and turn
     * `{"assessmentYear": 2026}` into a string nobody can query by key.
     */
    it('round-trips the bound parameters as an object, not as text', async () => {
      const { rows } = await record({
        parameters: JSON.stringify({ unitNumber: '4B', assessmentYear: 2026 }),
      })

      expect(rows[0]!.parameters).toEqual({ unitNumber: '4B', assessmentYear: 2026 })
    })

    it('stamps its own id and time so a caller cannot forge either', async () => {
      const before = new Date()
      const { rows } = await record()

      expect(rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(rows[0]!.executed_at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 5_000)
    })
  })

  describe('a record that would not identify anything', () => {
    it('refuses a blank entry id', async () => {
      await expect(record({ entry_id: '   ' })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'query_log_entry_id_shaped',
      })
    })

    it('refuses an entry id that is not a catalog id', async () => {
      await expect(record({ entry_id: 'Dues Status; drop table unit' })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'query_log_entry_id_shaped',
      })
    })

    it('refuses version zero', async () => {
      await expect(record({ entry_version: 0 })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'query_log_version_positive',
      })
    })

    it('refuses a negative version', async () => {
      await expect(record({ entry_version: -1 })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'query_log_version_positive',
      })
    })

    it('refuses blank SQL text', async () => {
      await expect(record({ sql_text: ' \t\n ' })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'query_log_sql_text_present',
      })
    })

    it('refuses missing SQL text', async () => {
      await expect(record({ sql_text: null })).rejects.toMatchObject({
        code: NOT_NULL_VIOLATION,
      })
    })

    /**
     * `parameters` is the bound parameter *set*, so it is an object or it is
     * nothing. A bare `jsonb` column accepts `[1,2]`, `"4B"` and `null` — three
     * shapes no reader of this table could interpret, and all three are what a
     * caller passing the wrong variable would produce.
     */
    it.each([
      ['an array', '[1, 2]'],
      ['a string', '"4B"'],
      ['a number', '2026'],
      ['a JSON null', 'null'],
    ])('refuses parameters that are %s', async (_shape, value) => {
      await expect(record({ parameters: value })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'query_log_parameters_are_an_object',
      })
    })

    it('refuses an actor who is not a board member', async () => {
      await expect(
        record({ actor_id: '00000000-0000-7000-8000-000000000000' }),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION })
    })
  })

  /**
   * AD-12's second sentence, proved rather than asserted.
   *
   * `migrations/002_roles.sql` grants the writer SELECT, INSERT, UPDATE and
   * DELETE on every table that exists and, through `alter default privileges`,
   * on every table created afterwards. Without migration 020's revoke this
   * describe block fails entirely — which is the whole reason it is here.
   */
  describe('append-only, enforced by the grant', () => {
    it('lets the writer append', async () => {
      await expect(record()).resolves.toBeDefined()
    })

    /**
     * **Scoped to this run's rows, and that is not a stylistic preference.**
     *
     * Postgres checks the privilege before it matches any row, so `where
     * entry_id like $1` costs this assertion nothing: a writer holding UPDATE
     * is refused identically either way. What the clause buys is the failure
     * case. This test exists precisely for the day the revoke is missing — that
     * is the state it was first observed failing in — and an unqualified
     * `update query_log set sql_text = 'select 2'` would, on that day, rewrite
     * every row of a real association's audit trail before reporting the
     * problem. A test guarding an append-only log has no business being the
     * thing that destroys it.
     */
    it('will not let the writer UPDATE a record', async () => {
      await expect(
        writer.query("update query_log set sql_text = 'select 2' where entry_id like $1", [
          `${RUN_PREFIX}%`,
        ]),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
    })

    it('will not let the writer DELETE a record', async () => {
      await expect(
        writer.query('delete from query_log where entry_id like $1', [`${RUN_PREFIX}%`]),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
    })

    /**
     * TRUNCATE and the column-level grants are asserted from the catalog rather
     * than by running the statement, for two different reasons.
     *
     * TRUNCATE takes no `WHERE`, so there is no scoped version of it — running
     * it to prove it fails means wiping the table on the run where it does not.
     * The privilege set is the same proof without the loaded gun.
     *
     * Column-level grants do not appear in `table_privileges` at all; they live
     * in `column_privileges`, and `roles.test.ts` records a live
     * `GRANT UPDATE (note)` that a table-level assertion reported as clean. So
     * both catalogs are asserted, and both as an exact set — a subset check
     * would pass against a table that had picked up UPDATE.
     */
    it('holds no privilege beyond INSERT and SELECT, at table or column level', async () => {
      // `distinct` on both, matching each other: a privilege granted by more
      // than one grantor appears once per grantor, and the exact-array
      // assertions below would then fail for a reason that has nothing to do
      // with what the writer can actually do.
      const { rows: table } = await writer.query<{ privilege_type: string }>(
        `select distinct privilege_type
           from information_schema.table_privileges
          where grantee = 'watchdog_writer'
            and table_schema = 'public'
            and table_name = 'query_log'
          order by privilege_type`,
      )
      const { rows: column } = await writer.query<{ privilege_type: string }>(
        `select distinct privilege_type
           from information_schema.column_privileges
          where grantee = 'watchdog_writer'
            and table_schema = 'public'
            and table_name = 'query_log'
          order by privilege_type`,
      )

      expect(table.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT'])
      expect(column.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT'])
    })
  })

  /**
   * The reader is the role the LLM-driven query path executes under, and it has
   * no business reading the audit trail of its own queries — the argument
   * migration 003 made for `board_member`. Story 3.8 surfaces this table through
   * the gateway, which holds the writer credential.
   */
  describe('the reader cannot see the log at all', () => {
    it('cannot SELECT from it', async () => {
      await expect(reader.query('select count(*) from query_log')).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      })
    })

    /**
     * The forged entry id carries `RUN_PREFIX` like every other row this file
     * writes. It should never be written at all — but the run where this
     * assertion fails is exactly the run where a row lands, and a hardcoded id
     * would be the one row `afterAll` could not find to clean up.
     */
    it('cannot append to it either', async () => {
      await expect(
        reader.query(
          `insert into query_log (actor_id, entry_id, entry_version, parameters, sql_text)
           values ($1, $2, 1, '{}'::jsonb, 'select 1')`,
          [actorId, anEntryId()],
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
    })

    it('holds no privilege of any kind on the table', async () => {
      const { rows } = await writer.query(
        `select privilege_type
           from information_schema.table_privileges
          where grantee = 'watchdog_reader'
            and table_schema = 'public'
            and table_name = 'query_log'`,
      )

      expect(rows).toEqual([])
    })
  })
})
