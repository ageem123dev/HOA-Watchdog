/**
 * Migration 011: the unit, and the identity dues attach to.
 *
 * Two instruments, as epic 1 settled. The database tests prove the constraints
 * by violating them and asserting the SQLSTATE; the text tests prove the
 * statements say what the prose claims. Comments are stripped before matching,
 * because stories 1.6a *and* 1.6c each shipped a test that matched the
 * migration's own explanation rather than its SQL.
 */

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { executable } from './executable-sql'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  unit migration tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL must both be set.\n',
  )
}

const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'
const INSUFFICIENT_PRIVILEGE = '42501'

/**
 * Every unit this file creates carries this prefix, and its cleanup deletes only
 * rows carrying it.
 *
 * Vitest runs test files in parallel. The first version of this file cleaned up
 * with `unit_number like '%-%'`, which matches any unit number containing a
 * dash -- including the ones `unit-membership.test.ts` was using at that moment.
 * The two files deleted each other's rows mid-run, and the symptom was a count
 * assertion failing in whichever file lost the race, intermittently, in a suite
 * that is the only gate this project has. Proved directly rather than inferred:
 * inserting `deadbeef-4B` and running the old cleanup statement removed it.
 *
 * The convention is `quarantine-item.test.ts`'s, which had it right first.
 */
const RUN_PREFIX = `u${randomBytes(4).toString('hex')}`

const MIGRATION = readFileSync(join(__dirname, '011_unit.sql'), 'utf8')

