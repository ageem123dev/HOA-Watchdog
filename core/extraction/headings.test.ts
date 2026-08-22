/**
 * The headings a sample actually has (story 5.3).
 *
 * ## Why this is not `readRows`
 *
 * `readRows` asks *may this file be ingested?* and stops at the first thing that
 * says no. Two columns called `amount` come back as
 * `{ reason: 'duplicate-headers' }`, naming **neither** — correct there, because
 * taking the first or the last is how a figure arrives from the wrong column
 * with nothing to show it happened.
 *
 * This asks *what columns does this file have?*, and the answers it must give
 * are the opposite ones: name the duplicates, name the blanks, and report
 * **all** of them, because a treasurer who fixes a duplicate and is only then
 * told about a blank has been made to upload twice for no reason.
 *
 * So the assertions below are about *reporting*, not refusing. A file with
 * problems still yields its headings — the wizard needs both halves.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { normaliseHeading, readHeadings } from './headings'
import { readRows } from './tabular'

const headingsOf = (rows: readonly (readonly string[])[]) => {
  const result = readHeadings(rows)
  if (!result.ok) throw new Error(`expected headings, got ${result.reason}`)
  return result
}

/**
 * The folding is shared with `readRows`, not merely identical to it.
 *
 * Two copies of `trim().toLowerCase()` classify headings the same way until one
 * changes — and then a sample reports columns the importer would treat
 * differently, which is worse than either behaviour alone. Raised by CodeRabbit.
 */
describe('the folding this shares with the importer', () => {
  it.each([
    ['padding', '  Unit  ', 'unit'],
    ['case', 'UNIT', 'unit'],
    ['both', ' Unit Number ', 'unit number'],
    ['neither', 'unit', 'unit'],
  ])('folds %s the way a header row is matched', (_label, written, expected) => {
    expect(normaliseHeading(written)).toBe(expected)
  })

  /**
   * **Parity, observed rather than inspected.**
   *
   * The first version of this read `tabular.ts` and asserted it mentioned
   * `normaliseHeading` and contained no bare `trim().toLowerCase()`. CodeRabbit
   * pointed out that both checks pass if `tabular` imports the shared folding
   * and then binds `normalise` to something else — `h => h.toLowerCase()`
   * satisfies them and drops the trim. `tsconfig` sets no `noUnusedLocals`, so
   * nothing else would notice the import was decorative.
   *
   * So this asserts the *effect* instead: a heading written in a form
   * `normaliseHeading` folds to `amount` is a heading `readRows` accepts as the
   * `amount` column. Two implementations that disagree cannot both pass, whatever
   * the source says.
   */
  it.each([
    ['padding', '  amount  '],
    ['case', 'AMOUNT'],
    ['both', ' Amount '],
  ])('folds %s in the importer exactly as it folds here', (_label, written) => {
    expect(normaliseHeading(written)).toBe('amount')

    const result = readRows(
      [
        ['date', 'description', written],
        ['2026-01-01', 'A Counterparty', '10.00'],
      ],
      'statement',
    )

    expect(result.ok, `the importer did not read ${JSON.stringify(written)} as amount`).toBe(true)
  })

  /**
   * The other direction, so the block above is not passing because `readRows`
   * accepts everything: a heading the folding does *not* turn into `amount` is
   * a column the importer does not find.
   */
  it('does not read a heading the folding leaves different as that column', () => {
    expect(normaliseHeading('amt')).not.toBe('amount')

    const result = readRows(
      [
        ['date', 'description', 'amt'],
        ['2026-01-01', 'A Counterparty', '10.00'],
      ],
      'statement',
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems[0]?.reason).toBe('missing-headers')
  })

  /**
   * And the cheap structural check kept alongside, because the parity cases
   * above can only cover the forms they name: a second definition in `tabular`
   * that happens to agree on those three would still be a copy waiting to drift.
   */
  it('holds no folding of its own in the importer', () => {
    const source = readFileSync(join(import.meta.dirname, 'tabular.ts'), 'utf8')

    expect(source).toMatch(/^const normalise = normaliseHeading$/m)
    expect(source).not.toMatch(/trim\(\)\.toLowerCase\(\)/)
  })
})

