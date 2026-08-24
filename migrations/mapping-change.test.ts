/**
 * Migration 027: the record of a mapping change (story 5.7, AC6).
 *
 * The text half runs everywhere and is where the decisions live; the database
 * half skips without a connection, as every migration test here does.
 *
 * The decision most worth asserting is the one that differs from its sibling.
 * Migration 026 leaves UPDATE alone, because replacing a mapping is the point of
 * the story's second half; 027 revokes it, because a record of what happened
 * must not be rewritable. Two adjacent tables, opposite answers — and a
 * migration written by copying the other would carry the wrong one silently.
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

const INSUFFICIENT_PRIVILEGE = '42501'
const MIGRATION = readFileSync(join(__dirname, '027_mapping_change.sql'), 'utf8')

describe('the migration says what it does', () => {
  it('strips the prose before any assertion reads it', () => {
    // This file's header discusses revokes at length, so reading the raw text
    // would let a sentence about one satisfy a check for one.
    const sql = executable(MIGRATION)

    expect(sql).toContain('create table if not exists mapping_change')
    expect(sql).not.toContain('Un-editable, which column_mapping is not')
  })

  it('revokes update as well as delete, unlike the mapping it records', () => {
    /**
     * The difference from 026, and why this is worth more than the usual revoke
     * assertion: the sibling table deliberately keeps UPDATE. A migration
     * written by copying 026 keeps it here too, and the audit trail becomes
     * editable by the very application that writes it.
     */
    const sql = executable(MIGRATION)

    expect(sql).toContain('revoke update, delete, truncate on mapping_change from watchdog_writer')
    expect(sql).toContain('revoke update, delete, truncate on mapping_change from public')
  })

  it('keeps the previous mapping nullable and the new one not', () => {
    // Null previous means "first mapping for this shape". Not-null would force
    // the first change to invent one.
    const sql = executable(MIGRATION)

    expect(sql).toMatch(/previous_mapping jsonb(?!\s+not null)/)
    expect(sql).toContain('new_mapping jsonb not null')
  })

  it('records who and when', () => {
    const sql = executable(MIGRATION)

    expect(sql).toContain('changed_by uuid not null references board_member (id)')
    expect(sql).toContain('changed_at timestamptz not null default now()')
  })

  it('scopes to an association and indexes the history of one shape', () => {
    const sql = executable(MIGRATION)

    expect(sql).toContain('association_id uuid not null references association (id)')
    expect(sql).toMatch(
      /on mapping_change \(association_id, document_kind, shape, changed_at desc\)/,
    )
  })

  it('carries the composite key that keeps a changer inside their own association', () => {
    /**
     * Migration 024's convention, which this table is too new to be inside: every
     * association-scoped table gets a composite foreign key "so a child cannot
     * belong to a different association than its parent".
     *
     * Without it the schema permits a changer from one association against a row in
     * another. The adapter derives `association_id` from that member, so the two
     * always agree in practice - but 024's point is that the database refuses it
     * rather than the application remembering to. Raised by ocr.
     */
    const sql = executable(MIGRATION)

    expect(sql).toContain('add constraint mapping_change_id_association_key unique (id, association_id)')
    expect(sql).toMatch(
      /foreign key \(changed_by, association_id\) references board_member \(id, association_id\)/,
    )
  })

  it('adds those constraints idempotently, like every other statement here', () => {
    // `add constraint` has no `if not exists`, so a re-applied migration would
    // fail on the second run - and every other statement in the file is guarded.
    const sql = executable(MIGRATION)

    expect(sql).toMatch(/select 1 from pg_constraint where conname = 'mapping_change_id_association_key'/)
    expect(sql).toMatch(/select 1 from pg_constraint where conname = 'mapping_change_changed_by_fk'/)
  })

  it('indexes the column that references board_member', () => {
    // Migration 005's rule, stated on its own index: "Referencing columns get no
    // index automatically. Without this, deleting a board_member scans
    // mapping_change." A convention, not a case-by-case call. Raised by ocr.
    const sql = executable(MIGRATION)

    expect(sql).toContain('create index if not exists mapping_change_changed_by_idx on mapping_change (changed_by)')
  })

  it('grants the reader nothing', () => {
    const sql = executable(MIGRATION)

    expect(sql).not.toMatch(/grant[^;]*watchdog_reader/)
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
      // As in `column-mapping.test.ts`: the association and its member are this
      // file's litter too, not just the rows under test.
      await admin.query(`delete from mapping_change where association_id = $1`, [associationId])
      await admin.query(`delete from board_member where association_id = $1`, [associationId])
      await admin.query(`delete from association where id = $1`, [associationId])
      await admin.end()
      await writer.end()
    }
  })

  const write = (shape: string) =>
    writer.query(
      `insert into mapping_change
         (association_id, document_kind, shape, previous_mapping, new_mapping, changed_by, documents)
       values ($1, 'deposit', $2, null, $3, $4, $5) returning id`,
      [
        associationId,
        shape,
        JSON.stringify({ columns: 3 }),
        memberId,
        JSON.stringify([{ documentId: 'd', outcome: 're-imported' }]),
      ],
    )

  it('accepts a first change with no previous mapping', async () => {
    await expect(write(`${prefix}-first`)).resolves.toBeDefined()
  })

  it('refuses to edit a record of what happened', async () => {
    const shape = `${prefix}-immutable`
    await write(shape)

    await expect(
      writer.query(`update mapping_change set new_mapping = '{}' where shape = $1`, [shape]),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
  })

  it('refuses to delete one', async () => {
    const shape = `${prefix}-undeletable`
    await write(shape)

    await expect(
      writer.query(`delete from mapping_change where shape = $1`, [shape]),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
  })

  it('keeps more than one change for the same shape', async () => {
    // The whole reason this is a history table and not columns on the mapping.
    const shape = `${prefix}-twice`
    await write(shape)
    await write(shape)

    const found = await admin.query<{ count: string }>(
      `select count(*) from mapping_change where shape = $1`,
      [shape],
    )

    expect(Number(found.rows[0]!.count)).toBe(2)
  })
})
