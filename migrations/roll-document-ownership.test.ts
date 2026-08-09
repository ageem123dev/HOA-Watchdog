/**
 * Migration 019: which document wrote a tenure.
 *
 * Two assertions carry this file, and the second is the one the story exists for.
 *
 * The first is ordinary: `unit_holder` and `unit_membership` gain a
 * `document_id` cascading from `document`, so re-applying a roll can replace its
 * own rows rather than duplicate them.
 *
 * The second is an **absence**. `unit` and `assessment` must NOT gain one. Three
 * tables reference `unit (id)` with no `on delete` action, so a cascade from
 * `document` to `unit` would make deleting a roll erase every payment ever
 * recorded against its units — in a product whose job is checking the ledger.
 * An absence cannot be asserted by reading a column, so it is asserted twice:
 * against the migration text, and against the live database by deleting a roll
 * document and finding the payments still there.
 */

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { executable } from './executable-sql'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const configured = Boolean(writerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  roll document ownership migration tests SKIPPED: ' +
      'WATCHDOG_WRITER_DATABASE_URL must be set.\n',
  )
}

/** Several files already write to `unit`; see the note in `unit.test.ts`. */
const RUN_PREFIX = `r${randomBytes(4).toString('hex')}`

const MIGRATION = readFileSync(join(__dirname, '019_roll_document_ownership.sql'), 'utf8')

describe('the migration says what it does', () => {
  it('adds the column to both tenure tables', () => {
    const sql = executable(MIGRATION)

    expect(sql).toMatch(/alter\s+table\s+unit_holder\s+add\s+column\s+document_id/i)
    expect(sql).toMatch(/alter\s+table\s+unit_membership\s+add\s+column\s+document_id/i)
  })

  it('cascades from the document, as payment and held_payment do', () => {
    const sql = executable(MIGRATION)
    const cascades = sql.match(/references\s+document\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/gi)

    expect(cascades).toHaveLength(2)
  })

  it('never gives unit or assessment a document, which is the whole hazard', () => {
    // Asserted against the executable text so a comment cannot satisfy it. A
    // cascade reaching `unit` would let deleting a roll erase the payments
    // recorded against its units, because payment.unit_id has no on-delete
    // action and would be taken with the parent row.
    const sql = executable(MIGRATION)

    expect(sql).not.toMatch(/alter\s+table\s+unit\s+add/i)
    expect(sql).not.toMatch(/alter\s+table\s+assessment\s+add/i)
  })

  it('leaves the column nullable, since rows written before it have no document', () => {
    expect(executable(MIGRATION)).not.toMatch(/add\s+column\s+document_id[^;]*not\s+null/i)
  })

  it('indexes what the re-apply path looks up', () => {
    const sql = executable(MIGRATION)

    expect(sql).toMatch(/create\s+index\s+\w+\s+on\s+unit_holder\s*\(\s*document_id\s*\)/i)
    expect(sql).toMatch(/create\s+index\s+\w+\s+on\s+unit_membership\s*\(\s*document_id\s*\)/i)
  })

  it('is not satisfied by its own prose', () => {
    // The control. `executable` strips comments, so if it did not, every
    // assertion above could be met by the docblock rather than by SQL.
    expect(MIGRATION).toMatch(/-- Which document wrote a tenure/)
    expect(executable(MIGRATION)).not.toMatch(/Which document wrote a tenure/)
  })
})

