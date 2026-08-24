/**
 * Adding a director to the inviting director's own association (story 5.9).
 *
 * ## Two halves, and only one of them runs here
 *
 * The text half always runs and is where the tenancy rule is pinned. The
 * database half skips without a connection, and none is configured on the
 * machine this project is currently built on — so a rule proven only there is
 * proven nowhere.
 *
 * The gate is `WATCHDOG_WRITER_DATABASE_URL` (the pool this adapter uses,
 * through `writerPool`) and `DATABASE_URL` (the admin connection the fixture
 * needs to create an association). Both are required because both are used;
 * story 5.8 had a review finding proposing otherwise, and following it would
 * have made the suite skip when it should run and fail on connect when it did.
 *
 * ## Why the writer pool for something that also reads
 *
 * Migration 003 revokes **all** on `board_member` from `watchdog_reader`,
 * deliberately: "the LLM-driven query path has no business with credentials".
 * There is no reader-pool version of this adapter to write.
 */

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { neutralise } from '@/core/ports/declared-members'

import { createDirectorRoster } from './director-roster-postgres'

const SOURCE = readFileSync(join(__dirname, 'director-roster-postgres.ts'), 'utf8')

/** Comments blanked by the shared `neutralise`: this file's prose states every rule it asserts. */
const code = neutralise(SOURCE).commentsBlanked

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const adminUrl = process.env.DATABASE_URL
const configured = Boolean(writerUrl && adminUrl)
const describeWithDatabase = configured ? describe : describe.skip

describe('the association is the inviting director s own', () => {
  it('derives it from the inviting member in SQL rather than taking it as a parameter', () => {
    /**
     * The rule `document-repository-postgres.ts` states as "a caller cannot
     * supply the wrong one". Here it decides which board a new account can see —
     * a caller able to name an association could enrol somebody into a board
     * they have nothing to do with, and that account would then read that
     * board's financial records.
     */
    expect(code).toContain('select association_id from board_member where id = $1')
  })

  it('never names an association id as a bound parameter', () => {
    // The failure this guards is a later edit adding one, not today's code.
    expect(code).not.toMatch(/associationId/)
  })

  it('uses the writer pool, because the reader may not read board_member at all', () => {
    // Migration 003. There is no reader-pool version of this to write.
    expect(code).toContain('writerPool()')
    expect(code).not.toContain('readerPool')
  })
})

describe('a duplicate address is refused, not reset', () => {
  it('does nothing on conflict rather than overwriting the password hash', () => {
    /**
     * `scripts/add-board-member.mjs` does `on conflict (email) do update set
     * password_hash = excluded.password_hash` — a password reset in the shape of
     * an insert. That is defensible in a script somebody runs deliberately; in a
     * form it is how a director "adds" a colleague who is already on the board
     * and silently invalidates their password.
     *
     * `do nothing` is the whole of AC4, and it is one word away from the
     * dangerous version.
     */
    expect(code).toMatch(/on conflict[\s\S]{0,40}do nothing/i)
    expect(code).not.toMatch(/do update set/i)
  })

  it('lower-cases the address before storing it', () => {
    /**
     * Migration 001 has `board_member_email_is_lowercase`, so a mixed-case row
     * is refused by the database. Lower-casing here means the refusal is not how
     * we find out — and `authenticate` lower-cases at sign-in, so a row stored
     * any other way could never be matched.
     */
    expect(code).toMatch(/\.toLowerCase\(\)|lower\(\$2\)/)
  })
})

describe('the guard can actually fail', () => {
  it('is not passing because the blanker emptied the file', () => {
    // Several assertions above are absences.
    expect(code).toContain('export function createDirectorRoster')
    expect(code).toMatch(/insert into board_member/i)
  })
})

describeWithDatabase('against a real database', () => {
  const prefix = `a${randomBytes(4).toString('hex')}`
  let admin: Client
  let inviter: string
  let otherBoardInviter: string

  const hash = 'scrypt$fixture'

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl })
    await admin.connect()

    const board = async (label: string) => {
      const association = await admin.query<{ id: string }>(
        `insert into association (name) values ($1) returning id`,
        [`${prefix} ${label}`],
      )
      const row = await admin.query<{ id: string }>(
        `insert into board_member (email, password_hash, association_id) values ($1, $2, $3) returning id`,
        [`${prefix}-${label}@example.com`, hash, association.rows[0]!.id],
      )
      return row.rows[0]!.id
    }

    inviter = await board('inviter')
    otherBoardInviter = await board('other')
  })

  afterAll(async () => {
    if (!configured) return

    await admin.query(`delete from board_member where email like $1`, [`${prefix}%`])
    await admin.query(`delete from association where name like $1`, [`${prefix} %`])
    await admin.end()
  })

  const roster = () => createDirectorRoster()

  it('creates a director in the inviting director s association', async () => {
    const email = `${prefix}-added@example.com`

    const added = await roster().add(inviter, email, 'A Director', hash)

    expect(added).toBe(true)

    const found = await admin.query<{ association_id: string }>(
      `select association_id from board_member where email = $1`,
      [email],
    )
    const inviterAssociation = await admin.query<{ association_id: string }>(
      `select association_id from board_member where id = $1`,
      [inviter],
    )

    expect(found.rows[0]?.association_id).toBe(inviterAssociation.rows[0]!.association_id)
  })

  it('does not put the new director in another board s association', async () => {
    /**
     * The disaster case. Both inviters exist and belong to different
     * associations; a new director added by one must not land in the other's.
     */
    const email = `${prefix}-scoped@example.com`

    await roster().add(otherBoardInviter, email, null, hash)

    const found = await admin.query<{ association_id: string }>(
      `select association_id from board_member where email = $1`,
      [email],
    )
    const wrong = await admin.query<{ association_id: string }>(
      `select association_id from board_member where id = $1`,
      [inviter],
    )

    expect(found.rows[0]?.association_id).not.toBe(wrong.rows[0]!.association_id)
  })

  it('refuses an address already on the board without touching its password', async () => {
    const email = `${prefix}-twice@example.com`

    expect(await roster().add(inviter, email, null, hash)).toBe(true)
    expect(await roster().add(inviter, email, null, 'scrypt$different')).toBe(false)

    const found = await admin.query<{ password_hash: string }>(
      `select password_hash from board_member where email = $1`,
      [email],
    )

    // The original hash, untouched. A reset here locks the colleague out.
    expect(found.rows[0]?.password_hash).toBe(hash)
    expect(found.rowCount).toBe(1)
  })

  it('refuses an inviting member who does not exist', async () => {
    /**
     * The scalar subquery yields NULL, `association_id` is `not null`, and the
     * insert raises. That is the right outcome: a director row with no
     * association is invisible to every association-scoped read afterwards, so
     * creating one silently would be worse than failing.
     */
    const email = `${prefix}-ghost@example.com`

    await expect(roster().add('00000000-0000-0000-0000-000000000000', email, null, hash)).rejects.toThrow()

    /**
     * And nothing was written. `rejects.toThrow()` alone proves the call failed,
     * not that it failed *before* creating anything — and the whole point of the
     * refusal is that a director row with no association would be invisible to
     * every association-scoped read afterwards. If the not-null constraint were
     * ever relaxed, the throw would go and this assertion is what would notice.
     * Raised by ocr.
     */
    const found = await admin.query(`select id from board_member where email = $1`, [email])

    expect(found.rowCount).toBe(0)
  })
})
