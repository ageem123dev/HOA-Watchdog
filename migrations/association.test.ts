/**
 * Migration 024: the association, and the column that says which one a row is for.
 *
 * The assertion this story turns on is not that a column exists — it is that
 * **no row can belong to a different association than its parent**. Every table
 * carries its own `association_id` so a catalog query can scope with a predicate
 * rather than a join it might forget (AD-5's amendment requires every entry to
 * filter, and a test can only check for a predicate it can see). Denormalising
 * that way is only safe if the inconsistent row is unrepresentable, so every
 * foreign key between two scoped tables is composite and carries
 * `association_id` on both sides.
 *
 * The other assertion worth naming is the drift one. A column on fourteen tables
 * today says nothing about migration 025 adding a fifteenth unscoped. The test
 * reads the live schema and requires an explicit allowlist entry for any table
 * without the column, so the next table is a decision rather than an oversight.
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
    '\n  association migration tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL must be set.\n',
  )
}

const FOREIGN_KEY_VIOLATION = '23503'

const RUN_PREFIX = `assoc${randomBytes(4).toString('hex')}`

const MIGRATION = readFileSync(join(__dirname, '024_association.sql'), 'utf8')

/** The pilot association, fixed so the backfill is idempotent by construction. */
const DEMO_ID = '00000000-0000-7000-8000-000000000001'

/**
 * Every table that holds association data. All fourteen carry the column; the
 * Task 1 decision records why none was judged to reach its association through a
 * parent instead.
 */
const SCOPED_TABLES = [
  'board_member',
  'document',
  'extraction',
  'vendor',
  'quarantine_item',
  'unit',
  'unit_holder',
  'unit_membership',
  'assessment',
  'payment',
  'held_payment',
  'query_log',
  'finding',
  'finding_alert',
]

/** Tables that legitimately carry no `association_id`, and why. */
const UNSCOPED_TABLES = new Set([
  'association', // it *is* the association
  'schema_migration', // the migration runner's own bookkeeping
])

