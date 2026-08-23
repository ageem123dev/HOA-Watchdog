/**
 * The mapping store, against Postgres (story 5.7, Task 2).
 *
 * ## Two halves, because only one of them can run everywhere
 *
 * The **text half always runs**. It reads the adapter's own SQL and asserts the
 * decisions that are invisible until the day they matter — above all that
 * `association_id` is derived in SQL from the uploading member and is never a
 * parameter. Every adapter test in this directory is `describe.skip` without a
 * database, so a tenancy rule proven only there is proven nowhere on this
 * machine, and `migrations/column-mapping.test.ts` already established the split.
 *
 * The **database half skips without a connection**. It proves the two things no
 * text search can: that a save over an existing shape returns the mapping it
 * replaced, and that one association cannot see another's.
 *
 * ## Why the previous mapping is read in the same statement
 *
 * `save` must report what it replaced — a caller that cannot tell a first save
 * from a change cannot warn anybody, and story 5.7's whole second half is that
 * warning. Read-then-write would be a race: two treasurers confirming the same
 * wizard at once is exactly the case migration 026's unique index exists for.
 * So the previous row is captured by a CTE in the same statement as the upsert,
 * where it sees the pre-insert snapshot.
 */

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createMappingStore } from './mapping-store-postgres'

const SOURCE = readFileSync(join(__dirname, 'mapping-store-postgres.ts'), 'utf8')

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const adminUrl = process.env.DATABASE_URL
const configured = Boolean(writerUrl && adminUrl)
const describeWithDatabase = configured ? describe : describe.skip

/** The comments here necessarily discuss tenancy; only the code may satisfy it. */
const code = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')

const DEPOSIT = {
  kind: 'deposit' as const,
  columns: 3,
  pairings: [
    { target: 'date' as const, position: 1 },
    { target: 'description' as const, position: 2 },
    { target: 'amount' as const, position: 3 },
  ],
}

