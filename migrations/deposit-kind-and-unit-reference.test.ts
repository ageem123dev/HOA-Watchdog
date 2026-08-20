/**
 * Migration 014: a deposit is a kind of document, and a line can name a unit.
 *
 * Two things worth stating up front, because both shaped the tests.
 *
 * A check constraint cannot be extended in place — it is dropped and recreated —
 * so from this migration onward **migration 006 no longer states the document
 * kinds the database admits**. `core/extraction/record.test.ts` read 006 to learn
 * them and now scans every migration, taking the last definition, which is what
 * the database does.
 *
 * And `unit_reference` is deliberately not `vendor_name`. Reusing that column
 * would have needed no migration at all, and would have fed unit identity
 * through `vendor_normalised_name()` — the coupling migration 011 refused,
 * because a later change to vendor matching would then silently change which
 * units are considered the same unit.
 */

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { executable } from './executable-sql'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  deposit-kind migration tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL must both be set.\n',
  )
}

const CHECK_VIOLATION = '23514'
const INSUFFICIENT_PRIVILEGE = '42501'

const RUN_PREFIX = `d${randomBytes(4).toString('hex')}`

const MIGRATION = readFileSync(
  join(__dirname, '014_deposit_kind_and_unit_reference.sql'),
  'utf8',
)