describe('reading the headings a file was given', () => {
  it('returns every heading in file order, with its position', () => {
    const { headings } = headingsOf([['date', 'description', 'amount']])

    expect(headings.map((h) => h.text)).toEqual(['date', 'description', 'amount'])
    // 1-based, because it is the number a treasurer counts to in their
    // spreadsheet. A zero-based position in a message is one they cannot use.
    expect(headings.map((h) => h.position)).toEqual([1, 2, 3])
  })

  /**
   * AC6. `readRows` matches after `trim().toLowerCase()`; a treasurer needs to
   * see what they typed. Both forms travel, and this says which is which — a
   * report that silently lower-cased would send them looking for a column their
   * file does not contain.
   */
  it('reports a heading as written and as matched', () => {
    const [heading] = headingsOf([[' Unit Number ']]).headings

    expect(heading?.text).toBe(' Unit Number ')
    expect(heading?.normalised).toBe('unit number')
  })

  it('finds no problems in a file that has none', () => {
    expect(headingsOf([['date', 'description', 'amount']]).problems).toEqual([])
  })

  /**
   * AC2. Named, and every position it occupies — the whole point of the story.
   */
  it('names a duplicated heading and where it occurs', () => {
    const { problems } = headingsOf([['date', 'amount', 'note', 'amount']])

    expect(problems).toEqual([{ reason: 'duplicate-heading', heading: 'amount', positions: [2, 4] }])
  })

  it('reports a heading duplicated three times once, listing all of its positions', () => {
    const { problems } = headingsOf([['amount', 'amount', 'amount']])

    expect(problems).toEqual([{ reason: 'duplicate-heading', heading: 'amount', positions: [1, 2, 3] }])
  })

  /**
   * Duplication is decided on the matched form, because that is what would
   * collide at ingestion. `Amount` and `amount ` are the same column to
   * `readRows`, and a report that called them distinct would tell a treasurer
   * their file was fine.
   */
  it('treats headings that differ only in case or padding as duplicates', () => {
    const { problems } = headingsOf([['Amount', 'amount ']])

    expect(problems).toEqual([{ reason: 'duplicate-heading', heading: 'amount', positions: [1, 2] }])
  })

  /**
   * AC3. A blank heading is a column with no name, and its position is the only
   * thing identifying it. Reported rather than dropped: a dropped column is one
   * the treasurer cannot map and is never told about.
   */
  it.each([
    ['an empty heading', ''],
    ['a whitespace-only heading', '   '],
    ['a tab', '\t'],
  ])('names the position of %s', (_label, blank) => {
    const { headings, problems } = headingsOf([['date', blank, 'amount']])

    expect(problems).toEqual([{ reason: 'blank-heading', positions: [2] }])
    // Still present in the list: the column exists, it simply has no name.
    expect(headings).toHaveLength(3)
  })

  it('gathers several blanks into one report, listing each position', () => {
    const { problems } = headingsOf([['', 'date', '']])

    expect(problems).toEqual([{ reason: 'blank-heading', positions: [1, 3] }])
  })

  /**
   * AC4, and the direct inversion of `readRows`. This is the assertion that
   * makes this a separate function rather than a flag on that one.
   */
  it('reports a duplicate and a blank together, not the first one it meets', () => {
    const { problems } = headingsOf([['amount', '', 'amount']])

    expect(problems).toEqual([
      { reason: 'duplicate-heading', heading: 'amount', positions: [1, 3] },
      { reason: 'blank-heading', positions: [2] },
    ])
  })

  /**
   * AC5. Each of these sends a treasurer somewhere different — "your file is
   * empty" and "your headings are all blank" are not the same sentence — so
   * they are not collapsed into one reason.
   */
  it.each([
    ['a file with no rows at all', [], 'no-rows'],
    ['a header row with no cells', [[]], 'no-headings'],
    ['a header row that is entirely blank', [['', '  ']], 'no-headings'],
  ])('refuses %s, saying which', (_label, rows, reason) => {
    const result = readHeadings(rows as readonly (readonly string[])[])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe(reason)
  })

  /**
   * The inverse of the block above, in the same file: a single named heading is
   * enough to be readable. Without this, "refuses an empty header row" passes
   * against a function that refuses everything.
   */
  it('accepts a header row carrying a single named column', () => {
    expect(headingsOf([['date']]).headings.map((h) => h.text)).toEqual(['date'])
  })

  /**
   * Data rows are not this function's business — it is told a rectangle and
   * reads its first row. A sample with no data rows still has headings, and a
   * wizard that refused it would be refusing the commonest export of all: the
   * one a treasurer trimmed to show us its shape.
   */
  it('reads the headings of a file that has no data rows', () => {
    expect(headingsOf([['date', 'amount']]).headings).toHaveLength(2)
  })

  it('ignores the data rows entirely, however many there are', () => {
    const withData = headingsOf([['date', 'amount'], ['2026-01-01', '10.00'], ['2026-01-02', '20.00']])

    expect(withData.headings.map((h) => h.text)).toEqual(['date', 'amount'])
    expect(withData.problems).toEqual([])
  })
})
