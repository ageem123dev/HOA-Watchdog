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

const MIGRATION = readFileSync(join(__dirname, '011_unit.sql'), 'utf8')

/**
 * The statements only.
 *
 * These migrations explain their own hazards in prose, so a check for a bad
 * shape matches the sentence warning against it unless comments come out first.
 */
const executable = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')

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

  it('strips comments without eating statements', () => {
    // The control for the instrument. Story 1.6c shipped two versions of this
    // control that tested nothing, because the sample it used could not match
    // either way.
    const sample = ['-- create table decoy (', 'create table unit (', '  id uuid'].join('\n')

    expect(executable(sample)).toMatch(/create\s+table\s+unit\s*\(/i)
    expect(executable(sample)).not.toMatch(/decoy/i)
  })
})

describeWithDatabase('the unit table', () => {
  let writer: Client
  let reader: Client
  let scope = ''

  const numbered = (suffix: string) => `${scope}-${suffix}`

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
    await writer.query("delete from unit where unit_number like '%-%'")
    await writer.end()
    await reader.end()
  })

  it('stores a unit number and reads it back unchanged', async () => {
    // Reverse-it: what went in comes out, in the spelling it went in with. The
    // normalised form is a comparison key; the number a treasurer typed is what
    // they should see.
    const number = numbered('4B')

    await writer.query('insert into unit (unit_number) values ($1)', [number])
    const { rows } = await writer.query<{ unit_number: string }>(
      'select unit_number from unit where unit_number = $1',
      [number],
    )

    expect(rows[0]?.unit_number).toBe(number)
  })

  it('treats two spellings of one number as the same unit', async () => {
    // A1. `4B` and `4b  ` off a hand-typed roll are one property. Two rows would
    // split every dues figure between them, and neither would look wrong.
    await writer.query('insert into unit (unit_number) values ($1)', [numbered('4B')])

    await expect(
      writer.query('insert into unit (unit_number) values ($1)', [numbered('4b  ')]),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION })
  })

  it('keeps genuinely different numbers apart', async () => {
    // Beside the case above: a normaliser that folded everything to one value
    // would satisfy it and be useless.
    await writer.query('insert into unit (unit_number) values ($1)', [numbered('4B')])
    await writer.query('insert into unit (unit_number) values ($1)', [numbered('5B')])

    const { rows } = await writer.query<{ n: string }>(
      'select count(*)::text n from unit where unit_number like $1',
      [`${scope}-%`],
    )
    expect(rows[0]?.n).toBe('2')
  })

  it('refuses a blank unit number', async () => {
    // A2. A row that names nothing.
    await expect(
      writer.query('insert into unit (unit_number) values ($1)', ['   ']),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('refuses a number that is only padding around one character', async () => {
    // A2's sharp edge, and the shape story 1.6b had to rebuild a guard around:
    // measuring after `btrim` lets 'x' plus 300 spaces through, because the
    // trim happens before the count.
    await expect(
      writer.query('insert into unit (unit_number) values ($1)', [`x${' '.repeat(300)}`]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('refuses an oversized unit number', async () => {
    // A3. A pasted spreadsheet cell.
    await expect(
      writer.query('insert into unit (unit_number) values ($1)', ['4'.repeat(65)]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('lets watchdog_reader read it', async () => {
    // A4. Without this the catalog cannot answer a question about units, and the
    // failure surfaces an epic later as a permission error.
    await writer.query('insert into unit (unit_number) values ($1)', [numbered('7A')])

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
      reader.query('insert into unit (unit_number) values ($1)', [numbered('9Z')]),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
  })

  it('carries the unique index the constraint depends on', async () => {
    // Cross-check: the violation above proves *a* constraint fired; this proves
    // it is the index this migration claims to create. A rejection for some
    // other reason would satisfy the first assertion alone.
    const { rows } = await writer.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where tablename = 'unit'",
    )

    // On the indexed column, in parentheses -- not on the string appearing
    // anywhere in the definition, which the index's *name* already satisfies.
    // See the note on the text test above: the loose form stayed green with the
    // index pointed at `unit_number`.
    expect(rows.map((r) => r.indexdef).join('\n')).toMatch(
      /create unique index[^\n]*\(\s*normalised_number\s*\)/i,
    )
  })
})
