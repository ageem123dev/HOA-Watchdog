/**
 * The assessment roll, read off a spreadsheet.
 *
 * Epic 2 built `unit`, `unit_holder`, `unit_membership` and `assessment` across
 * stories 2.1 and 2.2 and never built the path that fills them, so every deposit
 * on a real installation is held `unknown-unit`. This is the producer half of
 * closing that gap: a rectangle of strings into the rows a roll states.
 *
 * **The holder's name is deliberately not `vendorName`.** `holdUnknownVendors`
 * quarantines every distinct non-null `vendorName` a reading produces, so
 * routing a holder through that field would ask a treasurer whether each of
 * their forty owners is a vendor they recognise. The roll gets its own row type
 * for that reason, and the reason is behavioural rather than aesthetic.
 */

import { describe, expect, it } from 'vitest'

import { serialiseCsv } from './csv'
import { readRollRow } from './roll'
import { OPTIONAL_HEADERS, readRows, readTable } from './tabular'

/** A roll table, header row first. `type` is what makes a row a roll row. */
const roll = (rows: readonly (readonly string[])[]) => [
  ['date', 'description', 'amount', 'type', 'unit', 'cycle', 'year'],
  ...rows,
]

/** One ordinary roll row: 4B, held by Jane Smith, owing 3600 a year monthly. */
const JANE = ['2019-03-01', 'Jane Smith', '3600.00', 'assessment_roll', '4B', 'monthly', '2026']

const rollRowsOf = (result: ReturnType<typeof readRows>) => {
  if (!result.ok) {
    throw new Error(`expected a readable table, got ${JSON.stringify(result.problems)}`)
  }
  return result.rollRows
}

const problemsOf = (result: ReturnType<typeof readRows>) => {
  if (result.ok) throw new Error('expected the document to be refused, and it was read')
  return result.problems
}

describe('reading an assessment roll off a table', () => {
  it('carries every column of a roll row into one row', () => {
    const rows = rollRowsOf(readRows(roll([JANE])))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      unitNumber: '4B',
      holderName: 'Jane Smith',
      heldFrom: '2019-03-01',
      annualAmount: '3600.00',
      billingCycle: 'monthly',
      assessmentYear: 2026,
    })
  })

  it('keeps the annual amount as the string the document wrote', () => {
    // Never a number. `3600.00` and `3600` are the same figure and different
    // strings, and the assessment column is numeric(14,2) reached by a decimal
    // string end to end.
    const rows = rollRowsOf(readRows(roll([JANE])))

    expect(rows[0]!.annualAmount).toBe('3600.00')
    expect(typeof rows[0]!.annualAmount).toBe('string')
  })

  it('declares `cycle` and `year` as optional headers', () => {
    // Optional, so a stray column on an invoice export is ignored rather than
    // turning into a refusal of the whole upload — the precedent `unit` set.
    expect(OPTIONAL_HEADERS).toContain('cycle')
    expect(OPTIONAL_HEADERS).toContain('year')
  })

  it('reads a roll written as CSV text, not only as a rectangle', () => {
    const result = readTable(serialiseCsv(roll([JANE])))

    expect(rollRowsOf(result)[0]!.unitNumber).toBe('4B')
  })

  it('survives a round trip through the CSV writer and reader', () => {
    // Reverse-it: serialise the rectangle, parse it back, and the roll rows must
    // be identical. Catches quoting and separator defects an example-based test
    // would not.
    const direct = rollRowsOf(readRows(roll([JANE])))
    const viaText = rollRowsOf(readTable(serialiseCsv(roll([JANE]))))

    // Asserted non-empty first. Comparing two empty lists — or, before the
    // reader existed, two undefined values — is a test that passes by having
    // nothing to say.
    expect(direct).toHaveLength(1)
    expect(viaText).toEqual(direct)
  })
})

