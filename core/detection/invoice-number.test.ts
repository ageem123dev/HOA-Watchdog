/**
 * What makes two invoice numbers the same invoice number.
 *
 * The rule is **normalised-exact**, and the interesting assertions are the ones
 * that refuse a match. FR-6 asks for "fuzzy duplicates (similar invoice number,
 * identical amount)", and the obvious reading of *similar* is an edit distance —
 * which flags `INV-1001` against `INV-1002`, two invoice numbers one character
 * apart that are certainly two different invoices.
 *
 * `core/vendor/name.ts` already made this decision for vendor names and wrote
 * down why: *"A wrong automatic near-match does not fail loudly; it writes a
 * false vendor identity into the history and reports success."* A wrong invoice
 * match reports that the association paid twice when it did not.
 *
 * **Every invisible character in this file is an escape**, never typed. A
 * literal non-breaking space here looks exactly like an ordinary one, so the
 * edit that replaces it leaves the case passing while it tests nothing — and
 * `docs/no-control-characters.test.ts` exists because this project has shipped
 * that mistake four times.
 */

import { describe, expect, it } from 'vitest'

import { INVOICE_MATCH_RULE, normaliseInvoiceNumber, sameInvoiceNumber } from './invoice-number'

const NBSP = '\u00a0'
const NARROW_NBSP = '\u202f'

describe('the same number written differently', () => {
  it.each([
    ['case', 'INV-1001', 'inv-1001'],
    ['a separator instead of punctuation', 'INV-1001', 'INV 1001'],
    ['no separator at all', 'INV-1001', 'INV1001'],
    ['leading zeros inside the number', 'INV-1001', 'INV-0001001'],
    ['both, together', 'inv 1001', 'INV-0001001'],
    ['surrounding space', 'INV-1001', '  INV-1001  '],
    ['a non-breaking space a PDF emitted', 'INV-1001', `INV${NBSP}1001`],
    ['a narrow non-breaking space', 'INV-1001', `INV${NARROW_NBSP}1001`],
  ])('folds %s', (_label, a, b) => {
    expect(sameInvoiceNumber(a, b)).toBe(true)
  })

  it('keeps a zero that is the whole number', () => {
    // `000` stripped of leading zeros is the empty string, which is how this
    // function says "there is no invoice number here" — and an invoice numbered
    // 0 would then stop matching its own duplicate while looking like it worked.
    expect(normaliseInvoiceNumber('000')).toBe('0')
    expect(sameInvoiceNumber('0', '000')).toBe(true)
  })
})

describe('numbers that are not the same number', () => {
  it('refuses adjacent invoice numbers', () => {
    // **The false positive this whole rule exists to avoid.** One character
    // apart, and certainly two different invoices — a vendor billing twice in a
    // month produces exactly this pair. Any edit-distance rule flags it.
    expect(sameInvoiceNumber('INV-1001', 'INV-1002')).toBe(false)
  })

  it('refuses a bare number against a prefixed one', () => {
    // Folding `0001001` onto `INV-1001` needs a rule that discards a leading
    // non-numeric prefix, and that rule cannot tell `INV` from `CR`.
    expect(sameInvoiceNumber('0001001', 'INV-1001')).toBe(false)
  })

  it('refuses an invoice against its own credit note', () => {
    // The reason the prefix stays. `CR-1001` credits `INV-1001`: the two
    // documents are genuinely about the same money, so a rule that pairs them
    // produces a duplicate finding that reads entirely plausible and is wrong.
    expect(sameInvoiceNumber('INV-1001', 'CR-1001')).toBe(false)
  })

  it('keeps characters outside ASCII rather than folding them away', () => {
    // Dropping what it cannot classify would fold `ÁBC` onto `ABC` and
    // manufacture a match. Keeping it can only miss one, and for a detector
    // whose false positives cost trust that is the right direction to fail.
    expect(sameInvoiceNumber('ÁBC-1001', 'ABC-1001')).toBe(false)
  })
})

describe('an invoice with no number', () => {
  it.each([
    ['empty', ''],
    ['spaces', '   '],
    ['punctuation only', '---'],
    ['a lone hash', '#'],
  ])('folds %s to no key at all', (_label, raw) => {
    expect(normaliseInvoiceNumber(raw)).toBe('')
  })

  it('takes null and undefined, because the column is nullable', () => {
    // `extraction.document_number` is nullable and null is the ordinary case —
    // it is what the extractor writes when it could not read one. Making the
    // caller decide what null means is how the check gets skipped at one of two
    // call sites, so the answer lives here.
    expect(normaliseInvoiceNumber(null)).toBe('')
    expect(normaliseInvoiceNumber(undefined)).toBe('')
    expect(sameInvoiceNumber(null, null)).toBe(false)
    expect(sameInvoiceNumber('INV-1001', null)).toBe(false)
  })

  it('never matches another invoice with no number', () => {
    // **The failure mode that would make the detector worst.** Every invoice the
    // extractor could not read a number from folds to the same empty key, so a
    // rule that compared keys directly would pair them all with each other and
    // report a duplicate for every unreadable pair.
    expect(sameInvoiceNumber('', '')).toBe(false)
    expect(sameInvoiceNumber('---', '   ')).toBe(false)
    expect(sameInvoiceNumber('INV-1001', '')).toBe(false)
  })
})

describe('the rule states itself', () => {
  it('is normalised-exact, and says so where a widener would look', () => {
    // `AUTO_RESOLVE_RULE` in `core/vendor/name.ts` is the precedent: the name of
    // the rule is exported so that loosening it is a deliberate edit against a
    // failing test rather than a quiet change to a comparison.
    expect(INVOICE_MATCH_RULE).toBe('normalised-exact')
  })

  it('is total: any string folds without throwing', () => {
    const awkward = ['', ' ', NBSP, '\u{1d7d9}\u{1d7da}\u{1d7db}', 'a'.repeat(500), '\\', '%', "'; drop table"]

    for (const raw of awkward) {
      expect(() => normaliseInvoiceNumber(raw)).not.toThrow()
    }
  })

  it('does not let a dotted capital I grow the key', () => {
    // `'İ'.toLowerCase()` is **two** code points — the letter and a
    // combining dot — so a wholesale `toLowerCase()` makes a key longer than
    // the string it came from. `normaliseVendorName` folds `A`-`Z` by code
    // point to avoid exactly this, and the comment claiming that is only worth
    // anything with this case behind it.
    const folded = normaliseInvoiceNumber('İ')

    expect([...folded]).toHaveLength(1)
    expect(folded).toBe('İ')
  })

  it('does not fold mathematical digits onto their ASCII twins', () => {
    // Recorded rather than fixed. A PDF extractor can emit these, and they will
    // not match `123` — a *missed* duplicate, never a false one, which is the
    // direction this rule fails in on purpose.
    expect(sameInvoiceNumber('\u{1d7d9}\u{1d7da}\u{1d7db}', '123')).toBe(false)
  })
})
