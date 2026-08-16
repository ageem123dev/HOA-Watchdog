/**
 * The CSV cell's escaping, tested where it now lives.
 *
 * `core/provenance/access-log-csv.test.ts` covers the same function through the
 * access log and keeps doing so. What is here is the part that is about the
 * escaping itself rather than about either file that uses it — in particular
 * the ways a formula can be hidden from a naive check.
 */

import { describe, expect, it } from 'vitest'

import { cell } from './cell'

const TAB = '\t'

describe('a value that would be read as a formula is neutralised', () => {
  it.each(['=cmd|calc', '+1', '-1', '@SUM(A1)'])('prefixes %o with a tab', (value) => {
    expect(cell(value)).toBe(`"${TAB}${value}"`)
  })

  it.each(['＝cmd', '＋1', '－1', '＠SUM(A1)'])(
    'prefixes the full-width form %o, which an IME produces',
    (value) => {
      expect(cell(value)).toBe(`"${TAB}${value}"`)
    },
  )

  it.each([' =cmd', '\t=cmd', '\n=cmd', '\r=cmd'])(
    'sees through leading whitespace in %o',
    (value) => {
      expect(cell(value)).toBe(`"${TAB}${value}"`)
    },
  )

  it.each([
    ['a start-of-heading byte', '\u0001=cmd|calc'],
    ['a vertical tab', '\u000B=cmd|calc'],
    ['a form feed', '\u000C=cmd|calc'],
    ['an escape byte', '\u001B=cmd|calc'],
  ])('sees through %s, which trimStart leaves in place', (_name, value) => {
    // **`trimStart()` removes Unicode whitespace and nothing else.** A control
    // character is not whitespace, so it survives the trim, becomes the first
    // character the check sees, and the formula behind it walks through
    // unprefixed — while a spreadsheet skips the control byte and evaluates.
    //
    // Postgres `text` cannot hold a NUL, so that particular payload cannot
    // reach here from the database; the others can. Raised by Argus.
    expect(cell(value)).toBe(`"${TAB}${value}"`)
  })

  it('leaves the value itself byte for byte intact', () => {
    // The check trims; the value does not. These are records, and a defence
    // that quietly edited what somebody typed would be its own falsification.
    expect(cell('  =cmd')).toBe(`"${TAB}  =cmd"`)
  })
})

describe('a value that is not a formula is left alone', () => {
  it.each(['Coastal Landscaping', '1450.00', 'a-b', 'x=y', 'unit 12B'])(
    'does not prefix %o',
    (value) => {
      expect(cell(value)).toBe(`"${value}"`)
    },
  )

  it('does not prefix a value whose only content is whitespace', () => {
    expect(cell('   ')).toBe('"   "')
  })
})

describe('quoting', () => {
  it('doubles an embedded quote, so the cell stays one cell', () => {
    expect(cell('O"Brien')).toBe('"O""Brien"')
  })

  it('keeps a comma inside the quotes', () => {
    expect(cell('Coastal, Harbour')).toBe('"Coastal, Harbour"')
  })

  it.each([
    [null, '""'],
    [undefined, '""'],
  ])('writes %o as an empty cell', (value, expected) => {
    expect(cell(value)).toBe(expected)
  })
})