describe('which rows become roll rows', () => {
  it('produces none for a document with no roll rows', () => {
    // Every upload goes through this reader. An invoice CSV must come back with
    // an empty list, not a problem.
    const result = readRows([
      ['date', 'description', 'amount', 'type'],
      ['2026-03-01', 'ACME Plumbing', '250.00', 'invoice'],
    ])

    expect(rollRowsOf(result)).toEqual([])
  })

  it('reads only the roll rows when a document mixes kinds', () => {
    const rows = rollRowsOf(
      readRows([
        ['date', 'description', 'amount', 'type', 'unit', 'cycle', 'year'],
        ['2026-03-01', 'ACME Plumbing', '250.00', 'invoice', '', '', ''],
        JANE,
      ]),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.holderName).toBe('Jane Smith')
  })

  it('ignores a populated unit cell on a kind that is not about a unit', () => {
    // This story widened the guard on reading the `unit` column from "a deposit"
    // to a set of kinds. Removing that guard entirely is caught only by story
    // 2.5's deposit suite, so the assertion lives here too, beside the change:
    // `validate` refuses a reference on an invoice, and one invalid row fails
    // the whole document — so an ignored column is the difference between a
    // stray header and a refused upload.
    const result = readRows([
      ['date', 'description', 'amount', 'type', 'unit', 'cycle', 'year'],
      ['2026-03-01', 'ACME Plumbing', '250.00', 'invoice', '4B', 'monthly', '2026'],
    ])

    if (!result.ok) throw new Error(`expected a readable table, got ${JSON.stringify(result.problems)}`)
    expect(result.records[0]!.unitReference).toBeNull()
    expect(result.rollRows).toEqual([])
  })

  it('leaves the extraction records of a roll document alone', () => {
    // The roll rows are additional, not a replacement. The document still says
    // what it said, and `extraction` still records it.
    const result = readRows(roll([JANE]))
    if (!result.ok) throw new Error('expected a readable table')

    expect(result.records).toHaveLength(1)
    expect(result.records[0]!.documentKind).toBe('assessment_roll')
  })

  it('admits a unit reference on a roll row, which validate previously refused', () => {
    // `validate` refused `unitReference` on every kind but `deposit`, and
    // `tabular` read the column only for a deposit — so a roll's unit was null
    // rather than rejected, and asserting `ok` alone would pass against exactly
    // that. The record has to actually carry it.
    const result = readRows(roll([JANE]))
    if (!result.ok) throw new Error(`expected a readable table, got ${JSON.stringify(result.problems)}`)

    expect(result.records[0]!.unitReference).toBe('4B')
  })
})

describe('the columns a roll row cannot do without', () => {
  it('refuses a file whose roll rows have no cycle or year columns', () => {
    const problems = problemsOf(
      readRows([
        ['date', 'description', 'amount', 'type', 'unit'],
        ['2019-03-01', 'Jane Smith', '3600.00', 'assessment_roll', '4B'],
      ]),
    )

    expect(problems[0]!.reason).toBe('missing-headers')
    expect(problems[0]!.expected).toEqual(expect.arrayContaining(['cycle', 'year']))
  })

  it('refuses a roll row with a blank cycle', () => {
    const problems = problemsOf(
      readRows(roll([['2019-03-01', 'Jane Smith', '3600.00', 'assessment_roll', '4B', '', '2026']])),
    )

    expect(problems[0]!.reason).toBe('invalid-row')
    expect(problems[0]!.row).toBe(1)
  })

  it('refuses a roll row with a blank year', () => {
    const problems = problemsOf(
      readRows(
        roll([['2019-03-01', 'Jane Smith', '3600.00', 'assessment_roll', '4B', 'monthly', '']]),
      ),
    )

    expect(problems[0]!.reason).toBe('invalid-row')
  })

  it('refuses a roll row that names no unit', () => {
    const problems = problemsOf(
      readRows(
        roll([['2019-03-01', 'Jane Smith', '3600.00', 'assessment_roll', '   ', 'monthly', '2026']]),
      ),
    )

    expect(problems[0]!.reason).toBe('invalid-row')
  })

  it('refuses a roll row that names nobody', () => {
    const problems = problemsOf(
      readRows(roll([['2019-03-01', '  ', '3600.00', 'assessment_roll', '4B', 'monthly', '2026']])),
    )

    expect(problems[0]!.reason).toBe('invalid-row')
  })
})

