/**
 * The vocabulary of an extracted record, and its agreement with the database.
 *
 * The parity tests here read migration 006 rather than restating its lists. A
 * test that restates them proves only that the test agrees with itself, and the
 * drift it is meant to catch — a value accepted here and refused at INSERT,
 * after the document's bytes are already in object storage — would sail through.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  AMOUNT_SCALE,
  AMOUNT_PRECISION,
  DOCUMENT_KINDS,
  DOCUMENT_NUMBER_MAX_LENGTH,
  SUPPORTED_CURRENCIES,
  VENDOR_NAME_MAX_LENGTH,
  isDocumentKind,
  isSupportedCurrency,
} from './record'

const migration = (): string =>
  readFileSync(join(process.cwd(), 'migrations', '006_extraction.sql'), 'utf8')

/** Quoted values inside a named `check (... in (...))` clause. */
function declaredList(constraint: string): string[] {
  const clause = new RegExp(`${constraint} check \\(\\s*[a-z_]+ in \\(([^)]*)\\)`).exec(migration())

  expect(clause, `migration 006 no longer declares ${constraint}`).not.toBeNull()

  const values = Array.from(clause![1]!.matchAll(/'([^']+)'/g), (m) => m[1]).filter(
    (v): v is string => v !== undefined,
  )

  // Without this the comparison below can pass by comparing nothing to nothing —
  // the exact shape that shipped twice during story 1.4.
  expect(values.length, `${constraint} parsed to an empty list`).toBeGreaterThan(0)

  return values
}

function declaredLength(constraint: string): { min: number; max: number } {
  const clause = new RegExp(
    `${constraint} check \\(\\s*[a-z_]+ is null or char_length\\([a-z_]+\\) between (\\d+) and (\\d+)`,
  ).exec(migration())

  expect(clause, `migration 006 no longer declares ${constraint}`).not.toBeNull()

  return { min: Number(clause![1]), max: Number(clause![2]) }
}

describe('the extracted record vocabulary', () => {
  describe('agreement with migration 006', () => {
    it('publishes exactly the document kinds the database admits', () => {
      expect([...DOCUMENT_KINDS].sort()).toEqual(declaredList('extraction_kind_known').sort())
    })

    it('publishes exactly the currencies the database admits', () => {
      expect([...SUPPORTED_CURRENCIES].sort()).toEqual(
        declaredList('extraction_currency_supported').sort(),
      )
    })

    it('caps the vendor name where the database caps it', () => {
      const declared = declaredLength('extraction_vendor_name_length')

      expect(VENDOR_NAME_MAX_LENGTH).toBe(declared.max)
      expect(declared.min).toBe(1)
    })

    it('caps the document number where the database caps it', () => {
      const declared = declaredLength('extraction_document_number_length')

      expect(DOCUMENT_NUMBER_MAX_LENGTH).toBe(declared.max)
      expect(declared.min).toBe(1)
    })

    it('matches the numeric precision and scale of the amount column', () => {
      const declared = /total_amount\s+numeric\((\d+),(\d+)\)/.exec(migration())

      expect(declared, 'migration 006 no longer declares total_amount as numeric(p,s)').not.toBeNull()
      expect(AMOUNT_PRECISION).toBe(Number(declared![1]))
      expect(AMOUNT_SCALE).toBe(Number(declared![2]))
    })

    it('reads a migration that actually contains the constraints', () => {
      // The guard on every parity test above. If the file moved or was emptied,
      // each regex would match nothing and the failures would point at the
      // constants rather than at the missing source.
      const sql = migration()

      expect(sql.length).toBeGreaterThan(500)
      expect(sql).toContain('create table extraction')
    })
  })

  describe('membership tests', () => {
    it('publishes a non-empty vocabulary, so the cases below are not zero cases', () => {
      // `it.each([])` generates no tests at all and reports nothing missing.
      // Without this, an empty vocabulary would make every parameterised test
      // below silently disappear while the file still read green.
      expect(DOCUMENT_KINDS.length).toBeGreaterThanOrEqual(4)
      expect(SUPPORTED_CURRENCIES.length).toBeGreaterThanOrEqual(1)
    })

    it.each([...DOCUMENT_KINDS])('recognises %s as a document kind', (kind) => {
      expect(isDocumentKind(kind)).toBe(true)
    })

    it.each([...SUPPORTED_CURRENCIES])('recognises %s as a currency', (currency) => {
      expect(isSupportedCurrency(currency)).toBe(true)
    })

    it.each([
      ['an unknown kind', 'receipt'],
      ['an empty string', ''],
      ['a differently-cased member', 'Invoice'],
      ['a member with whitespace', ' invoice'],
    ])('rejects %s', (_label, value) => {
      expect(isDocumentKind(value)).toBe(false)
    })

    it.each([['toString'], ['constructor'], ['hasOwnProperty'], ['__proto__']])(
      'rejects the inherited property %s',
      (value) => {
        // `'toString' in someObject` is true. A membership test written as an
        // object index would accept every one of these as a document kind —
        // the trap `core/auth/sign-in-feedback.ts` documents avoiding.
        expect(isDocumentKind(value)).toBe(false)
        expect(isSupportedCurrency(value)).toBe(false)
      },
    )

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a number', 1],
      ['an object', {}],
      ['an array', ['invoice']],
    ])('rejects %s without throwing', (_label, value) => {
      expect(isDocumentKind(value)).toBe(false)
      expect(isSupportedCurrency(value)).toBe(false)
    })
  })

  describe('the shape of the vocabulary itself', () => {
    it('cannot be mutated by a caller', () => {
      // A caller pushing onto this list would widen what the application accepts
      // while the database's constraint stayed where it was.
      expect(Object.isFrozen(DOCUMENT_KINDS)).toBe(true)
      expect(Object.isFrozen(SUPPORTED_CURRENCIES)).toBe(true)
    })

    it('leaves room for cents and for a real association ledger', () => {
      expect(AMOUNT_SCALE).toBe(2)
      expect(AMOUNT_PRECISION - AMOUNT_SCALE).toBeGreaterThanOrEqual(9)
    })
  })
})
