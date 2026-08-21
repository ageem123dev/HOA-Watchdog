/**
 * The user directory against a real database.
 *
 * The one thing a fake cannot answer for: whether the SELECT actually asks for
 * the columns the port promises. `UserRow` is a hand-written interface over
 * whatever `pg` returns, and `pg` returns only the columns the query named — so
 * a field left out of the SELECT list arrives as `undefined` while TypeScript
 * goes on believing it is a `string`. That is the failure mode this file exists
 * for, and it is invisible to every test that supplies its own rows.
 *
 * **Requires a database and skips without one**, matching `adapters/db/`. Note
 * that `test:db` must name `adapters/auth/` for this to run at all — nothing
 * else does.
 */

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPostgresUserDirectory } from './user-directory-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const configured = Boolean(writerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  user-directory tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL is not set.\n' +
      '  Run `npm run migrate`, then `npm run test:db`.\n',
  )
}

/** Scopes every row this file writes, so two runs cannot delete each other's. */
const RUN_PREFIX = `u${randomBytes(4).toString('hex')}`

const emailFor = (label: string) => `${RUN_PREFIX}-${label}@association.example`

describeWithDatabase('the Postgres user directory', () => {
  const client = new Client({ connectionString: writerUrl })
  const directory = createPostgresUserDirectory()

  /** Filled in `beforeAll`; the association each seeded member belongs to. */
  let associationA = ''
  let associationB = ''

  beforeAll(async () => {
    await client.connect()

    const insertAssociation = async (label: string) => {
      const { rows } = await client.query<{ id: string }>(
        'insert into association (name) values ($1) returning id',
        [`${RUN_PREFIX}-${label}`],
      )
      return rows[0]!.id
    }

    associationA = await insertAssociation('a')
    associationB = await insertAssociation('b')

    await client.query(
      `insert into board_member (email, password_hash, display_name, association_id)
            values ($1, $2, $3, $4), ($5, $6, $7, $8)`,
      [
        emailFor('ada'),
        'scrypt$1$1$1$AAAA$AAAA',
        'Ada',
        associationA,
        emailFor('bo'),
        'scrypt$1$1$1$BBBB$BBBB',
        'Bo',
        associationB,
      ],
    )
  })

  afterAll(async () => {
    await client.query('delete from board_member where email like $1', [`${RUN_PREFIX}-%`])
    await client.query('delete from association where name like $1', [`${RUN_PREFIX}-%`])
    await client.end()
  })

  it('returns the member the address belongs to', async () => {
    const found = await directory.findByEmail(emailFor('ada'))

    expect(found?.email).toBe(emailFor('ada'))
    expect(found?.passwordHash).toBe('scrypt$1$1$1$AAAA$AAAA')
    expect(found?.disabledAt).toBeNull()
  })

  /**
   * The value, not merely the presence of the key. `expect(found?.associationId)
   * .toBeDefined()` would pass against a SELECT that returned some *other*
   * association, which is the failure that matters.
   */
  it('returns the association the member belongs to', async () => {
    const found = await directory.findByEmail(emailFor('ada'))

    expect(found?.associationId).toBe(associationA)
  })

  /**
   * Cross-check: the same fact by an independent path. If the adapter aliased
   * the wrong column, or the seed did not land where this file thinks it did,
   * the two answers stop agreeing.
   */
  it('agrees with a direct read of the row', async () => {
    const found = await directory.findByEmail(emailFor('ada'))

    const { rows } = await client.query<{ association_id: string }>(
      'select association_id from board_member where email = $1',
      [emailFor('ada')],
    )

    expect(found?.associationId).toBe(rows[0]!.association_id)
  })

  /**
   * Zero-one-many. Two members exist and they belong to *different*
   * associations, so a query that lost its `where email = $1` — or one that
   * resolved the association through something other than this member's own row
   * — answers with the wrong one rather than with nothing.
   */
  it('keeps two members in two associations apart', async () => {
    const ada = await directory.findByEmail(emailFor('ada'))
    const bo = await directory.findByEmail(emailFor('bo'))

    expect(ada?.associationId).toBe(associationA)
    expect(bo?.associationId).toBe(associationB)
    expect(ada?.associationId).not.toBe(bo?.associationId)
  })

  it('answers with nothing for an address no member holds', async () => {
    expect(await directory.findByEmail(emailFor('nobody'))).toBeNull()
  })
})