describe('the billing cycle', () => {
  it.each(['monthly', 'six_monthly', 'annual'])('accepts %s', (cycle) => {
    const rows = rollRowsOf(
      readRows(roll([['2019-03-01', 'Jane Smith', '3600.00', 'assessment_roll', '4B', cycle, '2026']])),
    )

    expect(rows[0]!.billingCycle).toBe(cycle)
  })

  it('folds the case of a cycle, as validate folds a currency code', () => {
    // Migration 013's check constraint is lower-case only, so `Monthly` is a row
    // the database rejects. Case cannot change which of three values this is,
    // which is the same reason `validate` upper-cases a currency.
    const rows = rollRowsOf(
      readRows(
        roll([['2019-03-01', 'Jane Smith', '3600.00', 'assessment_roll', '4B', 'Monthly', '2026']]),
      ),
    )

    expect(rows[0]!.billingCycle).toBe('monthly')
  })

  it('refuses a cycle the assessment table does not admit', () => {
    const problems = problemsOf(
      readRows(
        roll([['2019-03-01', 'Jane Smith', '3600.00', 'assessment_roll', '4B', 'quarterly', '2026']]),
      ),
    )

    expect(problems[0]!.reason).toBe('invalid-row')
  })
})

describe('the assessment year', () => {
  it('reads the year as a number', () => {
    const rows = rollRowsOf(readRows(roll([JANE])))

    expect(rows[0]!.assessmentYear).toBe(2026)
  })

  it('is read from its own column and never derived from the date', () => {
    // The load-bearing case. `date` is when the membership began, so a member
    // who bought in 2019 and appears on the 2026 roll would derive 2019 —
    // an assessment against the wrong year, silently.
    const rows = rollRowsOf(readRows(roll([JANE])))

    expect(rows[0]!.heldFrom).toBe('2019-03-01')
    expect(rows[0]!.assessmentYear).toBe(2026)
  })

  it.each(['20xx', '2026.5', '-2026', '2,026'])('refuses %s as a year', (year) => {
    const problems = problemsOf(
      readRows(
        roll([['2019-03-01', 'Jane Smith', '3600.00', 'assessment_roll', '4B', 'monthly', year]]),
      ),
    )

    expect(problems[0]!.reason).toBe('invalid-row')
  })

  it.each(['1899', '2201'])('refuses %s, which the year check would reject', (year) => {
    const problems = problemsOf(
      readRows(
        roll([['2019-03-01', 'Jane Smith', '3600.00', 'assessment_roll', '4B', 'monthly', year]]),
      ),
    )

    expect(problems[0]!.reason).toBe('invalid-row')
  })

  it.each(['1900', '2200'])('accepts %s, the boundary the check admits', (year) => {
    const rows = rollRowsOf(
      readRows(
        roll([['2019-03-01', 'Jane Smith', '3600.00', 'assessment_roll', '4B', 'monthly', year]]),
      ),
    )

    expect(rows[0]!.assessmentYear).toBe(Number(year))
  })

  it('trims a padded year, which a spreadsheet export routinely writes', () => {
    // The two columns this story adds trim their ends and then validate
    // strictly. `amount` and `date` deliberately do not, because they reuse
    // AMOUNT_PATTERN and validate's date check unchanged rather than forking the
    // project's single statement of either.
    const rows = rollRowsOf(
      readRows(
        roll([['2019-03-01', 'Jane Smith', '3600.00', 'assessment_roll', '4B', ' monthly ', ' 2026 ']]),
      ),
    )

    expect(rows[0]!.assessmentYear).toBe(2026)
    expect(rows[0]!.billingCycle).toBe('monthly')
  })
})