describeWithDatabase('against the live schema', () => {
  let client: Client

  /**
   * Unique per call, not merely per file.
   *
   * `seed()` runs once per test and writes a board member and a unit, both of
   * which carry unique constraints — a suffix fixed for the file makes the
   * second test in it collide with the first.
   */
  let seedCount = 0
  const uniq = (label: string) => `${RUN_PREFIX}-${seedCount}-${label}`

  beforeAll(async () => {
    client = new Client({ connectionString: writerUrl })
    await client.connect()
  })

  afterAll(async () => {
    // Ordered children-first, and the order is not incidental: the first draft
    // deleted units directly and failed with 23503, because `unit_membership`,
    // `assessment` and `payment` all reference `unit (id)` with no on-delete
    // action. That failure is the very guarantee this migration protects, met in
    // the teardown — a unit cannot be swept away while anything still refers to
    // it, which is exactly why `unit` has no document to cascade from.
    const units = `select id from unit where unit_number like $1`

    // Documents first: this cascade takes payments, memberships and holders with
    // them, which is what the schema is for.
    await client.query(
      `delete from document
        where uploaded_by in (select id from board_member where email like $1)`,
      [`${RUN_PREFIX}%`],
    )
    await client.query(`delete from assessment where unit_id in (${units})`, [`${RUN_PREFIX}%`])
    await client.query(`delete from unit_membership where unit_id in (${units})`, [`${RUN_PREFIX}%`])
    await client.query(`delete from unit_holder where full_name like $1`, [`${RUN_PREFIX}%`])
    await client.query(`delete from unit where unit_number like $1`, [`${RUN_PREFIX}%`])
    await client.query(`delete from board_member where email like $1`, [`${RUN_PREFIX}%`])
    await client.end()
  })

  /** A document, its unit, that unit's holder, tenure, assessment and a payment. */
  async function seed() {
    // A real sha256 shape: `document_content_hash_is_sha256` checks it, and the
    // storage key is derived from it exactly as `storageKeyFor` derives it.
    seedCount += 1
    const contentHash = randomBytes(32).toString('hex')

    const member = await client.query<{ id: string }>(
      `insert into board_member (email, password_hash)
       values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA') returning id`,
      [`${uniq('member')}@example.test`],
    )
    const uploadedBy = member.rows[0]!.id

    const document = await client.query<{ id: string }>(
      `insert into document
         (content_hash, storage_key, filename, content_type, byte_size, uploaded_by)
       values ($1, $2, 'roll.csv', 'text/csv', 10, $3) returning id`,
      [contentHash, `documents/${contentHash}`, uploadedBy],
    )
    const documentId = document.rows[0]!.id

    const unit = await client.query<{ id: string }>(
      'insert into unit (unit_number) values ($1) returning id',
      [uniq('4B')],
    )
    const unitId = unit.rows[0]!.id

    const holder = await client.query<{ id: string }>(
      'insert into unit_holder (full_name, document_id) values ($1, $2) returning id',
      [`${RUN_PREFIX} Jane Smith`, documentId],
    )

    await client.query(
      `insert into unit_membership (unit_id, holder_id, held_during, document_id)
       values ($1, $2, daterange($3::date, null), $4)`,
      [unitId, holder.rows[0]!.id, '2019-03-01', documentId],
    )

    await client.query(
      `insert into assessment (unit_id, assessment_year, annual_amount, billing_cycle)
       values ($1, 2026, '3600.00', 'monthly')`,
      [unitId],
    )

    await client.query(
      `insert into payment (unit_id, document_id, paid_on, amount)
       values ($1, $2, '2026-03-01'::date, '300.00')`,
      [unitId, documentId],
    )

    return { documentId, unitId }
  }

  const countIn = async (table: string, column: string, id: string): Promise<number> => {
    const result = await client.query<{ n: string }>(
      `select count(*)::text as n from ${table} where ${column} = $1`,
      [id],
    )
    return Number(result.rows[0]!.n)
  }

  it('accepts a tenure tagged with the document that wrote it', async () => {
    const { documentId } = await seed()

    expect(await countIn('unit_membership', 'document_id', documentId)).toBe(1)
    expect(await countIn('unit_holder', 'document_id', documentId)).toBe(1)
  })

  it('still accepts a tenure with no document, as rows written before it have', async () => {
    const { unitId } = await seed()

    const holder = await client.query<{ id: string }>(
      'insert into unit_holder (full_name) values ($1) returning id',
      [`${RUN_PREFIX} Nobody In Particular`],
    )

    // A different unit, so the exclusion constraint is not what is under test.
    const other = await client.query<{ id: string }>(
      'insert into unit (unit_number) values ($1) returning id',
      [uniq('9Z')],
    )

    await client.query(
      `insert into unit_membership (unit_id, holder_id, held_during)
       values ($1, $2, daterange('2020-01-01'::date, null))`,
      [other.rows[0]!.id, holder.rows[0]!.id],
    )

    // Read back rather than asserting the insert resolved. `resolves.toBeDefined()`
    // holds for any query that did not throw, so it would pass with the column
    // dropped entirely — and the point here is that a null is *stored*. Raised
    // by review.
    const { rows } = await client.query<{ document_id: string | null }>(
      'select document_id from unit_membership where unit_id = $1',
      [other.rows[0]!.id],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.document_id).toBeNull()
    expect(unitId).toBeTruthy()
  })

  it('takes the tenures with the document, and leaves the unit and its money', async () => {
    // The assertion this migration exists for. Deleting a roll must remove what
    // the roll said about who holds a unit, and must not touch the unit, the
    // assessment, or a payment recorded against it.
    const { documentId, unitId } = await seed()

    await client.query('delete from document where id = $1', [documentId])

    expect(await countIn('unit_membership', 'document_id', documentId)).toBe(0)
    expect(await countIn('unit_holder', 'document_id', documentId)).toBe(0)

    expect(await countIn('unit', 'id', unitId)).toBe(1)
    expect(await countIn('assessment', 'unit_id', unitId)).toBe(1)
  })

  it('refuses to delete a unit that still carries a payment', async () => {
    // The other half of the same guarantee, and the reason `unit` has no
    // document column. If anything ever gives it one with a cascade, deleting a
    // roll would reach this delete — and it must remain a loud refusal rather
    // than becoming a silent erasure.
    const { unitId } = await seed()

    await expect(client.query('delete from unit where id = $1', [unitId])).rejects.toMatchObject({
      code: '23503',
    })
  })
})