describe('the association is established, not asserted', () => {
  it('derives it from the member in SQL rather than taking it as a parameter', () => {
    /**
     * The rule `document-repository-postgres.ts` states as "a caller cannot
     * supply the wrong one". A mapping found across associations would import
     * one board's export under another board's column meanings, and every value
     * would still be plausible in the wrong field.
     */
    expect(code).toContain('select association_id from board_member where id =')
  })

  it('never names an association id as a bound parameter', () => {
    // The failure this guards is a *later* edit adding one, not today's code.
    // `associationId` appearing anywhere in the executable text would mean a
    // caller had a way to say which board's mappings to read.
    expect(code).not.toMatch(/associationId/)
  })

  it('scopes every read of the table by association, not just one of them', () => {
    /**
     * All three of association, kind and shape are identity. A read missing the
     * association clause finds another board's mapping for the same export
     * format — and a bank's CSV headings are identical across every association
     * banking there, so that is the ordinary case rather than a contrived one.
     *
     * **Asserted per read, not over the file.** The first version of this was
     * `expect(code).toMatch(/where[\s\S]{0,200}association_id\s*=/)`, and
     * deleting the association clause from `find` did not fail it — the regex
     * matched `save`'s CTE instead, several hundred characters away. A guard
     * satisfied by a *different* query than the one it names proves nothing
     * about the one it names. Found by mutation, which is the only thing that
     * could have found it.
     */
    const reads = code.split('from column_mapping').slice(1)

    // Both reads: `find`'s select, and `save`'s previous-row CTE. If a third
    // appears, it gets checked too rather than silently escaping.
    expect(reads.length).toBeGreaterThanOrEqual(2)

    for (const read of reads) {
      expect(read.slice(0, 200)).toMatch(
        /where\s+association_id = \(select association_id from board_member where id = \$1\)/,
      )
    }
  })

  it('fills the association column on the write by deriving it too', () => {
    /**
     * The reads are covered by the loop above; this is the *write*, and it was
     * uncovered until a mutation said so. Replacing the subquery in `values`
     * with a bound parameter passed every assertion in this file - because the
     * identifier `associationId` need never appear in SQL at all, where it is
     * only ever `$5`.
     *
     * This is the direction that matters most: a read scoped to the wrong
     * association discloses a mapping, but a *write* under a caller-supplied
     * association plants one inside another board's data, where it is then
     * applied to their imports.
     */
    expect(code).toMatch(
      /values \(\(select association_id from board_member where id = \$1\)/,
    )
  })

  it('strips the prose before any of the assertions above read it', () => {
    // Every assertion here is a substring search and this file's subject is
    // tenancy, so the comments discuss it at length. Reading the raw source
    // would let a sentence *about* the rule satisfy a check for the rule — the
    // "prose is not code" defect this project has found five times, twice
    // inside its own security guards.
    expect(code).not.toContain('a caller cannot supply the wrong one')
    expect(code).toContain('export function createMappingStore')
  })
})

describe('saving replaces, and says what it replaced', () => {
  it('captures the previous mapping in the same statement as the write', () => {
    // Read-then-write loses the race that migration 026's unique index exists
    // for. A CTE reading the pre-insert snapshot does not.
    expect(code).toMatch(/with\s+previous\s+as/i)
    expect(code).toMatch(/on conflict[\s\S]{0,120}do update/i)
  })

  it('does not delete, because the migration revoked it', () => {
    // Migration 026 revokes DELETE from `watchdog_writer`. An adapter issuing
    // one would fail at runtime, in production, on a treasurer's re-map.
    expect(code).not.toMatch(/\bdelete\s+from\b/i)
  })
})

describeWithDatabase('against a real database', () => {
  const prefix = `a${randomBytes(4).toString('hex')}`
  let admin: Client
  let mine: string
  let theirs: string

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl })
    await admin.connect()
    await admin.query(readFileSync(join(__dirname, '../../migrations/026_column_mapping.sql'), 'utf8'))

    const member = async (label: string) => {
      const association = await admin.query<{ id: string }>(
        `insert into association (name) values ($1) returning id`,
        [`${prefix} ${label}`],
      )
      const row = await admin.query<{ id: string }>(
        `insert into board_member (email, association_id) values ($1, $2) returning id`,
        [`${prefix}-${label}@example.com`, association.rows[0]!.id],
      )
      return row.rows[0]!.id
    }

    mine = await member('mine')
    theirs = await member('theirs')
  })

  afterAll(async () => {
    if (configured) await admin.end()
  })

  const store = () => createMappingStore()

  it('finds nothing before anything is saved', async () => {
    // `null` is "nobody has mapped this shape", which is what sends the
    // treasurer to the wizard. Not an error, and it must not be reported as one.
    await expect(store().find(mine, 'deposit', `${prefix}-unsaved`)).resolves.toBeNull()
  })

  it('reads back what was saved', async () => {
    const shape = `${prefix}-roundtrip`

    await store().save({ savedBy: mine, kind: 'deposit', shape, mapping: DEPOSIT })

    const found = await store().find(mine, 'deposit', shape)

    expect(found?.mapping).toEqual(DEPOSIT)
    expect(found?.shape).toBe(shape)
  })

  it('returns null from a first save and the old mapping from a change', async () => {
    const shape = `${prefix}-replaced`
    const changed = { ...DEPOSIT, pairings: [{ target: 'amount' as const, position: 1 }] }

    const first = await store().save({ savedBy: mine, kind: 'deposit', shape, mapping: DEPOSIT })
    const second = await store().save({ savedBy: mine, kind: 'deposit', shape, mapping: changed })

    // Not `void`: this is how a caller tells a change from a first save, which
    // is what AC6's warning is built on.
    expect(first).toBeNull()
    expect(second?.mapping).toEqual(DEPOSIT)
    expect((await store().find(mine, 'deposit', shape))?.mapping).toEqual(changed)
  })

  it('does not let one association see another\'s mapping', async () => {
    // The disaster case, and the reason the association is in the key. Both
    // members here map the *same* shape, which is what a shared bank export
    // format looks like across two boards.
    const shape = `${prefix}-shared-format`

    await store().save({ savedBy: mine, kind: 'deposit', shape, mapping: DEPOSIT })

    await expect(store().find(theirs, 'deposit', shape)).resolves.toBeNull()
  })

  it('does not find a mapping saved under another kind', async () => {
    const shape = `${prefix}-kind-scoped`

    await store().save({ savedBy: mine, kind: 'deposit', shape, mapping: DEPOSIT })

    await expect(store().find(mine, 'assessment_roll', shape)).resolves.toBeNull()
  })

  it('refuses a mapping from a member who does not exist', async () => {
    /**
     * The scalar subquery yields NULL for an unknown member, and
     * `association_id not null` turns that into an error rather than a row
     * belonging to nobody. Worth asserting: the alternative — inserting under a
     * null association — is a row no association-scoped read would ever find
     * again, and no error would have been raised.
     */
    await expect(
      store().save({
        savedBy: '00000000-0000-0000-0000-000000000000',
        kind: 'deposit',
        shape: `${prefix}-ghost`,
        mapping: DEPOSIT,
      }),
    ).rejects.toThrow()
  })
})