describe('the annual amount', () => {
  it.each(['0', '0.00', '-100.00'])('refuses %s, which assessment_amount_positive rejects', (amount) => {
    // AMOUNT_PATTERN admits all three. The database refuses them, and it refuses
    // them by aborting the transaction the whole roll is written in — so the
    // reader has to catch them or one bad cell costs the document.
    const problems = problemsOf(
      readRows(
        roll([['2019-03-01', 'Jane Smith', amount, 'assessment_roll', '4B', 'monthly', '2026']]),
      ),
    )

    expect(problems[0]!.reason).toBe('invalid-row')
  })

  it.each(['$3,600.00', '3600.000', '3.6e3'])('refuses %s', (amount) => {
    const problems = problemsOf(
      readRows(
        roll([['2019-03-01', 'Jane Smith', amount, 'assessment_roll', '4B', 'monthly', '2026']]),
      ),
    )

    expect(problems[0]!.reason).toBe('invalid-row')
  })

  it('accepts the smallest amount the table stores', () => {
    const rows = rollRowsOf(
      readRows(
        roll([['2019-03-01', 'Jane Smith', '0.01', 'assessment_roll', '4B', 'monthly', '2026']]),
      ),
    )

    expect(rows[0]!.annualAmount).toBe('0.01')
  })
})

describe('what the storing columns will not hold', () => {
  it('refuses a unit number over the 64 the unit table stores', () => {
    const problems = problemsOf(
      readRows(
        roll([
          ['2019-03-01', 'Jane Smith', '3600.00', 'assessment_roll', 'U'.repeat(65), 'monthly', '2026'],
        ]),
      ),
    )

    expect(problems[0]!.reason).toBe('invalid-row')
  })

  it('accepts a unit number of exactly 64', () => {
    const rows = rollRowsOf(
      readRows(
        roll([
          ['2019-03-01', 'Jane Smith', '3600.00', 'assessment_roll', 'U'.repeat(64), 'monthly', '2026'],
        ]),
      ),
    )

    expect(rows[0]!.unitNumber).toHaveLength(64)
  })

  it('refuses a unit number of 65 code points written as astral characters', () => {
    const problems = problemsOf(
      readRows(
        roll([
          ['2019-03-01', 'Jane Smith', '3600.00', 'assessment_roll', '𐐷'.repeat(65), 'monthly', '2026'],
        ]),
      ),
    )

    expect(problems[0]!.reason).toBe('invalid-row')
  })

  it('refuses a holder name over the 200 the unit_holder table stores', () => {
    const problems = problemsOf(
      readRows(
        roll([
          ['2019-03-01', 'J'.repeat(201), '3600.00', 'assessment_roll', '4B', 'monthly', '2026'],
        ]),
      ),
    )

    expect(problems[0]!.reason).toBe('invalid-row')
  })

  it.each([
    ['unit', 4],
    ['holder', 1],
  ])('refuses a NUL in the %s, which text cannot store', (_label, column) => {
    const cells = [...JANE]
    cells[column] = `${cells[column]}\u0000`

    expect(problemsOf(readRows(roll([cells])))[0]!.reason).toBe('invalid-row')
  })

  it('refuses a held-from date that is not a real day', () => {
    const problems = problemsOf(
      readRows(
        roll([['2026-02-30', 'Jane Smith', '3600.00', 'assessment_roll', '4B', 'monthly', '2026']]),
      ),
    )

    expect(problems[0]!.reason).toBe('invalid-row')
  })
})

