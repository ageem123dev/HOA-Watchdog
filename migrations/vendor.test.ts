/**
 * `vendor` — the known-vendor table and the one rule for recognising a name.
 *
 * The dangerous outcome here is not a crash. It is one vendor quietly acquiring
 * two identities, because then a duplicate invoice sits in a history that never
 * gets compared against itself, and the anomaly detection that exists to catch
 * it reports nothing.
 *
 * Two identities is what happens when the application and the database disagree
 * about what a name normalises to. They disagree by default and in ways nothing
 * announces: Postgres does not count NBSP as whitespace and JavaScript does, and
 * NBSP is what a PDF extractor emits. So the parity tests below are not hygiene
 * -- they are the story.
 *
 * Against real Postgres, like every migration test here. A generated column, a
 * unique index and a grant are all claims about the database, and a fake
 * asserting them is a fake agreeing with itself.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NAME_FOLD_WHITESPACE, normaliseVendorName } from '../core/vendor/name'
import { VENDOR_NAME_MAX_LENGTH } from '../core/extraction/record'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  vendor tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL must both be set.\n',
  )
}

const NOT_NULL_VIOLATION = '23502'
const UNIQUE_VIOLATION = '23505'
const CHECK_VIOLATION = '23514'
const INSUFFICIENT_PRIVILEGE = '42501'
const GENERATED_ALWAYS = '428C9'

const RUN_PREFIX = randomBytes(4).toString('hex')

const MIGRATION = readFileSync(join(__dirname, '009_vendor.sql'), 'utf8')

/** Unique per run so a failed run cannot collide with the next one. */
const named = (suffix: string) => `${RUN_PREFIX} ${suffix}`

