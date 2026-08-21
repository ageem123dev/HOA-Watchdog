/**
 * A rectangle of strings into candidate records, against a declared contract.
 *
 * The contract exists because "parsed deterministically" needs a defined input,
 * and nothing upstream defined one. It is the pilot's, not a universal one, so
 * the refusal when a file does not match has to name what was expected — a
 * treasurer whose export is rejected needs to know what to export instead.
 */

import { describe, expect, it } from 'vitest'

import type { DocumentKind } from './record'
import { REQUIRED_HEADERS, TABULAR_PROBLEMS, readRows, readTable } from './tabular'

const header = 'date,description,amount'
const one = `${header}\n2026-06-01,Evergreen Landscaping,1450.00`

const recordsOf = (text: string, documentKind: DocumentKind = 'statement') => {
  const result = readTable(text, documentKind)
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

    /**
     * These three replace the retired per-row `type` tests, and the replacement
     * is deliberate rather than a deletion. What stood here was
     * `'takes a type as the document kind'`,
     * `'defaults the kind to statement when no type column is present'` and
     * `'refuses a type outside the known set rather than defaulting past it'` —
     * all three about a column story 5.2 abolished. The behaviour is gone, so
     * the assertions become that it is gone.
     */
    it('takes the document kind from the caller, not from a column', () => {
      expect(recordsOf(one, 'invoice')[0]?.documentKind).toBe('invoice')
    })

    it('refuses a file that still carries a type column, rather than ignoring it', () => {
      const result = readTable(`${header},type\n2026-06-01,Landscaping,1450.00,invoice`, 'invoice')

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.problems[0]?.reason).toBe('kind-is-not-a-column')
    })

    it('refuses a kind outside the known set rather than defaulting past it', () => {
      expect(readTable(one, 'receipt' as never).ok).toBe(false)
    })
  })

  describe('the header row', () => {
    it.each([
      ['different case', 'DATE,Description,AMOUNT'],
      ['surrounding spaces', ' date , description , amount '],
      ['both', ' Date ,DESCRIPTION, Amount '],
    ])('accepts headers with %s, since neither carries information', (_label, headerRow) => {
      expect(readTable(`${headerRow}\n2026-06-01,Landscaping,1450.00`, 'statement').ok).toBe(true)
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
      expect(readTable(text, 'statement').ok).toBe(false)
    })

    it('names the headers it expected when one is missing', () => {
      // A treasurer whose export is refused needs to know what to export.
      const result = readTable('description,amount\nLandscaping,1450.00', 'statement')

      expect(result.ok).toBe(false)
      const problems = result.ok ? [] : result.problems
      expect(problems.some((p) => p.expected?.includes('date'))).toBe(true)
    })

    it('refuses duplicate headers rather than picking one arbitrarily', () => {
      // Silently taking the first or last is how a figure comes from the wrong
      // column, with nothing to show it happened.
      const result = readTable(`date,description,amount,amount\n2026-06-01,L,1.00,2.00`, 'statement')

      expect(result.ok).toBe(false)
    })

    it('refuses a header-only file rather than reporting an empty success', () => {
      const result = readTable(header, 'statement')

      expect(result.ok).toBe(false)
    })
  })

  describe('one bad row fails the document', () => {
    it('stores nothing when a single row is malformed', () => {
      // "No partial or best-effort record is stored" fails in exactly this way
      // if it fails at all: 199 good rows and one bad one.
      const rows = ['2026-06-01,Good,1.00', '2026-06-02,Bad,$2.00', '2026-06-03,Good,3.00']

      const result = readTable(`${header}\n${rows.join('\n')}`, 'statement')

      expect(result.ok).toBe(false)
    })

    it('reports which row failed, so the file can be corrected', () => {
      const result = readTable(`${header}\n2026-06-01,Good,1.00\n2026-06-02,Bad,$2.00`, 'statement')

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
      expect(readTable(`${header}\n${row}`, 'statement').ok).toBe(false)
    })
  })

  describe('the shape of a refusal', () => {
    it('draws every reason from the closed set', () => {
      const result = readTable('description,amount\nLandscaping,1450.00', 'statement')

      expect(result.ok).toBe(false)
      for (const problem of result.ok ? [] : result.problems) {
        expect(TABULAR_PROBLEMS).toContain(problem.reason)
      }
    })

    it('passes a CSV failure through rather than reporting it as a contract failure', () => {
      const result = readTable('date,description,amount\n"unterminated', 'statement')

      expect(result.ok).toBe(false)
    })

    it.each([
      ['an empty string', ''],
      ['whitespace', '   '],
      ['a single quote', '"'],
    ])('returns a refusal for %s instead of throwing', (_label, text) => {
      expect(() => readTable(text, 'statement')).not.toThrow()
      expect(readTable(text, 'statement').ok).toBe(false)
    })
  })

  describe('the declared contract', () => {
    it('requires exactly the three columns the tests rely on', () => {
      expect([...REQUIRED_HEADERS].sort()).toEqual(['amount', 'date', 'description'])
    })
  })
})

