/**
 * Migration 026: the mapping a treasurer set up once.
 *
 * Two halves, and they fail differently.
 *
 * **The text half runs everywhere.** It reads the SQL and asserts the decisions
 * that are invisible at runtime until the day they matter — the revokes, and the
 * silence toward the reader. `finding-alert.test.ts` established the shape:
 * "un-deletable is a grant, not a habit", because migration 002's default
 * privileges hand `watchdog_writer` DELETE on every table created after it, so a
 * table arrives deletable unless its own migration takes it away.
 *
 * **The database half skips without a connection**, as every migration test
 * here does. What it proves is the one thing no application test can: that "one
 * mapping per shape" is refused by the database rather than remembered by
 * whatever code last touched it. The interesting case is two treasurers
 * confirming the same wizard at once, where no read-then-write is correct.
 */

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { executable } from './executable-sql'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const adminUrl = process.env.DATABASE_URL

const configured = Boolean(writerUrl && adminUrl)
const describeWithDatabase = configured ? describe : describe.skip

const UNIQUE_VIOLATION = '23505'
const INSUFFICIENT_PRIVILEGE = '42501'

const MIGRATION = readFileSync(join(__dirname, '026_column_mapping.sql'), 'utf8')

describe('the migration says what it does', () => {
  it('strips the prose before any of the assertions below read it', () => {
    // Every assertion here is a substring search, and this file's header
    // discusses revokes and grants at length. Reading the raw text would let a
    // sentence *about* a revoke satisfy a check for one — the "prose is not
    // code" defect this project has found four times, most recently inside its
    // own security guards.
    const sql = executable(MIGRATION)

    expect(sql).toContain('create table if not exists column_mapping')
    expect(sql).not.toContain('Un-deletable is a grant')
  })

  it('revokes delete rather than trusting the application', () => {
    const sql = executable(MIGRATION)

    expect(sql).toContain('revoke delete, truncate on column_mapping from watchdog_writer')
    expect(sql).toContain('revoke delete, truncate on column_mapping from public')
  })

  it('does not revoke update, because replacing a mapping is the point', () => {
    // Story 5.7's second half is that changing a mapping re-imports what it
    // affects. A migration that revoked UPDATE would make the story impossible
    // and would be discovered only at runtime.
    const sql = executable(MIGRATION)

    expect(sql).not.toMatch(/revoke[^;]*\bupdate\b[^;]*on column_mapping/)
  })

  it('carries the composite key that keeps a saver inside their own association', () => {
    /**
     * Migration 024's convention, which this table is too new to be inside: every
     * association-scoped table gets a composite foreign key "so a child cannot
     * belong to a different association than its parent".
     *
     * Without it the schema permits a saver from one association against a row in
     * another. The adapter derives `association_id` from that member, so the two
     * always agree in practice - but 024's point is that the database refuses it
     * rather than the application remembering to. Raised by ocr.
     */
    const sql = executable(MIGRATION)

    expect(sql).toContain('add constraint column_mapping_id_association_key unique (id, association_id)')
    expect(sql).toMatch(
      /foreign key \(saved_by, association_id\) references board_member \(id, association_id\)/,
    )
  })

  it('adds those constraints idempotently, like every other statement here', () => {
    // `add constraint` has no `if not exists`, so a re-applied migration would
    // fail on the second run - and every other statement in the file is guarded.
    const sql = executable(MIGRATION)

    expect(sql).toMatch(/select 1 from pg_constraint where conname = 'column_mapping_id_association_key'/)
    expect(sql).toMatch(/select 1 from pg_constraint where conname = 'column_mapping_saved_by_fk'/)
  })

  it('indexes the column that references board_member', () => {
    // Migration 005's rule, stated on its own index: "Referencing columns get no
    // index automatically. Without this, deleting a board_member scans
    // column_mapping." A convention, not a case-by-case call. Raised by ocr.
    const sql = executable(MIGRATION)

    expect(sql).toContain('create index if not exists column_mapping_saved_by_idx on column_mapping (saved_by)')
  })

  it('grants the reader nothing', () => {
    /**
     * Migration 003 revoked `watchdog_reader`'s blanket SELECT so that read
     * access became explicit. A column mapping is setup configuration, not
     * association records, and no catalog entry has a reason to read one — so
     * the absence of a grant is the decision, and this asserts the absence.
     */
    const sql = executable(MIGRATION)

    expect(sql).not.toMatch(/grant[^;]*watchdog_reader/)
  })

  it('scopes the table to an association, and to a member who saved it', () => {
    const sql = executable(MIGRATION)

    expect(sql).toContain('association_id uuid not null references association (id)')
    expect(sql).toContain('saved_by uuid not null references board_member (id)')
  })

  it('makes one mapping per shape a property of the database', () => {
    const sql = executable(MIGRATION)

    expect(sql).toContain('create unique index if not exists column_mapping_shape_is_unique')
    expect(sql).toMatch(/on column_mapping \(association_id, document_kind, shape\)/)
  })

  it('uses the time-ordered id every table since 020 uses', () => {
    const sql = executable(MIGRATION)

    expect(sql).toContain('default uuidv7()')
    expect(sql).not.toContain('gen_random_uuid')
  })
})

