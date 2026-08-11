import { describe, expect, it } from 'vitest'

import { MAX_QUESTION_LENGTH, questionFrom } from './question'

/**
 * The search parameter, which is not necessarily a string.
 *
 * `?q=a&q=b` gives Next.js an array, and `.trim()` on an array is a `TypeError`
 * — a 500 anybody can produce by typing a URL. The page's type annotation said
 * `string`, so nothing complained: the type described the request a friendly
 * caller makes rather than the ones that actually arrive.
 */
describe('the question, from whatever the URL carried', () => {
  it.each([
    ['a plain question', 'What does 4B owe?', 'What does 4B owe?'],
    ['surrounding whitespace', '  What does 4B owe?  ', 'What does 4B owe?'],
    ['nothing at all', undefined, ''],
    ['an empty value', '', ''],
    ['whitespace only', '   ', ''],
  ])('reads %s', (_label, given, expected) => {
    expect(questionFrom(given)).toBe(expected)
  })

  it.each([
    ['repeated parameters', ['first question', 'second question'], 'first question'],
    ['an array with whitespace', ['  spaced  '], 'spaced'],
    ['an empty array', [], ''],
    ['an array of empties', ['', ''], ''],
  ])('survives %s', (_label, given, expected) => {
    // The first value wins rather than the whole request being refused: two `q`
    // parameters is a malformed link, not an attack, and the reader almost
    // certainly meant the first.
    expect(questionFrom(given as string[])).toBe(expected)
  })

  it('bounds an absurd question rather than forwarding it', () => {
    // The agent refuses a body past 64 KB, but that is a round trip and a model
    // prompt away. Raised by CodeRabbit.
    const absurd = 'x'.repeat(MAX_QUESTION_LENGTH * 4)

    expect(questionFrom(absurd)).toHaveLength(MAX_QUESTION_LENGTH)
  })

  it('bounds an absurd question in an array too', () => {
    // Both shapes share the limit, which is why the trim and the slice happen
    // in one place rather than on each branch.
    expect(questionFrom(['y'.repeat(MAX_QUESTION_LENGTH * 4)])).toHaveLength(MAX_QUESTION_LENGTH)
  })

  it('leaves an ordinary question untouched', () => {
    // The other direction, so a bound that truncated everything would fail.
    expect(questionFrom('What does 4B owe for 2026?')).toBe('What does 4B owe for 2026?')
  })

  it('does not throw on any of them', () => {
    // The property that matters. Before this, an array reached `.trim()` and
    // the page answered 500.
    for (const given of [undefined, '', 'q', [], ['a'], ['a', 'b']] as (string | string[] | undefined)[]) {
      expect(() => questionFrom(given)).not.toThrow()
    }
  })
})