describe('the migration says what it does', () => {
  it('grants select to the reader explicitly, because 003 revoked the default', () => {
    // Not a formality. Migration 003 revoked default privileges precisely so a
    // new table is unreadable until somebody decides otherwise, and FR-6 needs
    // vendor identity on the read path to compare an invoice against history.
    expect(MIGRATION).toMatch(/grant\s+select\s+on\s+vendor\s+to\s+watchdog_reader/i)
  })

  it('grants the reader nothing else', () => {
    // The opposite direction, asserted separately. A test that only checks the
    // select grant passes just as happily against `grant all`.
    expect(MIGRATION).not.toMatch(
      /grant\s+[^;]*\b(insert|update|delete|truncate|all)\b[^;]*\bto\s+watchdog_reader/i,
    )
  })

  it('does not reach for a backslash escape in its whitespace class', () => {
    // Measured before this file was written: E'\\s+' matches the letter `s`,
    // turning `Landscaping` into `Land caping` -- plausible output, no error.
    // The class is spelled out with chr() instead, which cannot be misread.
    //
    // Comments are stripped first. The migration names the hazard in prose so
    // the next person does not rediscover it, and the first version of this
    // test failed on that very sentence -- a check that cannot tell an example
    // from its use.
    const executable = MIGRATION.split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')

    expect(executable).not.toMatch(/E'.*\\\\s/)
  })

  it('would notice a backslash class if one were used', () => {
    // The stripping above could hide the thing it is meant to catch, so prove
    // the predicate still fires on the shape it is looking for.
    const offending = "select regexp_replace(raw, E'\\\\s+', ' ', 'g')"

    expect(offending).toMatch(/E'.*\\\\s/)
  })
})

describeWithDatabase('vendor', () => {
  let writer: Client
  let reader: Client

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    reader = new Client({ connectionString: readerUrl })
    await writer.connect()
    await reader.connect()
  })

  afterAll(async () => {
    if (writer) {
      await writer.query('delete from vendor where display_name like $1', [`${RUN_PREFIX}%`])
      await writer.end()
    }
    if (reader) await reader.end()
  })

  describe('storing one', () => {
    it('accepts a plain name and gives it an id', async () => {
      const { rows } = await writer.query(
        'insert into vendor (display_name) values ($1) returning id, display_name',
        [named('Evergreen Landscaping')],
      )

      expect(rows[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/)
      expect(rows[0].display_name).toBe(named('Evergreen Landscaping'))
    })

    it('refuses a name that is only whitespace, which a length check alone admits', async () => {
      // char_length('   ') is 3. Migration 006 learned this on vendor_name and
      // the same trap is here: a vendor made of spaces satisfies a bare bound.
      await expect(
        writer.query('insert into vendor (display_name) values ($1)', ['   ']),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION })
    })

    it('refuses an empty name', async () => {
      await expect(
        writer.query('insert into vendor (display_name) values ($1)', ['']),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION })
    })

    it('refuses a name past the bound extraction already enforces', async () => {
      await expect(
        writer.query('insert into vendor (display_name) values ($1)', [
          'x'.repeat(VENDOR_NAME_MAX_LENGTH + 1),
        ]),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION })
    })

    it('accepts a name exactly at the bound, so the limit is off-by-one correct', async () => {
      // The other side of the boundary. Without this, a constraint one character
      // too strict passes every test above.
      const atLimit = `${RUN_PREFIX}${'x'.repeat(VENDOR_NAME_MAX_LENGTH - RUN_PREFIX.length)}`

      expect(atLimit).toHaveLength(VENDOR_NAME_MAX_LENGTH)
      await expect(
        writer.query('insert into vendor (display_name) values ($1)', [atLimit]),
      ).resolves.toBeDefined()
    })

    it('refuses a missing name', async () => {
      await expect(
        writer.query('insert into vendor (display_name) values (null)'),
      ).rejects.toMatchObject({ code: NOT_NULL_VIOLATION })
    })
  })

  describe('the normalised key', () => {
    it('is derived, not supplied', async () => {
      // `generated always ... stored`: the database refuses a caller who tries
      // to write it, so the key cannot disagree with the name it came from.
      await expect(
        writer.query('insert into vendor (display_name, normalised_name) values ($1, $2)', [
          named('Acme Plumbing'),
          'something else entirely',
        ]),
      ).rejects.toMatchObject({ code: GENERATED_ALWAYS })
    })

    it('refuses a second spelling of a name already stored', async () => {
      const display = named('Evergreen Gardens')
      await writer.query('insert into vendor (display_name) values ($1)', [display])

      await expect(
        writer.query('insert into vendor (display_name) values ($1)', [
          `  ${display.toUpperCase()}   `,
        ]),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION })
    })

    it('keeps genuinely different names apart', async () => {
      // The other direction, and the one that matters most: a normalisation
      // aggressive enough to merge these would erase a real vendor's history.
      // `similarity` puts these at 0.75 -- close enough to rank as a suggestion,
      // nowhere near close enough to be the same row.
      await writer.query('insert into vendor (display_name) values ($1)', [named('Wintergreen Ltd')])

      await expect(
        writer.query('insert into vendor (display_name) values ($1)', [named('Wintergreen Limited')]),
      ).resolves.toBeDefined()
    })
  })

  describe('the application and the database normalise identically', () => {
    // The parity that keeps one vendor from becoming two. Every case here is a
    // measured disagreement between the two engines' defaults, not a guess.
    const corpus: [string, string][] = [
      ['plain', 'Evergreen Landscaping'],
      ['mixed case', 'EverGREEN LandSCAPING'],
      ['leading and trailing spaces', '   Evergreen Landscaping   '],
      ['a double space', 'Evergreen  Landscaping'],
      ['a tab', 'Evergreen\tLandscaping'],
      ['a newline', 'Evergreen\nLandscaping'],
      ['a carriage return', 'Evergreen\rLandscaping'],
      ['a vertical tab', 'Evergreen\u000bLandscaping'],
      ['a form feed', 'Evergreen\u000cLandscaping'],
      ['NBSP, which Postgres does not call whitespace', 'Evergreen\u00a0Landscaping'],
      ['narrow NBSP, likewise', 'Evergreen\u202fLandscaping'],
      ['every separator at once', '\u00a0 Evergreen \t\n\u202f Landscaping\u00a0 '],
      ['Turkish dotted I, which the two fold differently', '\u0130stanbul Plumbing'],
      ['Greek final sigma, likewise', '\u03a3\u03a3 Services'],
      ['sharp s', 'Stra\u00dfe Services'],
      ['an umlaut', '\u00c4kta Bygg'],
      ['a zero-width space, which neither treats as whitespace', 'Ever\u200bgreen'],
      ["digits and punctuation", "O'Brien & Sons, Ltd. #42"],
    ]

    it.each(corpus)('agrees on %s', async (_label, raw) => {
      const { rows } = await writer.query('select vendor_normalised_name($1) as normalised', [raw])

      expect(rows[0].normalised).toBe(normaliseVendorName(raw))
    })

    it('has a corpus that would notice a disagreement', async () => {
      // A parity suite proves nothing if both sides are the identity function.
      // At least one case must actually change under normalisation.
      const changed = corpus.filter(([, raw]) => normaliseVendorName(raw) !== raw)

      expect(changed.length).toBeGreaterThan(10)
    })

    it('names every separator it folds, so the two lists cannot drift apart', () => {
      expect(NAME_FOLD_WHITESPACE).toContain(' ')
      expect(NAME_FOLD_WHITESPACE).toContain('\u00a0')
      expect(NAME_FOLD_WHITESPACE).toContain('\u202f')
      expect(NAME_FOLD_WHITESPACE).not.toContain('\u200b')
    })

    it('stores the same key the application would compute', async () => {
      const display = named('  Cedar\u00a0Creek   ROOFING ')
      const { rows } = await writer.query(
        'insert into vendor (display_name) values ($1) returning normalised_name',
        [display],
      )

      expect(rows[0].normalised_name).toBe(normaliseVendorName(display))
    })
  })

  describe('the role split (AD-4)', () => {
    it('lets the reader read a vendor, because FR-6 compares against history', async () => {
      const display = named('Northside Electric')
      await writer.query('insert into vendor (display_name) values ($1)', [display])

      const { rows } = await reader.query('select display_name from vendor where display_name = $1', [
        display,
      ])

      expect(rows).toHaveLength(1)
    })

    it('refuses the reader an insert', async () => {
      // Connected as the role, not read out of information_schema. The catalog
      // says what was intended; being refused proves what is true.
      await expect(
        reader.query('insert into vendor (display_name) values ($1)', [named('Forged Vendor')]),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
    })

    it('refuses the reader an update', async () => {
      await expect(
        reader.query('update vendor set display_name = $1', [named('Renamed')]),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
    })

    it('refuses the reader a delete', async () => {
      await expect(reader.query('delete from vendor')).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      })
    })
  })

  describe('similarity ranking is available for the queue that comes later', () => {
    it('can score two names', async () => {
      const { rows } = await writer.query(
        "select similarity('Evergreen Landscaping', 'Evergreen Landscape') as near," +
          " similarity('Evergreen Landscaping', 'Acme Plumbing') as far",
      )

      expect(Number(rows[0].near)).toBeGreaterThan(Number(rows[0].far))
      expect(Number(rows[0].far)).toBeLessThan(0.2)
    })

    it('has a unique index on the identity, which is the one that must exist', async () => {
      // The trigram index this used to assert was never reachable: an explicit
      // `similarity(...) >= floor` cannot use one, so the test proved only that
      // an unused object existed. The index that carries a rule is this one.
      const { rows } = await writer.query(
        "select indexdef from pg_indexes where tablename = 'vendor' and indexname = 'vendor_normalised_name_key'",
      )

      expect(rows).toHaveLength(1)
      expect(rows[0].indexdef).toMatch(/unique/i)
    })
  })
})