describe('readRollRow measures length the way the database does', () => {
  /**
   * Tested directly rather than through `readRows`, and that is the point.
   *
   * `validate` runs first on the same cells and bounds its text fields with
   * `trimmed.length` — **UTF-16 units** — so through the table it always refuses
   * an astral value before this function is consulted. The guard here would be
   * unreachable if this were the only route to it, which is exactly the shape
   * this project deletes.
   *
   * It is kept because `readRollRow` is a boundary function that must not depend
   * on a sibling having validated first — the argument `isStorableName` makes
   * for itself in as many words. Testing it where it decides is what makes the
   * guard real rather than decorative.
   *
   * The disagreement between the two measures is recorded as a follow-up: the
   * database counts code points, `isStorableName` counts code points, and
   * `validate.checkText` counts UTF-16 units, so today the application refuses a
   * 64-code-point unit number the column would store happily.
   */
  const wellFormed = {
    unitNumber: '4B',
    holderName: 'Jane Smith',
    heldFrom: '2019-03-01',
    annualAmount: '3600.00',
    cycle: 'monthly',
    year: '2026',
  }

  it('accepts 64 code points written as 128 UTF-16 units', () => {
    const astral = '𐐷'.repeat(64)
    expect(astral.length).toBe(128)

    const result = readRollRow({ ...wellFormed, unitNumber: astral })

    expect(result.ok).toBe(true)
  })

  it('refuses 65 code points', () => {
    expect(readRollRow({ ...wellFormed, unitNumber: '𐐷'.repeat(65) }).ok).toBe(false)
  })

  it('accepts a holder of exactly 200 code points and refuses 201', () => {
    expect(readRollRow({ ...wellFormed, holderName: '𐐷'.repeat(200) }).ok).toBe(true)
    expect(readRollRow({ ...wellFormed, holderName: '𐐷'.repeat(201) }).ok).toBe(false)
  })

  it('reads the ordinary case, so the refusals above are not vacuous', () => {
    // The control. Without it every assertion here could be satisfied by a
    // function that refuses everything.
    const result = readRollRow(wellFormed)

    expect(result.ok && result.row.unitNumber).toBe('4B')
  })
})

describe('one unit, one row', () => {
  it('refuses a roll naming the same unit twice', () => {
    // Two rows for one unit are two answers about who holds it and what it owes.
    // `assessment_one_per_unit_year` would abort the transaction; refusing here
    // costs the treasurer a sentence instead of a failed upload.
    const problems = problemsOf(
      readRows(
        roll([
          JANE,
          ['2020-06-01', 'John Doe', '4800.00', 'assessment_roll', '4B', 'annual', '2026'],
        ]),
      ),
    )

    expect(problems[0]!.reason).toBe('duplicate-unit')
  })

  it('collides two spellings the roll folds together', () => {
    // `4B` and `4b  ` are one unit to migration 011's unique index, so they must
    // be one unit here. Matching the raw string would let both through and the
    // second would fail at the database.
    const problems = problemsOf(
      readRows(
        roll([
          JANE,
          ['2020-06-01', 'John Doe', '4800.00', 'assessment_roll', '4b  ', 'annual', '2026'],
        ]),
      ),
    )

    expect(problems[0]!.reason).toBe('duplicate-unit')
  })

  it('allows one unit to appear on rolls for different years in one file', () => {
    // The grain is the unit and the year, matching assessment_one_per_unit_year.
    const rows = rollRowsOf(
      readRows(
        roll([
          JANE,
          ['2019-03-01', 'Jane Smith', '3700.00', 'assessment_roll', '4B', 'monthly', '2027'],
        ]),
      ),
    )

    expect(rows).toHaveLength(2)
  })

  it('allows two different units', () => {
    const rows = rollRowsOf(
      readRows(
        roll([
          JANE,
          ['2020-06-01', 'John Doe', '4800.00', 'assessment_roll', '5C', 'annual', '2026'],
        ]),
      ),
    )

    expect(rows).toHaveLength(2)
  })
})

describe('one defective row fails the document', () => {
  it('reads nothing at all when a later roll row is bad', () => {
    // The rule `readRows` already applies. A roll half-loaded is a set of units
    // that looks complete and is not, and every arrears figure derived from it
    // is wrong without saying so.
    const problems = problemsOf(
      readRows(
        roll([
          JANE,
          ['2020-06-01', 'John Doe', '4800.00', 'assessment_roll', '5C', 'quarterly', '2026'],
        ]),
      ),
    )

    expect(problems).not.toHaveLength(0)
    expect(problems[0]!.reason).toBe('invalid-row')
    expect(problems[0]!.row).toBe(2)
  })
})