describeWithDatabase('against a real database', () => {
  const prefix = `a${randomBytes(4).toString('hex')}`
  let admin: Client
  let writer: Client
  let associationId: string
  let memberId: string

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl })
    writer = new Client({ connectionString: writerUrl })
    await admin.connect()
    await writer.connect()
    await admin.query(MIGRATION)

    const association = await admin.query<{ id: string }>(
      `insert into association (name) values ($1) returning id`,
      [`${prefix} association`],
    )
    associationId = association.rows[0]!.id

    const member = await admin.query<{ id: string }>(
      `insert into board_member (email, association_id) values ($1, $2) returning id`,
      [`${prefix}@example.com`, associationId],
    )
    memberId = member.rows[0]!.id
  })

  afterAll(async () => {
    if (configured) {
      // The mapping rows are not the only thing this file creates. Leaving the
      // association and its member behind accumulates a row per run forever,
      // and the next test that counts anything association-wide inherits them.
      await admin.query(`delete from column_mapping where association_id = $1`, [associationId])
      await admin.query(`delete from board_member where association_id = $1`, [associationId])
      await admin.query(`delete from association where id = $1`, [associationId])
      await admin.end()
      await writer.end()
    }
  })

  const save = (shape: string, mapping: unknown) =>
    writer.query(
      `insert into column_mapping (association_id, document_kind, shape, mapping, saved_by)
       values ($1, $2, $3, $4, $5)`,
      [associationId, 'deposit', shape, JSON.stringify(mapping), memberId],
    )

  it('refuses a second mapping for the same shape', async () => {
    const shape = `${prefix}-shape`

    await save(shape, { kind: 'deposit', columns: 3, pairings: [] })

    // Not "the application remembers not to save twice". Two treasurers
    // confirming the same wizard concurrently is the case that matters.
    await expect(save(shape, { kind: 'deposit', columns: 3, pairings: [] })).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
    })
  })

  it('allows the same shape under a different kind', async () => {
    const shape = `${prefix}-shared-shape`

    await save(shape, { kind: 'deposit', columns: 3, pairings: [] })
    await expect(
      writer.query(
        `insert into column_mapping (association_id, document_kind, shape, mapping, saved_by)
         values ($1, $2, $3, $4, $5)`,
        [associationId, 'assessment_roll', shape, '{}', memberId],
      ),
    ).resolves.toBeDefined()
  })

  it('refuses to delete a mapping', async () => {
    const shape = `${prefix}-undeletable`

    await save(shape, { kind: 'deposit', columns: 3, pairings: [] })

    await expect(
      writer.query(`delete from column_mapping where shape = $1`, [shape]),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
  })

  it('allows a mapping to be replaced, which is what a change is', async () => {
    const shape = `${prefix}-replaceable`

    await save(shape, { kind: 'deposit', columns: 3, pairings: [] })

    await expect(
      writer.query(`update column_mapping set mapping = $1 where shape = $2`, ['{"changed":true}', shape]),
    ).resolves.toBeDefined()
  })
})