/** One rectangle, reused below, so the *declaration* is the only variable. */
const HEADERS = ['date', 'description', 'amount', 'unit', 'cycle', 'year']
const ROW = ['2026-01-15', '4B Holder', '3600.00', '4B', 'monthly', '2026']
const ROWS = [HEADERS, ROW]

describe('the kind the caller declares', () => {
  /**
   * **The whole story in one test.** The same bytes, read twice, meaning two
   * different things — which is only possible if the declaration is doing the
   * work. If this passes with the parameter ignored, nothing else here matters.
   */
  it('reads the same bytes as a roll or as a statement, according to what it is told', () => {
    const asRoll = readRows(ROWS, 'assessment_roll')
    const asStatement = readRows(ROWS, 'statement')

    expect(asRoll.ok).toBe(true)
    expect(asStatement.ok).toBe(true)
    if (!asRoll.ok || !asStatement.ok) return

    expect(asRoll.rollRows).toHaveLength(1)
    expect(asRoll.records[0]?.documentKind).toBe('assessment_roll')

    // The same rectangle, declared otherwise, creates no units and no tenures.
    expect(asStatement.rollRows).toHaveLength(0)
    expect(asStatement.records[0]?.documentKind).toBe('statement')
  })

  /**
   * `unit` is read only for the kinds that are about a unit. That gate used to
   * consult the row; it must now consult the declaration.
   */
  it('reads the unit column for a declared deposit and ignores it for an invoice', () => {
    const rows = [
      ['date', 'description', 'amount', 'unit'],
      ['2026-01-15', 'A Payer', '100.00', '4B'],
    ]

    const asDeposit = readRows(rows, 'deposit')
    const asInvoice = readRows(rows, 'invoice')

    expect(asDeposit.ok && asDeposit.records[0]?.unitReference).toBe('4B')
    expect(asInvoice.ok && asInvoice.records[0]?.unitReference).toBeNull()
  })

  /**
   * The roll's own columns are demanded of a document that *is* a roll. That
   * check used to scan the rows for one; it must now read the declaration, or a
   * roll exported without `year` reports every row as defective instead of
   * naming the column.
   */
  it('demands the roll columns of a declared roll, and not of anything else', () => {
    const rows = [
      ['date', 'description', 'amount', 'unit'],
      ['2026-01-15', '4B Holder', '3600.00', '4B'],
    ]

    const asRoll = readRows(rows, 'assessment_roll')
    expect(asRoll.ok).toBe(false)
    if (asRoll.ok) return
    expect(asRoll.problems[0]?.reason).toBe('missing-headers')
    expect(asRoll.problems[0]?.expected).toEqual(expect.arrayContaining(['cycle', 'year']))

    // The same file as a deposit is within contract: it is not a roll, so the
    // roll's columns are not its to supply.
    expect(readRows(rows, 'deposit').ok).toBe(true)
  })

  /**
   * AC2. A `type` column is **refused by name**, not dropped.
   *
   * Ignoring it is the tempting shape and it is the wrong one: a treasurer
   * whose file says `type,deposit` and who is served a statement has been told
   * their column worked. The same argument refused a body `actorId` in 5.1c and
   * an `associationId` in 5.1b — a caller that says something must be answered,
   * not quietly overruled.
   */
  it('refuses a file that still carries a type column, naming it', () => {
    const rows = [
      ['date', 'description', 'amount', 'type'],
      ['2026-01-15', 'A Payer', '100.00', 'deposit'],
    ]

    const result = readRows(rows, 'statement')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems[0]?.reason).toBe('kind-is-not-a-column')
    expect(result.problems[0]?.expected).toEqual(['type'])
  })

  /** Whatever the declaration, an unrecognised one is not a document kind. */
  it.each([
    ['an unknown kind', 'ledger'],
    ['an empty kind', ''],
    ['a blank kind', '   '],
  ])('refuses %s rather than reading the file', (_label, kind) => {
    const result = readRows(ROWS, kind as never)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems[0]?.reason).toBe('unknown-kind')
  })

  /**
   * The inverse of the block above: every kind the contract publishes is
   * accepted, so "refuses an unknown kind" is not passing because it refuses
   * every kind.
   */
  it.each([['statement'], ['invoice'], ['deposit'], ['other']])(
    'accepts %s, a kind the contract publishes',
    (kind) => {
      const rows = [
        ['date', 'description', 'amount'],
        ['2026-01-15', 'A Counterparty', '100.00'],
      ]

      expect(readRows(rows, kind as never).ok).toBe(true)
    },
  )
})