describe('the migration says what it does', () => {
  it('creates the association table', () => {
    expect(executable(MIGRATION)).toMatch(/create\s+table\s+(if\s+not\s+exists\s+)?association\s*\(/i)
  })

  it('seeds exactly one association at a fixed id, so replay cannot duplicate it', () => {
    const sql = executable(MIGRATION)
    expect(sql).toContain(DEMO_ID)
    expect(sql).toMatch(/on\s+conflict[\s\S]{0,40}do\s+nothing/i)
  })

  it('backfills only rows that have no association yet', () => {
    // Unconditional backfill would re-point rows already assigned to another
    // association on replay. `where association_id is null` is what makes the
    // migration safe to run twice.
    const sql = executable(MIGRATION)
    const updates = sql.match(/update\s+\w+\s+set\s+association_id[\s\S]*?;/gi) ?? []
    expect(updates.length).toBeGreaterThan(0)
    for (const statement of updates) {
      expect(statement).toMatch(/where\s+association_id\s+is\s+null/i)
    }
  })

  it('adds the column to every scoped table', () => {
    const sql = executable(MIGRATION)
    for (const table of SCOPED_TABLES) {
      expect(sql).toMatch(new RegExp(`alter\\s+table\\s+${table}\\b[\\s\\S]{0,120}association_id`, 'i'))
    }
  })

  it('drops nothing', () => {
    // A retrofit across fourteen tables is the wrong place to discover that a
    // migration removed something. Additive only.
    expect(executable(MIGRATION)).not.toMatch(/\bdrop\s+(table|column|constraint)\b/i)
  })
})

describeWithDatabase('the schema it produces', () => {
  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: writerUrl })
    await client.connect()
  })

  afterAll(async () => {
    await client.query('delete from association where name like $1', [`${RUN_PREFIX}%`])
    await client.end()
  })

  it('holds exactly one association, the pilot', async () => {
    const { rows } = await client.query('select id, name from association where id = $1', [DEMO_ID])
    expect(rows).toHaveLength(1)
    expect(String(rows[0].name).trim()).not.toBe('')
  })

  it('carries a non-null association_id on every scoped table', async () => {
    const { rows } = await client.query(
      `select table_name, is_nullable
         from information_schema.columns
        where table_schema = 'public' and column_name = 'association_id'`,
    )
    const byTable = new Map(rows.map((r) => [r.table_name as string, r.is_nullable as string]))
    for (const table of SCOPED_TABLES) {
      expect(byTable.has(table), `${table} has no association_id`).toBe(true)
      expect(byTable.get(table), `${table}.association_id is nullable`).toBe('NO')
    }
  })

  it('leaves no row without an association', async () => {
    for (const table of SCOPED_TABLES) {
      const { rows } = await client.query(
        `select count(*)::int as n from ${table} where association_id is null`,
      )
      expect(rows[0].n, `${table} has unscoped rows`).toBe(0)
    }
  })

  it('requires an explicit decision for any table without the column', async () => {
    // Drift guard: migration 025 adding an unscoped table should turn this red,
    // so the next table is a decision rather than an oversight.
    const { rows } = await client.query(
      `select t.table_name
         from information_schema.tables t
        where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
          and not exists (
            select 1 from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = t.table_name
               and c.column_name = 'association_id')`,
    )
    const unexpected = rows
      .map((r) => r.table_name as string)
      .filter((name) => !UNSCOPED_TABLES.has(name))
    expect(unexpected).toEqual([])
  })

  it('makes a child in a different association unrepresentable', async () => {
    // The load-bearing assertion. Denormalising association_id onto every table
    // is only safe because a composite foreign key refuses the inconsistent row.
    const other = (
      await client.query(
        'insert into association (name) values ($1) returning id',
        [`${RUN_PREFIX} second`],
      )
    ).rows[0].id as string

    const member = (
      await client.query(
        `insert into board_member (email, password_hash, association_id)
         values ($1, 'scrypt$placeholder', $2) returning id`,
        [`${RUN_PREFIX}@example.test`, DEMO_ID],
      )
    ).rows[0].id as string

    // A document owned by the pilot's board member, but claiming the other
    // association, must be refused by the composite key rather than stored.
    await expect(
      client.query(
        `insert into document
           (uploaded_by, association_id, content_hash, storage_key, filename,
            content_type, byte_size)
         values ($1, $2, $3, $4, $5, 'text/csv', 12)`,
        [
          member,
          other,
          randomBytes(32).toString('hex'), // document_content_hash_is_sha256
          `${RUN_PREFIX}/k.csv`,
          `${RUN_PREFIX}.csv`,
        ],
      ),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION })

    await client.query('delete from board_member where email = $1', [`${RUN_PREFIX}@example.test`])
  })

  it('carries association_id on both sides of every foreign key between scoped tables', async () => {
    // Generic form of the case above, so a foreign key added later without the
    // association column is caught without anyone remembering to add a test.
    //
    // Read from `pg_constraint`, not `information_schema`. The information_schema
    // views only show constraints on tables the connecting role owns, so they
    // returned ZERO rows here — and a filter over zero rows finds zero offenders
    // and passes. The count assertion below is what stops that recurring: this
    // test's premise is that there are foreign keys to check.
    const { rows } = await client.query(
      `select con.conname, rel.relname as child, frel.relname as parent,
              (select array_agg(att.attname order by k.ord)
                 from unnest(con.conkey) with ordinality as k(attnum, ord)
                 join pg_attribute att
                   on att.attrelid = con.conrelid and att.attnum = k.attnum) as cols
         from pg_constraint con
         join pg_class rel  on rel.oid  = con.conrelid
         join pg_class frel on frel.oid = con.confrelid
         join pg_namespace n on n.oid = rel.relnamespace
        where con.contype = 'f' and n.nspname = 'public'`,
    )
    const scoped = new Set(SCOPED_TABLES)
    const between = rows.filter(
      (r) => scoped.has(r.child as string) && scoped.has(r.parent as string),
    )
    expect(between.length, 'no foreign keys between scoped tables — the query is wrong').toBeGreaterThan(0)

    // The single-column keys are deliberately kept: migration 024 is additive,
    // because it runs against a database with real rows in it. So the assertion
    // is not "every key carries association_id" — it is that every key between
    // two scoped tables HAS a composite partner covering the same column, which
    // is what makes the cross-association child unrepresentable.
    const composite = between.filter((r) => (r.cols as string[]).includes('association_id'))
    const uncovered = between
      .filter((r) => !(r.cols as string[]).includes('association_id'))
      .filter((single) => {
        const [column] = single.cols as string[]
        return !composite.some(
          (pair) =>
            pair.child === single.child &&
            pair.parent === single.parent &&
            (pair.cols as string[]).includes(column as string),
        )
      })
      .map((r) => `${r.child}.${(r.cols as string[]).join(',')} -> ${r.parent}`)
    expect(uncovered).toEqual([])
  })
})