describe('the migration says what it does', () => {
  it('creates the unit table', () => {
    expect(executable(MIGRATION)).toMatch(/create\s+table\s+unit\s*\(/i)
  })

  it('defines a normalisation of its own rather than borrowing the vendor one', () => {
    // A unit number and a vendor name are not the same kind of thing. Sharing
    // `vendor_normalised_name` would mean a later change to vendor matching
    // silently changed which units are considered the same unit — a coupling
    // nobody would look for when making it.
    // Asserted as what the generated column *does* call, not as a word the file
    // must not contain. The first version forbade the string `vendor_normalised_name`
    // anywhere in executable SQL and failed on a `comment on` literal that merely
    // explains the separation — a deny-list catching a mention rather than a
    // dependency, which is the shape this project keeps having to unlearn.
    const sql = executable(MIGRATION)

    expect(sql).toMatch(/create\s+(or\s+replace\s+)?function\s+unit_normalised_number/i)
    expect(sql).toMatch(/generated\s+always\s+as\s*\(\s*unit_normalised_number\s*\(/i)
  })

  it('makes the normalised number unique', () => {
    // Matched on the indexed *column*, in its parentheses. The first version
    // matched `normalised_number` anywhere after `create unique index`, which the
    // index's own name -- `unit_normalised_number_key` -- satisfies on its own.
    // Pointing the index at the raw column left both this and the database
    // cross-check green while the constraint it names had stopped working.
    // Found by the sensitivity check, not by reading it.
    expect(executable(MIGRATION)).toMatch(
      /create\s+unique\s+index[^;]*\(\s*normalised_number\s*\)/i,
    )
  })

  it('grants select on unit to watchdog_reader', () => {
    // Migration 003 revoked the reader's default select, so every table it may
    // read says so explicitly.
    expect(executable(MIGRATION)).toMatch(/grant\s+select\s+on\s+unit\s+to\s+watchdog_reader/i)
  })

  it('grants the reader nothing that writes', () => {
    expect(executable(MIGRATION)).not.toMatch(
      /grant\s+[^;]*\b(insert|update|delete|truncate|all)\b[^;]*\bto\s+watchdog_reader/i,
    )
  })

  it('pins the search_path on the normalisation function', () => {
    // Raised by review. The body calls `lower`, `regexp_replace`, `btrim` and
    // `chr` unqualified, and this function decides unit *identity* -- it backs a
    // stored generated column and the unique index built on it. A role able to
    // put a schema earlier in the caller's search_path could shadow any of them,
    // and rows written before and after would then disagree about which unit
    // numbers are the same unit.
    expect(executable(MIGRATION)).toMatch(/set\s+search_path\s*=\s*pg_catalog\s*,\s*pg_temp/i)
  })

  it('strips comments without eating this migration statements', () => {
    // The control for the instrument, as applied to *this* file's migration.
    // `executable-sql.test.ts` proves the stripper handles trailing comments,
    // nested blocks and quoted literals; this proves it leaves migration 011's
    // statements standing, which is what every assertion above rests on. Story
    // 1.6c shipped two versions of this control that tested nothing, because the
    // sample they used could not match either way.
    const stripped = executable(MIGRATION)

    expect(stripped).toMatch(/create\s+table\s+unit\s*\(/i)
    expect(stripped).toMatch(/create\s+unique\s+index/i)
    expect(stripped).toMatch(/grant\s+select/i)
    // And it did remove something: the file opens with a comment block.
    expect(stripped.length).toBeLessThan(MIGRATION.length)
  })
})

describeWithDatabase('the unit table', () => {
  let writer: Client
  let reader: Client
  let scope = ''

  const numbered = (suffix: string) => `${RUN_PREFIX}-${scope}-${suffix}`

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    reader = new Client({ connectionString: readerUrl })
    await writer.connect()
    await reader.connect()
  })

  beforeEach(() => {
    // Per test, not per file. The queue adapter's suite scoped per run first and
    // its tests promptly stopped being independent.
    scope = randomBytes(4).toString('hex')
  })

  afterAll(async () => {
    await writer.query('delete from unit where unit_number like $1', [`${RUN_PREFIX}-%`])
    await writer.end()
    await reader.end()
  })

  it('stores a unit number and reads it back unchanged', async () => {
    // Reverse-it: what went in comes out, in the spelling it went in with. The
    // normalised form is a comparison key; the number a treasurer typed is what
    // they should see.
    const number = numbered('4B')

    await writer.query('insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\')', [number])
    const { rows } = await writer.query<{ unit_number: string }>(
      'select unit_number from unit where unit_number = $1',
      [number],
    )

    expect(rows[0]?.unit_number).toBe(number)
  })

  it('treats two spellings of one number as the same unit', async () => {
    // A1. `4B` and `4b  ` off a hand-typed roll are one property. Two rows would
    // split every dues figure between them, and neither would look wrong.
    await writer.query('insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\')', [numbered('4B')])

    await expect(
      writer.query('insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\')', [numbered('4b  ')]),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION })
  })

  it('keeps genuinely different numbers apart', async () => {
    // Beside the case above: a normaliser that folded everything to one value
    // would satisfy it and be useless.
    await writer.query('insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\')', [numbered('4B')])
    await writer.query('insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\')', [numbered('5B')])

    const { rows } = await writer.query<{ n: string }>(
      'select count(*)::text n from unit where unit_number like $1',
      [`${RUN_PREFIX}-${scope}-%`],
    )
    expect(rows[0]?.n).toBe('2')
  })

  it('refuses a blank unit number', async () => {
    // A2. A row that names nothing.
    await expect(
      writer.query('insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\')', ['   ']),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('refuses a number that is only padding around one character', async () => {
    // A2's sharp edge, and the shape story 1.6b had to rebuild a guard around:
    // measuring after `btrim` lets 'x' plus 300 spaces through, because the
    // trim happens before the count.
    await expect(
      writer.query('insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\')', [`x${' '.repeat(300)}`]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('refuses an oversized unit number', async () => {
    // A3. A pasted spreadsheet cell.
    await expect(
      writer.query('insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\')', ['4'.repeat(65)]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('lets watchdog_reader read it', async () => {
    // A4. Without this the catalog cannot answer a question about units, and the
    // failure surfaces an epic later as a permission error.
    await writer.query('insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\')', [numbered('7A')])

    const { rows } = await reader.query<{ unit_number: string }>(
      'select unit_number from unit where unit_number = $1',
      [numbered('7A')],
    )
    expect(rows[0]?.unit_number).toBe(numbered('7A'))
  })

  it('does not let watchdog_reader write it', async () => {
    // A5. AD-4: the role the LLM-driven query path runs under cannot invent a
    // unit.
    await expect(
      reader.query('insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\')', [numbered('9Z')]),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
  })

  it('carries the pinned search_path on the live function', async () => {
    // The cross-check for the migration-text assertion above. The text proves it
    // was asked for; this proves the function in the database actually has it —
    // the same pairing the queue adapter uses for its order clause, and the
    // reason that pairing exists is that only one of the two caught a defect.
    const { rows } = await writer.query<{ proconfig: string[] | null }>(
      `select proconfig from pg_proc where proname = 'unit_normalised_number'`,
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.proconfig ?? []).toContain('search_path=pg_catalog, pg_temp')
  })

  it('carries the unique index the constraint depends on', async () => {
    // Cross-check: the violation above proves *a* constraint fired; this proves
    // it is the index this migration claims to create. A rejection for some
    // other reason would satisfy the first assertion alone.
    const { rows } = await writer.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where tablename = 'unit'",
    )

    // On the indexed columns, in parentheses -- not on the string appearing
    // anywhere in the definition, which the index's *name* already satisfies.
    // See the note on the text test above: the loose form stayed green with the
    // index pointed at `unit_number`.
    //
    // Scoped by association since migration 025: a unit number identifies a
    // property *within one board's roll*. The global form this used to assert
    // refused a second association its own "4B" outright, and -- worse --
    // `roll-repository`'s `on conflict do update` resolved onto the first
    // association's row instead of failing.
    expect(rows.map((r) => r.indexdef).join('\n')).toMatch(
      /create unique index[^\n]*\(\s*association_id\s*,\s*normalised_number\s*\)/i,
    )
  })
})
