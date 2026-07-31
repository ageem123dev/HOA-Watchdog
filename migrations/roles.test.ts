/**
 * AD-4 — roles separate by pipeline stage, not by service.
 *
 * "Two database roles. `watchdog_writer` may INSERT/UPDATE and is used *only* by
 * the ingestion pipeline. `watchdog_reader` is SELECT-only and is the *only* role
 * any catalog query executes under. Neither role may be granted the other's
 * capability."
 *
 * This is the proof. It connects as each role and exercises the boundary against
 * a real database, because a grant is the kind of thing that is easy to write
 * correctly once and widen accidentally later — `GRANT ALL` in a future migration
 * would satisfy every unit test in this repository and quietly hand the
 * LLM-driven query path the ability to mutate an association's financial records.
 *
 * **These tests require a database and skip without one.** That is a deliberate
 * trade: the suite stays runnable for a contributor with no credentials, and the
 * skip is loud rather than silent — `npm test` prints the reason. They must run
 * before any change to `migrations/002_roles.sql` is considered reviewed.
 */

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured
  ? describe
  : describe.skip.bind(null) as unknown as typeof describe

if (!configured) {
  console.warn(
    '\n  AD-4 role-separation tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL are not set.\n' +
      '  Run `node --env-file=.env.local scripts/migrate.mjs`, then ' +
      '`npm run test:db`.\n',
  )
}

describeWithDatabase('AD-4: the two database roles', () => {
  let writer: Client
  let reader: Client

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    reader = new Client({ connectionString: readerUrl })
    await Promise.all([writer.connect(), reader.connect()])
  })

  afterAll(async () => {
    await Promise.all([writer?.end(), reader?.end()].filter(Boolean))
  })

  it('connects as the role each URL names, not as a shared superuser', async () => {
    const [w, r] = await Promise.all([
      writer.query('select current_user'),
      reader.query('select current_user'),
    ])

    expect(w.rows[0].current_user).toBe('watchdog_writer')
    expect(r.rows[0].current_user).toBe('watchdog_reader')
  })

  it('neither role is a superuser, which would make every grant below decorative', async () => {
    const { rows } = await writer.query(
      "select rolname, rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname like 'watchdog%'",
    )

    expect(rows).toHaveLength(2)
    for (const role of rows) {
      expect(role.rolsuper, `${role.rolname} is a superuser`).toBe(false)
      expect(role.rolcreatedb, `${role.rolname} can create databases`).toBe(false)
      expect(role.rolcreaterole, `${role.rolname} can create roles`).toBe(false)
    }
  })

  describe('watchdog_reader', () => {
    it('can read', async () => {
      await expect(reader.query('select count(*) from board_member')).resolves.toBeDefined()
    })

    /**
     * The acceptance criterion, stated as plainly as it can be: the role the
     * LLM-driven query path runs under cannot write.
     */
    it('cannot INSERT', async () => {
      await expect(
        reader.query(
          "insert into board_member (email, password_hash) values ('intruder@example.com', 'scrypt$1$1$1$x$y')",
        ),
      ).rejects.toThrow(/permission denied/i)
    })

    it('cannot UPDATE', async () => {
      await expect(reader.query("update board_member set display_name = 'changed'")).rejects.toThrow(
        /permission denied/i,
      )
    })

    it('cannot DELETE', async () => {
      await expect(reader.query('delete from board_member')).rejects.toThrow(/permission denied/i)
    })

    it('cannot TRUNCATE', async () => {
      await expect(reader.query('truncate board_member')).rejects.toThrow(/permission denied/i)
    })

    it('cannot create a table to write into instead', async () => {
      await expect(reader.query('create table smuggled (id int)')).rejects.toThrow(
        /permission denied/i,
      )
    })

    it('holds no write privilege on any table, present or future', async () => {
      const { rows } = await reader.query(
        `select table_name, privilege_type
           from information_schema.table_privileges
          where grantee = 'watchdog_reader'
            and privilege_type <> 'SELECT'`,
      )

      expect(rows).toEqual([])
    })
  })

  describe('watchdog_writer', () => {
    const email = 'role-separation-probe@example.invalid'

    afterAll(async () => {
      await writer.query('delete from board_member where email = $1', [email])
    })

    it('can INSERT, UPDATE and DELETE, because ingestion must', async () => {
      await writer.query(
        'insert into board_member (email, password_hash) values ($1, $2) on conflict (email) do nothing',
        [email, 'scrypt$131072$8$1$c2FsdA$aGFzaA'],
      )
      await writer.query('update board_member set display_name = $1 where email = $2', [
        'probe',
        email,
      ])

      const { rows } = await writer.query('select display_name from board_member where email = $1', [
        email,
      ])
      expect(rows[0].display_name).toBe('probe')

      await writer.query('delete from board_member where email = $1', [email])
    })
  })

  describe('the schema constraints hold against a real database', () => {
    it('rejects a mixed-case email, which would never match a lower-cased lookup', async () => {
      await expect(
        writer.query('insert into board_member (email, password_hash) values ($1, $2)', [
          'MixedCase@example.invalid',
          'scrypt$131072$8$1$c2FsdA$aGFzaA',
        ]),
      ).rejects.toThrow(/board_member_email_is_lowercase/)
    })

    it('rejects a password hash that is not in the format this system writes', async () => {
      await expect(
        writer.query('insert into board_member (email, password_hash) values ($1, $2)', [
          'bcrypt-user@example.invalid',
          '$2b$12$abcdefghijklmnopqrstuv',
        ]),
      ).rejects.toThrow(/board_member_password_hash_format/)
    })

    it('issues uuid v7 identifiers, so rows sort by creation time', async () => {
      const { rows } = await writer.query('select uuidv7() as id')
      const version = rows[0].id.split('-')[2]?.[0]

      expect(version).toBe('7')
    })
  })
})
