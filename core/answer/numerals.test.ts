/**
 * What counts as a number in an answer, and what that number is worth.
 *
 * AD-7: "Every numeric token in a rendered answer must match a value present in
 * the tool result set for that turn." Everything downstream depends on this file
 * agreeing with a reader about which characters in a sentence are a *quantity*.
 *
 * **Both directions are cliffs, and only one of them is obvious.**
 *
 * Under-strict is the loud one: miss a numeral and a hallucinated balance ships.
 * Over-strict is the quiet one, and it is how this guard dies. This system
 * already emits strings whose digits are not quantities — unit `4B`, catalog
 * reference `dues_status@1`, ISO date `2026-07-01`, version `v1`. A validator
 * that rejects true answers is one somebody switches off, and then nothing is
 * checked at all. `forbidden-credentials.ts` records that failure in its own
 * header for a different guard: it "gets deleted by the first developer it
 * inconveniences".
 *
 * So the rule is stated, and tested in both directions.
 */

import { describe, expect, it } from 'vitest'

import { numeralsIn, valueOf } from './numerals'

describe('what is a numeral', () => {
  it.each([
    ['a plain integer', 'the unit owes 1240', ['1240']],
    ['a decimal', 'the balance is 1240.55', ['1240.55']],
    ['a currency amount', 'the unit owes $1,240.00', ['$1,240.00']],
    ['thousands separators without a symbol', 'a total of 1,240.00', ['1,240.00']],
    ['a percentage', 'up 20% on the average', ['20%']],
    ['several in one sentence', '4 payments totalling 1,240.00', ['4', '1,240.00']],
    ['a negative amount', 'a balance of -35.00', ['-35.00']],
  ])('finds %s', (_label, text, expected) => {
    expect(numeralsIn(text).map((n) => n.text)).toEqual(expected)
  })

  /**
   * The over-strict cliff. Each of these is a real shape this system emits, and
   * each would be torn into digits by a naive `\d+` sweep.
   */
  it.each([
    ['a unit number', 'unit 4B owes nothing'],
    ['a lettered unit at the end', 'the holder of 12C'],
    ['a catalog reference', 'answered from dues_status@1'],
    ['a version tag', 'entry version v1'],
    ['an ISO date', 'due on 2026-07-01'],
    ['an ISO timestamp', 'logged at 2026-07-01T09:30:00Z'],
    ['a uuid', 'provenance 018f3a2b-0000-7000-8000-0000000000aa'],
    ['a snake_case identifier with a digit', 'the entry unit_2_summary'],
  ])('does not treat %s as a numeral', (_label, text) => {
    expect(numeralsIn(text)).toEqual([])
  })

  it('finds the quantity in a sentence that also carries an identifier', () => {
    // The realistic answer shape: an identifier and a real figure together.
    // Dropping the identifier must not drop the figure with it.
    expect(numeralsIn('unit 4B owes $1,240.00 for 2026').map((n) => n.text)).toEqual([
      '$1,240.00',
      '2026',
    ])
  })

  it('reports where each numeral was, so a rejection can name it precisely', () => {
    const [first] = numeralsIn('owes 1240')

    expect(first?.index).toBe(5)
  })
})

describe('what a numeral is worth', () => {
  it.each([
    ['a plain integer', '1240', 124000],
    ['an explicit two-place decimal', '1240.00', 124000],
    ['a currency amount', '$1,240.00', 124000],
    ['thousands separators', '1,240', 124000],
    ['a one-place decimal', '0.5', 50],
    ['zero', '0', 0],
    ['zero with places', '0.00', 0],
    ['a negative', '-35.00', -3500],
    ['a percentage, by its number', '20%', 2000],
  ])('reads %s', (_label, text, expected) => {
    expect(valueOf(text)).toBe(expected)
  })

  /**
   * AD-7's own example, and the reason the rule is called normalization rather
   * than comparison: these are one value written five ways, and an answer may
   * use any of them for a row that carries `"1240.00"`.
   */
  it('treats every spelling of one amount as the same value', () => {
    const spellings = ['1240', '1240.00', '1,240', '1,240.00', '$1,240.00']
    const values = new Set(spellings.map(valueOf))

    expect(values.size).toBe(1)
  })

  it('is exact, and does not go through a float', () => {
    // `Number('0.29') * 100` is 28.999999999999996. minor-units.ts exists
    // because of that, and this must inherit the property rather than
    // re-introduce the bug one layer up.
    expect(valueOf('0.29')).toBe(29)
    expect(valueOf('1234.56')).toBe(123456)
  })

  it('refuses a value with more precision than the money contract carries', () => {
    // `numeric(14,2)`. Three decimal places is not a formatting variant of a
    // stored amount; it is a number this system cannot have produced.
    expect(() => valueOf('1240.555')).toThrow()
  })

  it('refuses something that is not a numeral at all', () => {
    expect(() => valueOf('4B')).toThrow()
  })
})
