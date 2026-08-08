/**
 * A rectangle of strings into candidate records, against a declared contract.
 *
 * The contract exists because "parsed deterministically" needs a defined input,
 * and nothing upstream defined one. It is the pilot's, not a universal one, so
 * the refusal when a file does not match has to name what was expected — a
 * treasurer whose export is rejected needs to know what to export instead.
 */

import { describe, expect, it } from 'vitest'

import { REQUIRED_HEADERS, TABULAR_PROBLEMS, readTable } from './tabular'

const header = 'date,description,amount'
const one = `${header}\n2026-06-01,Evergreen Landscaping,1450.00`

const recordsOf = (text: string) => {
  const result = readTable(text)
  if (!result.ok) throw new Error(`expected records, got ${JSON.stringify(result.problems)}`)
  return result.records
}

describe('readTable', () => {
  describe('the ordinary case', () => {
    it('reads one record per data row', () => {
      const records = recordsOf(
        `${header}\n2026-06-01,Landscaping,1450.00\n2026-06-02,Pool Service,820.50`,
      )

      expect(records).toHaveLength(2)
    })

    it('maps each column to the field it stands for', () => {
      expect(recordsOf(one)[0]).toEqual({
        documentKind: 'statement',
        vendorName: 'Evergreen Landscaping',
        documentNumber: null,
        issuedOn: '2026-06-01',
        totalAmount: '1450.00',
        unitReference: null,
        currency: 'USD',
      })
    })

    it('reads a credit as a negative amount', () => {
      // Bank feeds carry both directions; the sign rule was settled in the
      // migration and this is where it first matters.
      expect(recordsOf(`${header}\n2026-06-01,Refund,-250.00`)[0]?.totalAmount).toBe('-250.00')
    })

    it('reads hundreds of rows, which is what a bank feed is', () => {
      const rows = Array.from(
        { length: 250 },
        (_, i) => `2026-06-01,Line ${i},${i}.00`,
      ).join('\n')

      expect(recordsOf(`${header}\n${rows}`)).toHaveLength(250)
    })
  })

  describe('the optional columns', () => {
    it('takes a reference as the document number', () => {
      const records = recordsOf(`${header},reference\n2026-06-01,Landscaping,1450.00,INV-4471`)

      expect(records[0]?.documentNumber).toBe('INV-4471')
    })

    it('takes a type as the document kind', () => {
      const records = recordsOf(`${header},type\n2026-06-01,Landscaping,1450.00,invoice`)

      expect(records[0]?.documentKind).toBe('invoice')
    })

    it('defaults the kind to statement when no type column is present', () => {
      expect(recordsOf(one)[0]?.documentKind).toBe('statement')
    })

    it('refuses a type outside the known set rather than defaulting past it', () => {
      const result = readTable(`${header},type\n2026-06-01,Landscaping,1450.00,receipt`)

      expect(result.ok).toBe(false)
    })
  })

  describe('the header row', () => {
    it.each([
      ['different case', 'DATE,Description,AMOUNT'],
      ['surrounding spaces', ' date , description , amount '],
      ['both', ' Date ,DESCRIPTION, Amount '],
    ])('accepts headers with %s, since neither carries information', (_label, headerRow) => {
      expect(readTable(`${headerRow}\n2026-06-01,Landscaping,1450.00`).ok).toBe(true)
    })

    it('ignores columns it does not know, because every real export has them', () => {
      const wide =
        'posted,date,description,amount,balance,running total,category,check no'
      const row = '2026-06-02,2026-06-01,Landscaping,1450.00,10450.00,10450.00,Grounds,1041'

      expect(recordsOf(`${wide}\n${row}`)[0]?.vendorName).toBe('Landscaping')
    })

    it.each([
      ['date', 'description,amount\nLandscaping,1450.00'],
      ['description', 'date,amount\n2026-06-01,1450.00'],
      ['amount', 'date,description\n2026-06-01,Landscaping'],
    ])('refuses a file missing the %s column', (_missing, text) => {
      expect(readTable(text).ok).toBe(false)
    })

    it('names the headers it expected when one is missing', () => {
      // A treasurer whose export is refused needs to know what to export.
      const result = readTable('description,amount\nLandscaping,1450.00')

      expect(result.ok).toBe(false)
      const problems = result.ok ? [] : result.problems
      expect(problems.some((p) => p.expected?.includes('date'))).toBe(true)
    })

    it('refuses duplicate headers rather than picking one arbitrarily', () => {
      // Silently taking the first or last is how a figure comes from the wrong
      // column, with nothing to show it happened.
      const result = readTable(`date,description,amount,amount\n2026-06-01,L,1.00,2.00`)

      expect(result.ok).toBe(false)
    })

    it('refuses a header-only file rather than reporting an empty success', () => {
      const result = readTable(header)

      expect(result.ok).toBe(false)
    })
  })

  describe('one bad row fails the document', () => {
    it('stores nothing when a single row is malformed', () => {
      // "No partial or best-effort record is stored" fails in exactly this way
      // if it fails at all: 199 good rows and one bad one.
      const rows = ['2026-06-01,Good,1.00', '2026-06-02,Bad,$2.00', '2026-06-03,Good,3.00']

      const result = readTable(`${header}\n${rows.join('\n')}`)

      expect(result.ok).toBe(false)
    })

    it('reports which row failed, so the file can be corrected', () => {
      const result = readTable(`${header}\n2026-06-01,Good,1.00\n2026-06-02,Bad,$2.00`)

      const problems = result.ok ? [] : result.problems
      expect(problems.some((p) => p.row === 2)).toBe(true)
    })

    it.each([
      ['an impossible date', '2026-02-30,Landscaping,1450.00'],
      ['a currency symbol', '2026-06-01,Landscaping,$1450.00'],
      ['a third decimal place', '2026-06-01,Landscaping,1450.005'],
      ['a blank description', '2026-06-01,   ,1450.00'],
      ['thousands separators', '2026-06-01,Landscaping,"1,450.00"'],
    ])('refuses a row with %s', (_label, row) => {
      expect(readTable(`${header}\n${row}`).ok).toBe(false)
    })
  })

  describe('the shape of a refusal', () => {
    it('draws every reason from the closed set', () => {
      const result = readTable('description,amount\nLandscaping,1450.00')

      expect(result.ok).toBe(false)
      for (const problem of result.ok ? [] : result.problems) {
        expect(TABULAR_PROBLEMS).toContain(problem.reason)
      }
    })

    it('passes a CSV failure through rather than reporting it as a contract failure', () => {
      const result = readTable('date,description,amount\n"unterminated')

      expect(result.ok).toBe(false)
    })

    it.each([
      ['an empty string', ''],
      ['whitespace', '   '],
      ['a single quote', '"'],
    ])('returns a refusal for %s instead of throwing', (_label, text) => {
      expect(() => readTable(text)).not.toThrow()
      expect(readTable(text).ok).toBe(false)
    })
  })

  describe('the declared contract', () => {
    it('requires exactly the three columns the tests rely on', () => {
      expect([...REQUIRED_HEADERS].sort()).toEqual(['amount', 'date', 'description'])
    })
  })
})