describe('the migration says what it does', () => {
  it('restates the whole kind vocabulary, including deposit', () => {
    // Restated in full rather than appended to, because a check constraint has
    // no append. Matching the whole list is what proves nothing was lost while
    // adding one value.
    expect(executable(MIGRATION)).toMatch(
      /document_kind\s+in\s*\(\s*'invoice',\s*'statement',\s*'assessment_roll',\s*'deposit',\s*'other'\s*\)/i,
    )
  })

  it('drops the old constraint before recreating it', () => {
    // The statement that makes migration 006 stale. Asserted so the consequence
    // is visible here rather than discovered by a parity test failing somewhere
    // else for a reason that looks unrelated.
    expect(executable(MIGRATION)).toMatch(
      /drop\s+constraint\s+extraction_kind_known/i,
    )
  })

  it('adds a unit reference to the extraction row', () => {
    expect(executable(MIGRATION)).toMatch(/add\s+column\s+unit_reference\s+text/i)
  })

  it('gives the unit reference no normalisation of its own here', () => {
    // The coupling migration 011 refused: unit identity must not be decided by
    // `vendor_normalised_name()`, or a later change to vendor matching would
    // silently change which units are the same unit.
    //
    // The first version of this test forbade the string `vendor_normalised_name`
    // anywhere in the executable SQL — and failed, because the `comment on`
    // literal at the foot of the migration *explains* the separation and names
    // the function to do so. `executable()` correctly preserves string literals,
    // so the deny-list caught a mention rather than a dependency.
    //
    // Story 2.1 shipped that exact mistake and recorded it; this test's own
    // comment cited it, and it was written that way regardless. Asserted now as
    // what the column *is*: a plain `text` column with no generated
    // normalisation attached to it. Resolution happens when the payment is
    // written, against `unit_normalised_number()`.
    const sql = executable(MIGRATION)

    expect(sql).toMatch(/add\s+column\s+unit_reference\s+text/i)
    expect(sql).not.toMatch(/unit_reference[^;]*generated\s+always/i)
  })

  it('measures the reference twice, the way migration 009 does', () => {
    // `char_length(btrim(x, …)) between 1 and 64` lets 'x' plus three hundred
    // spaces through, because btrim removes the padding before anything counts
    // it. Migration 006 got this wrong first; 009 fixed the shape.
    const sql = executable(MIGRATION)

    expect(sql).toMatch(/char_length\s*\(\s*unit_reference\s*\)\s*<=\s*64/i)
    expect(sql).toMatch(/char_length\s*\(\s*\r?\n?\s*btrim\s*\(\s*unit_reference/i)
    expect(sql).not.toMatch(/btrim[\s\S]{0,80}between\s+1\s+and\s+64/i)
  })

  it('strips comments without eating this migration statements', () => {
    const stripped = executable(MIGRATION)

    expect(stripped).toMatch(/alter\s+table\s+extraction/i)
    expect(stripped).toMatch(/add\s+constraint\s+extraction_kind_known/i)
    expect(stripped.length).toBeLessThan(MIGRATION.length)
  })
})

describeWithDatabase('a deposit line', () => {
  let writer: Client
  let reader: Client
  let boardMemberId = ''

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    reader = new Client({ connectionString: readerUrl })
    await writer.connect()
    await reader.connect()

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash, association_id) values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA', '00000000-0000-7000-8000-000000000001')
       returning id`,
      [`deposit-kind-${RUN_PREFIX}@example.test`],
    )
    boardMemberId = rows[0]!.id
  })

  afterAll(async () => {
    if (boardMemberId) {
      await writer.query('delete from document where uploaded_by = $1', [boardMemberId])
      await writer.query('delete from board_member where id = $1', [boardMemberId])
    }
    await writer.end()
    await reader.end()
  })

  /** A fresh document to hang an extraction from. */
  const newDocument = async (): Promise<string> => {
    const hash = randomBytes(32).toString('hex')
    const { rows } = await writer.query<{ id: string }>(
      `insert into document (content_hash, storage_key, filename, content_type, byte_size, uploaded_by, association_id) values ($1, $2, 'deposits.csv', 'text/csv', 512, $3, '00000000-0000-7000-8000-000000000001')
       returning id`,
      [hash, `documents/${hash}`, boardMemberId],
    )
    return rows[0]!.id
  }

  const line = async (unitReference: string | null) => {
    const documentId = await newDocument()
    return writer.query(
      `insert into extraction (document_id, document_kind, unit_reference, total_amount, currency, association_id) values ($1, 'deposit', $2, '120.00', 'USD', '00000000-0000-7000-8000-000000000001')`,
      [documentId, unitReference],
    )
  }

  it('admits deposit as a document kind', async () => {
    // The whole point of migration 014's first half. Before it, this insert
    // failed the check constraint.
    await expect(line('4B')).resolves.toBeDefined()
  })

  it('stores the reference as the document spelled it', async () => {
    // Unfolded, like `unit.unit_number` and `quarantine_item.extracted_name`.
    // The folded form is a comparison key and no use to a human deciding which
    // unit a payment belongs to.
    const documentId = await newDocument()
    await writer.query(
      `insert into extraction (document_id, document_kind, unit_reference, total_amount, currency, association_id) values ($1, 'deposit', '  4b Upper  ', '120.00', 'USD', '00000000-0000-7000-8000-000000000001')`,
      [documentId],
    )

    const { rows } = await writer.query<{ unit_reference: string }>(
      'select unit_reference from extraction where document_id = $1',
      [documentId],
    )
    expect(rows[0]?.unit_reference).toBe('  4b Upper  ')
  })

  it('allows no reference at all, because most documents have none', async () => {
    // An invoice pays a vendor; a statement names nobody. Absence is not
    // emptiness, and only a deposit line carries one.
    await expect(line(null)).resolves.toBeDefined()
  })

  it('refuses a reference that is only whitespace', async () => {
    await expect(line('   ')).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('refuses a reference that is only padding around one character', async () => {
    // The shape migration 006 got wrong and 009 fixed: measuring after `btrim`
    // lets this through, because the padding is removed before anything counts.
    await expect(line(`x${' '.repeat(300)}`)).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('refuses an oversized reference', async () => {
    // 64, matching `unit.unit_number` — this is the same thing read off a
    // different document.
    await expect(line('4'.repeat(65))).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('accepts a reference exactly at the bound', async () => {
    // Beside the case above: a cap nobody can reach is a different bug.
    await expect(line('4'.repeat(64))).resolves.toBeDefined()
  })

  it('lets watchdog_reader read the reference but not write one', async () => {
    // AD-4. The role the LLM-driven query path runs under cannot invent a
    // payment's unit.
    const documentId = await newDocument()
    await writer.query(
      `insert into extraction (document_id, document_kind, unit_reference, total_amount, currency, association_id) values ($1, 'deposit', '7A', '120.00', 'USD', '00000000-0000-7000-8000-000000000001')`,
      [documentId],
    )

    const { rows } = await reader.query<{ unit_reference: string }>(
      'select unit_reference from extraction where document_id = $1',
      [documentId],
    )
    expect(rows[0]?.unit_reference).toBe('7A')

    await expect(
      reader.query(
        `insert into extraction (document_id, document_kind, unit_reference, currency, association_id) values ($1, 'deposit', '9Z', 'USD', '00000000-0000-7000-8000-000000000001')`,
        [documentId],
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
  })
})
