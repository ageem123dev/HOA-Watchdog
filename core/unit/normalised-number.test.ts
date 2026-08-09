/**
 * That this folding is migration 011's folding, and not JavaScript's idea of it.
 *
 * A second statement of a shape is only safe when something fails on
 * disagreement — migration 007's note, and this file is that something. It reads
 * `011_unit.sql`, extracts the character set `unit_normalised_number()` actually
 * folds, and compares it with the one here.
 *
 * The specific disagreement it exists to catch already happened once.
 * `core/payment/resolve-line.ts`'s `fold` collapses `\s`, which matches U+3000;
 * the migration's set does not. Using `fold` to detect duplicate units in a roll
 * therefore merged `4　B` and `4 B` and **refused a document Postgres would have
 * accepted as two units**.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { fold } from '../payment/resolve-line'
import { UNIT_WHITESPACE, normaliseUnitNumber } from './normalised-number'

const MIGRATION = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations', '011_unit.sql'),
  'utf8',
)

describe('the character set matches the migration', () => {
  /** Every `chr(N)` the migration folds, plus the literal space it also folds. */
  const fromMigration = (): string[] => {
    const codes = [...MIGRATION.matchAll(/chr\((\d+)\)/g)].map((match) => Number(match[1]))
    expect(codes.length, 'no chr() calls found — the migration shape changed').toBeGreaterThan(0)

    return [' ', ...new Set(codes.map((code) => String.fromCharCode(code)))].sort()
  }

  it('folds exactly what unit_normalised_number folds', () => {
    expect([...UNIT_WHITESPACE].sort()).toEqual(fromMigration())
  })

  it('found a real set in the migration, so the comparison means something', () => {
    // The control. If the regex stopped matching, `fromMigration()` would return
    // just a space and the assertion above could pass against a one-element set.
    expect(fromMigration().length).toBe(8)
  })

  it('does not fold U+3000, which the migration does not', () => {
    // Stated on its own because it is the difference that caused a defect, and
    // an equality assertion alone would not say which direction went wrong.
    expect([...UNIT_WHITESPACE]).not.toContain('\u3000')
    expect(MIGRATION).not.toContain('chr(12288)')
  })
})

describe('normaliseUnitNumber', () => {
  it('folds case, trims the ends and collapses internal runs', () => {
    expect(normaliseUnitNumber('  4B  ')).toBe('4b')
    expect(normaliseUnitNumber('Building C,   Unit 12')).toBe('building c, unit 12')
  })

  it('treats every character in the set as whitespace', () => {
    for (const character of UNIT_WHITESPACE) {
      expect(normaliseUnitNumber(`4${character}B`)).toBe('4 b')
    }
  })

  it('leaves leading zeroes alone, as migration 011 decided', () => {
    // Zero-padding is a real convention in some associations, so `04B` and `4B`
    // are two units. Folding them is a data decision, not a schema one.
    expect(normaliseUnitNumber('04B')).not.toBe(normaliseUnitNumber('4B'))
  })

  it('keeps apart what the database keeps apart, where fold does not', () => {
    // The regression. `fold` merges these two; the database stores two units,
    // so the roll reader must see two as well or it refuses a valid document.
    expect(fold('4\u3000B')).toBe(fold('4 B'))

    expect(normaliseUnitNumber('4\u3000B')).not.toBe(normaliseUnitNumber('4 B'))
  })

  it('still merges the spellings the database merges', () => {
    // The other direction, so the fix is not simply "fold nothing".
    expect(normaliseUnitNumber('4B')).toBe(normaliseUnitNumber('  4b '))
    expect(normaliseUnitNumber('4\u00a0B')).toBe(normaliseUnitNumber('4 B'))
  })
})
