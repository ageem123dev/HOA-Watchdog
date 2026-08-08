/**
 * What may become a record, and what a treasurer is told when a document cannot.
 *
 * The bias throughout is refusal over repair. A validator that trims, truncates,
 * strips a currency symbol, or rounds a third decimal place produces a record
 * that looks clean and says something the document did not. On an association's
 * ledger that is worse than a refusal, because nobody goes looking for it.
 */

import { describe, expect, it } from 'vitest'

import { DOCUMENT_KINDS, VENDOR_NAME_MAX_LENGTH } from './record'
import { PROBLEM_REASONS, UNREADABLE_MESSAGE, validate } from './validate'

const wellFormed = {
  documentKind: 'invoice',
  vendorName: 'Evergreen Landscaping',
  documentNumber: 'INV-4471',
  issuedOn: '2026-06-01',
  totalAmount: '1450.00',
  unitReference: null,
  currency: 'USD',
}

const candidate = (overrides: Record<string, unknown> = {}) => ({ ...wellFormed, ...overrides })

/** The fields that failed, for readable assertions. */
const fieldsOf = (result: ReturnType<typeof validate>): string[] =>
  result.ok ? [] : result.problems.map((p) => p.field).sort()

describe('validate', () => {
  describe('the ordinary case', () => {
    it('accepts a well-formed candidate and returns it as a record', () => {
      const result = validate(candidate())

      expect(result.ok).toBe(true)
      expect(result.ok && result.record).toEqual(wellFormed)
    })

    it('accepts a document with only the fields it actually has', () => {
      const sparse = {
        documentKind: 'statement',
        vendorName: null,
        documentNumber: null,
        issuedOn: null,
        totalAmount: null,
        unitReference: null,
        currency: 'USD',
      }

      const result = validate(sparse)

      expect(result.ok && result.record).toEqual(sparse)
    })

    it.each([...DOCUMENT_KINDS])('accepts the document kind %s', (documentKind) => {
      expect(validate(candidate({ documentKind })).ok).toBe(true)
    })
  })

  describe('money', () => {
    it.each([
      ['a plain amount', '1450.00'],
      ['a credit', '-250.00'],
      ['zero', '0.00'],
      ['one cent', '0.01'],
      ['no decimal part', '1450'],
      ['one decimal place', '1450.5'],
      ['the largest the column admits', '99999999999.99'],
    ])('accepts %s', (_label, totalAmount) => {
      expect(validate(candidate({ totalAmount })).ok).toBe(true)
    })

    it('refuses a third decimal place rather than letting the column round it', () => {
      // numeric(14,2) stores 1.005 as 1.01 without complaint. No database
      // constraint can catch that — the column has already coerced the value
      // before any constraint sees it — so it has to be refused here or the
      // schema invents a cent.
      const result = validate(candidate({ totalAmount: '1.005' }))

      expect(result.ok).toBe(false)
      expect(fieldsOf(result)).toEqual(['totalAmount'])
    })

    it('refuses an amount past the precision the column can hold', () => {
      expect(validate(candidate({ totalAmount: '1000000000000.00' })).ok).toBe(false)
    })

    it.each([
      ['a currency symbol', '$1450.00'],
      ['thousands separators', '1,450.00'],
      ['a European decimal comma', '1450,00'],
      ['spaces', '1 450.00'],
      ['a leading plus', '+1450.00'],
      ['trailing text', '1450.00 USD'],
      ['an empty string', ''],
      ['a lone minus', '-'],
      ['a lone point', '.'],
      ['exponent notation', '1.45e3'],
    ])('refuses %s rather than reinterpreting it', (_label, totalAmount) => {
      // Stripping a separator is how 1,450 becomes 1450 in one locale and 1.450
      // in another. The parser is the wrong place to guess which.
      expect(validate(candidate({ totalAmount })).ok).toBe(false)
    })

    it('refuses a JS number, which has already lost precision before arriving', () => {
      expect(validate(candidate({ totalAmount: 1450.0 })).ok).toBe(false)
    })
  })

  describe('dates', () => {
    it.each([
      ['a leap day that exists', '2024-02-29'],
      ['the first of a month', '2026-06-01'],
      ['the last day of a year', '2026-12-31'],
    ])('accepts %s', (_label, issuedOn) => {
      expect(validate(candidate({ issuedOn })).ok).toBe(true)
    })

    it.each([
      ['a day that does not exist', '2026-02-30'],
      ['a leap day in a non-leap year', '2026-02-29'],
      ['a thirteenth month', '2026-13-01'],
      ['a zeroth day', '2026-06-00'],
      ['US ordering', '06/01/2026'],
      ['European ordering', '01.06.2026'],
      ['a datetime', '2026-06-01T00:00:00Z'],
      ['a two-digit year', '26-06-01'],
      ['an empty string', ''],
    ])('refuses %s', (_label, issuedOn) => {
      expect(validate(candidate({ issuedOn })).ok).toBe(false)
    })
  })

  describe('text fields', () => {
    it('accepts a vendor name at the limit', () => {
      expect(validate(candidate({ vendorName: 'v'.repeat(VENDOR_NAME_MAX_LENGTH) })).ok).toBe(true)
    })

    it('refuses an over-long vendor name rather than truncating it', () => {
      // Truncation stores a different vendor than the document names, and does
      // it in a way that reads as a successful extraction.
      const result = validate(candidate({ vendorName: 'v'.repeat(VENDOR_NAME_MAX_LENGTH + 1) }))

      expect(result.ok).toBe(false)
      expect(fieldsOf(result)).toEqual(['vendorName'])
    })

    it('refuses a whitespace-only vendor name rather than treating it as absent', () => {
      // null means "this document has no vendor". Quietly converting a failed
      // parse into null would be indistinguishable from that truth.
      expect(validate(candidate({ vendorName: '   ' })).ok).toBe(false)
    })

    it('refuses an empty vendor name', () => {
      expect(validate(candidate({ vendorName: '' })).ok).toBe(false)
    })

    it('refuses an over-long document number', () => {
      expect(validate(candidate({ documentNumber: 'n'.repeat(65) })).ok).toBe(false)
    })
  })

  describe('kind and currency', () => {
    it('refuses an unknown document kind', () => {
      expect(validate(candidate({ documentKind: 'receipt' })).ok).toBe(false)
    })

    it('accepts a lower-case currency, since case carries no information', () => {
      const result = validate(candidate({ currency: 'usd' }))

      expect(result.ok).toBe(true)
      expect(result.ok && result.record.currency).toBe('USD')
    })

    it('refuses an unsupported currency', () => {
      expect(validate(candidate({ currency: 'EUR' })).ok).toBe(false)
    })
  })

  describe('the shape of a refusal', () => {
    it('reports every problem at once, not one per attempt', () => {
      const result = validate(
        candidate({ documentKind: 'receipt', totalAmount: '$1', issuedOn: '2026-02-30' }),
      )

      expect(fieldsOf(result)).toEqual(['documentKind', 'issuedOn', 'totalAmount'])
    })

    it('draws every reason from the closed set, never free text', () => {
      const result = validate({ documentKind: 'x', vendorName: '', currency: 'ZZZ' })

      expect(result.ok).toBe(false)
      for (const problem of result.ok ? [] : result.problems) {
        expect(PROBLEM_REASONS).toContain(problem.reason)
        expect(Object.keys(problem).sort()).toEqual(['field', 'reason'])
      }
    })

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'not a record'],
      ['a number', 7],
      ['an array', []],
      ['an empty object', {}],
      ['a prototype-pollution attempt', JSON.parse('{"__proto__":{"polluted":true}}')],
    ])('returns a refusal for %s instead of throwing', (_label, input) => {
      expect(() => validate(input)).not.toThrow()
      expect(validate(input).ok).toBe(false)
    })

    it('does not pollute Object.prototype', () => {
      validate(JSON.parse('{"__proto__":{"polluted":true}}'))

      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })
  })

  describe('what the treasurer reads', () => {
    it('has one sentence for a document that could not be read', () => {
      expect(UNREADABLE_MESSAGE.length).toBeGreaterThan(20)
    })

    it('is distinct from the copy for a file that could not be opened', () => {
      // FR-1's sentence is about a file that would not open — password
      // protected or corrupted. This one is about a file that opened fine and
      // could not be read into figures. Different problems, different next step.
      expect(UNREADABLE_MESSAGE).toBeTruthy()
      expect(UNREADABLE_MESSAGE).not.toContain('password protected')
    })

    it('does not apologise, per the voice in EXPERIENCE.md', () => {
      expect(UNREADABLE_MESSAGE).toBeTruthy()
      expect(UNREADABLE_MESSAGE).not.toMatch(/sorry|apolog|oops/i)
    })

    it('says what to do next', () => {
      expect(UNREADABLE_MESSAGE).toMatch(/upload|check|replace|try/i)
    })
  })
})

describe('a unit reference belongs to a deposit', () => {
  const base = {
    vendorName: null,
    documentNumber: null,
    issuedOn: null,
    totalAmount: '120.00',
    currency: 'USD',
  }

  it('accepts one on a deposit', () => {
    const result = validate({ ...base, documentKind: 'deposit', unitReference: '4B' })

    expect(result.ok).toBe(true)
  })

  it.each(['invoice', 'statement', 'assessment_roll', 'other'])(
    'refuses one on %s',
    (documentKind) => {
      // An invoice pays a vendor and a statement names nobody. Accepting a
      // reference on those would store something no code path resolves, and it
      // would read as a successful extraction.
      const result = validate({ ...base, documentKind, unitReference: '4B' })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.problems).toContainEqual({ field: 'unitReference', reason: 'unknown-value' })
      }
    },
  )

  it('still accepts those kinds without a reference', () => {
    // Beside the cases above: a rule that rejected every non-deposit record
    // would satisfy them and break ingestion entirely.
    expect(validate({ ...base, documentKind: 'invoice', vendorName: 'Acme' }).ok).toBe(true)
  })
})
