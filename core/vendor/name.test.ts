/**
 * Vendor-name normalisation, the application's half.
 *
 * The database holds the other half, and the two must agree exactly or one
 * vendor acquires two identities. `migrations/vendor.test.ts` runs both over a
 * shared corpus against real Postgres; these tests pin the behaviour itself so
 * a failure there says which side moved.
 *
 * Neither `String.prototype.trim` nor `\s` is used, and that is deliberate:
 * both treat NBSP as whitespace and Postgres does not.
 */

import { describe, expect, it } from 'vitest'

import { AUTO_RESOLVE_RULE, NAME_FOLD_WHITESPACE, normaliseVendorName } from './name'

describe('normaliseVendorName', () => {
  it('leaves an already-plain name alone', () => {
    expect(normaliseVendorName('evergreen landscaping')).toBe('evergreen landscaping')
  })

  it('folds letter case', () => {
    expect(normaliseVendorName('EverGREEN LandSCAPING')).toBe('evergreen landscaping')
  })

  it('trims the ends', () => {
    expect(normaliseVendorName('   Evergreen Landscaping   ')).toBe('evergreen landscaping')
  })

  it('collapses a run of spaces to one', () => {
    expect(normaliseVendorName('Evergreen     Landscaping')).toBe('evergreen landscaping')
  })

  it.each([
    ['tab', '\t'],
    ['newline', '\n'],
    ['carriage return', '\r'],
    ['vertical tab', '\u000b'],
    ['form feed', '\u000c'],
    ['NBSP', '\u00a0'],
    ['narrow NBSP', '\u202f'],
  ])('treats %s as a separator', (_label, separator) => {
    expect(normaliseVendorName(`Evergreen${separator}Landscaping`)).toBe('evergreen landscaping')
  })

  it('trims those separators from the ends too, not just spaces', () => {
    // `String.prototype.trim` would pass the NBSP case and fail the narrow one
    // inconsistently with the database. Both ends are folded by the same set.
    expect(normaliseVendorName('\u00a0\u202f Evergreen Landscaping \u202f\u00a0')).toBe(
      'evergreen landscaping',
    )
  })

  it('collapses a mixture of different separators to a single space', () => {
    expect(normaliseVendorName('Evergreen \t\n\u00a0 Landscaping')).toBe('evergreen landscaping')
  })

  it('does not treat a zero-width space as a separator, because Postgres does not', () => {
    // Both engines agree it is not whitespace. Folding it here would be a
    // disagreement invented by us rather than inherited.
    expect(normaliseVendorName('Ever\u200bgreen')).toBe('ever\u200bgreen')
  })

  it('folds only ASCII letters, so the two engines cannot disagree', () => {
    // Postgres lower() and JS toLowerCase() disagree on U+0130 and on final
    // sigma. Restricting the fold to A-Z makes them identical, at the price of
    // treating a non-ASCII case difference as a different vendor -- which sends
    // it to a human rather than merging it silently.
    expect(normaliseVendorName('\u0130stanbul Plumbing')).toBe('\u0130stanbul plumbing')
    expect(normaliseVendorName('\u03a3\u03a3 Services')).toBe('\u03a3\u03a3 services')
    expect(normaliseVendorName('\u00c4kta Bygg')).toBe('\u00c4kta bygg')
  })

  it('keeps punctuation and digits, which distinguish real vendors', () => {
    expect(normaliseVendorName("O'Brien & Sons, Ltd. #42")).toBe("o'brien & sons, ltd. #42")
  })

  it('is idempotent', () => {
    // Reverse-it does not apply -- normalisation discards information and
    // cannot be inverted. Idempotence is the property that does hold, and it is
    // what makes a stored key comparable with a freshly computed one.
    const raw = '  EverGREEN \t\u00a0 LandSCAPING  '
    const once = normaliseVendorName(raw)

    expect(normaliseVendorName(once)).toBe(once)
  })

  it('never returns a value with a leading, trailing or doubled separator', () => {
    // A cross-check on the whole corpus rather than one example: whatever the
    // input, the output shape is guaranteed.
    const inputs = [
      '  a  b  ',
      '\u00a0a\u202fb\u00a0',
      'a\t\n\rb',
      'a',
      'a  ',
      '  a',
      'A\u000bB\u000cC',
    ]

    for (const input of inputs) {
      const out = normaliseVendorName(input)

      expect(out).not.toMatch(/^[ ]|[ ]$|[ ]{2}/)
      for (const separator of NAME_FOLD_WHITESPACE) {
        if (separator === ' ') continue
        expect(out).not.toContain(separator)
      }
    }
  })

  it('returns empty for a name made only of separators', () => {
    // Not an error here. The database refuses it -- that is where the guard
    // belongs, because it holds for anything that writes, not just this path.
    expect(normaliseVendorName(' \t\u00a0\u202f ')).toBe('')
  })
})

describe('the separator set', () => {
  it('is the exact set the database folds', () => {
    expect([...NAME_FOLD_WHITESPACE].sort().join('')).toBe(
      [' ', '\t', '\n', '\r', '\u000b', '\u000c', '\u00a0', '\u202f'].sort().join(''),
    )
  })

  it('has no duplicates, which would make the class ambiguous', () => {
    expect(new Set(NAME_FOLD_WHITESPACE).size).toBe(NAME_FOLD_WHITESPACE.length)
  })
})

describe('AUTO_RESOLVE_RULE', () => {
  it('is normalised-exact, and says so', () => {
    // Pinned deliberately. A wrong automatic near-match writes a false vendor
    // identity into the comparison history with no error, which is the harm
    // this whole story exists to prevent. Changing this is meant to be a
    // visible edit with a failing test, not a threshold nudged in a query.
    expect(AUTO_RESOLVE_RULE).toBe('normalised-exact')
  })
})
