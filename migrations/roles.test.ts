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
    /**
     * The reader's read surface is deliberately narrow and currently almost
     * empty: migration 003 removed its blanket default grant, so it reads only
     * tables it has been granted explicitly. The ledger tables arrive with story
     * 1.4 and are granted then. This asserts the role can connect and query at
     * all — without it, every "cannot write" assertion below would also pass for
     * a role that simply cannot reach the database.
     */
    it('can connect and read what it has been granted', async () => {
      await expect(reader.query('select count(*) from schema_migration')).resolves.toBeDefined()
    })

    /**
     * The acceptance criterion, stated as plainly as it can be: the role the
     * LLM-driven query path runs under cannot write.
     */
    it('cannot INSERT', async () => {
      await expect(
        reader.query(
          "insert into board_member (email, password_hash, association_id) values ('intruder@example.com', 'scrypt$1$1$1$x$y', '00000000-0000-7000-8000-000000000001')",
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

    it('holds no table-level write privilege', async () => {
      const { rows } = await reader.query(
        `select table_name, privilege_type
           from information_schema.table_privileges
          where grantee = 'watchdog_reader'
            and privilege_type <> 'SELECT'`,
      )

      expect(rows).toEqual([])
    })

    /**
     * Column-level grants do not appear in `table_privileges` at all — they live
     * in `column_privileges`. Review demonstrated a live
     * `GRANT UPDATE (note) ON … TO watchdog_reader` that the table-level
     * assertion above reported as clean while the reader really could write.
     * A `GRANT UPDATE (password_hash) ON board_member` would have been invisible
     * the same way.
     */
    it('holds no column-level write privilege either', async () => {
      const { rows } = await reader.query(
        `select table_name, column_name, privilege_type
           from information_schema.column_privileges
          where grantee = 'watchdog_reader'
            and privilege_type <> 'SELECT'`,
      )

      expect(rows).toEqual([])
    })

    /**
     * Future-table grants live in `pg_default_acl`, which neither privilege view
     * reflects. Without this, "present or future" was an unearned claim.
     */
    it('is granted nothing by default on tables added later', async () => {
      const { rows } = await reader.query(
        `select defaclobjtype, defaclacl::text
           from pg_default_acl
          where array_to_string(defaclacl, ',') like '%watchdog_reader%'`,
      )

      expect(rows).toEqual([])
    })

    /**
     * TEMPORARY is granted to PUBLIC by default, and `pg_temp` precedes `public`
     * in unqualified name resolution — so the reader could create a temp table
     * named after a real one, fill it with forged figures, and have every later
     * unqualified query on that pooled connection read the forgery. Nothing is
     * persisted, so nothing is detectable afterwards.
     */
    it('cannot create a temporary table to shadow a real one', async () => {
      await expect(reader.query('create temp table board_member (id uuid)')).rejects.toThrow(
        /permission denied/i,
      )
    })

    /**
     * The catalog path reasons over ledger data. It has no business with the
     * credential table, and a prompt injection that induces it to read one is a
     * roster of scrypt hashes leaving the system in a chat response.
     */
    it('cannot read the credential table at all', async () => {
      await expect(reader.query('select password_hash from board_member')).rejects.toThrow(
        /permission denied/i,
      )
    })
  })

  describe('watchdog_writer', () => {
    const email = 'role-separation-probe@example.invalid'

    afterAll(async () => {
      await writer.query('delete from board_member where email = $1', [email])
    })

    it('can INSERT, UPDATE and DELETE, because ingestion must', async () => {
      await writer.query(
        'insert into board_member (email, password_hash, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\') on conflict (email) do nothing',
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
        writer.query('insert into board_member (email, password_hash, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')', [
          'MixedCase@example.invalid',
          'scrypt$131072$8$1$c2FsdA$aGFzaA',
        ]),
      ).rejects.toThrow(/board_member_email_is_lowercase/)
    })

    it('rejects a password hash that is not in the format this system writes', async () => {
      await expect(
        writer.query('insert into board_member (email, password_hash, association_id) values ($1, $2, \'00000000-0000-7000-8000-000000000001\')', [
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
