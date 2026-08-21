/**
 * Migration 025: a unit number and a vendor name identify a row *within an
 * association*, not across the whole table.
 *
 * The assertion that matters is not "the index exists" — it is that a second
 * association can hold a unit "4B" while the first already does. Under
 * migration 011's global index that insert was refused outright, and the
 * `on conflict (normalised_number) do update` in `roll-repository-postgres.ts`
 * turned the refusal into something worse: importing the second board's roll
 * would resolve onto the *first* board's unit row and rename it, leaving one row
 * where two belong and every dues figure for both boards computed against it.
 *
 * Requires a database and skips without one.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATION = readFileSync(join(HERE, '025_association_scoped_identity.sql'), 'utf8')

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const configured = Boolean(writerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn('\n  scoped-identity tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL is not set.\n')
}

const RUN_PREFIX = `i${randomBytes(4).toString('hex')}`

describe('the migration says what it does', () => {
  it('creates the replacement index before dropping the one it replaces', () => {
    const created = MIGRATION.search(/create\s+unique\s+index[^;]*unit_association_normalised_number/i)
    const dropped = MIGRATION.search(/drop\s+index[^;]*unit_normalised_number_key/i)

    expect(created).toBeGreaterThan(-1)
    expect(dropped).toBeGreaterThan(-1)
    // Otherwise there is a window in which nothing enforces uniqueness at all.
    expect(created).toBeLessThan(dropped)
  })

  it('scopes both replacements by association', () => {
    expect(MIGRATION).toMatch(/on\s+unit\s*\(\s*association_id\s*,\s*normalised_number\s*\)/i)
    expect(MIGRATION).toMatch(/on\s+vendor\s*\(\s*association_id\s*,\s*normalised_name\s*\)/i)
  })
})

describeWithDatabase('the identity keys, against the live schema', () => {
  const client = new Client({ connectionString: writerUrl })

  let associationA = ''
  let associationB = ''

  beforeAll(async () => {
    await client.connect()

    const association = async (label: string) => {
      const { rows } = await client.query<{ id: string }>(
        'insert into association (name) values ($1) returning id',
        [`${RUN_PREFIX}-${label}`],
      )
      return rows[0]!.id
    }

    associationA = await association('a')
    associationB = await association('b')
  })

  afterAll(async () => {
    await client.query('delete from unit where unit_number like $1', [`${RUN_PREFIX}%`])
    await client.query('delete from vendor where display_name like $1', [`${RUN_PREFIX}%`])
    await client.query('delete from association where name like $1', [`${RUN_PREFIX}-%`])
    await client.end()
  })

  it('no longer holds a global unique index on either identity column', async () => {
    const { rows } = await client.query<{ indexname: string }>(
      `select indexname from pg_indexes
        where schemaname = 'public'
          and indexname in ('unit_normalised_number_key', 'vendor_normalised_name_key')`,
    )

    expect(rows.map((row) => row.indexname)).toEqual([])
  })

  it('holds a composite unique index on each instead', async () => {
    const { rows } = await client.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
        where schemaname = 'public'
          and indexname in ('unit_association_normalised_number_key',
                            'vendor_association_normalised_name_key')
        order by indexname`,
    )

    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.indexdef).toMatch(/UNIQUE/i)
      expect(row.indexdef).toMatch(/association_id/)
    }
  })

  /**
   * The behaviour the index change exists for. Under migration 011's global
   * index this second insert was refused with a `23505`.
   */
  it('lets two associations each hold the same unit number', async () => {
    const number = `${RUN_PREFIX}4B`

    await client.query('insert into unit (unit_number, association_id) values ($1, $2)', [
      number,
      associationA,
    ])
    await client.query('insert into unit (unit_number, association_id) values ($1, $2)', [
      number,
      associationB,
    ])

    const { rows } = await client.query<{ n: number }>(
      'select count(*)::int as n from unit where unit_number = $1',
      [number],
    )

    expect(rows[0]!.n).toBe(2)
  })

  it('lets two associations each hold the same vendor name', async () => {
    const name = `${RUN_PREFIX} Plumbing`

    await client.query('insert into vendor (display_name, association_id) values ($1, $2)', [
      name,
      associationA,
    ])
    await client.query('insert into vendor (display_name, association_id) values ($1, $2)', [
      name,
      associationB,
    ])

    const { rows } = await client.query<{ n: number }>(
      'select count(*)::int as n from vendor where display_name = $1',
      [name],
    )

    expect(rows[0]!.n).toBe(2)
  })

  /**
   * And the constraint still constrains. Dropping a unique index and replacing
   * it with a wider one is exactly the change that can silently enforce nothing,
   * so prove the narrowed key still refuses a genuine duplicate.
   */
  it('still refuses the same unit number twice within one association', async () => {
    const number = `${RUN_PREFIX}9Z`

    await client.query('insert into unit (unit_number, association_id) values ($1, $2)', [
      number,
      associationA,
    ])

    await expect(
      client.query('insert into unit (unit_number, association_id) values ($1, $2)', [
        number,
        associationA,
      ]),
    ).rejects.toThrow(/duplicate key|unique/i)
  })
})
