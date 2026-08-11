/**
 * AD-7, which is the claim this product rests on.
 *
 * "Every numeric token in a rendered answer must match a value present in the
 * tool result set for that turn. A pre-render validator rejects any unreferenced
 * numeral and forces a retry."
 *
 * **This is the guard this project has shipped broken ten times** — one that
 * passes whether or not the thing it guards against is present. So the tests
 * that matter here are not the ones feeding it true answers. They are the
 * planted hallucinations: an invented total, a rounded total, a transposed
 * figure, and a figure taken from a different turn's rows.
 */

import { describe, expect, it } from 'vitest'

import { validateAnswer, valuesAvailableIn } from './validate-answer'

/** What `dues_status@1` actually returns, in the shape the executor hands back. */
const ROWS = [
  {
    unitNumber: '4B',
    assessmentYear: 2026,
    assessed: '1240.00',
    paid: '1000.00',
    balanceOutstanding: '240.00',
  },
]

const accept = (answer: string) => validateAnswer(answer, ROWS)

describe('the values a turn makes available', () => {
  it('carries the decimal amounts the rows returned', () => {
    const available = valuesAvailableIn(ROWS)

    expect(available.has(124000)).toBe(true)
    expect(available.has(24000)).toBe(true)
  })

  it('carries integers the rows returned, such as a year', () => {
    expect(valuesAvailableIn(ROWS).has(202600)).toBe(true)
  })

  it('does not invent values the rows did not carry', () => {
    // 1240.00 - 1000.00 is 240.00, which happens to be present. 1240 + 1000 is
    // not, and the validator must not derive it — AD-6 puts derived values in
    // the entry, deliberately, so that this file never does arithmetic.
    expect(valuesAvailableIn(ROWS).has(224000)).toBe(false)
  })

  it('reads a string that is not an amount as no value at all', () => {
    // `unitNumber: '4B'` must not become a value, or `4` would match it.
    expect(valuesAvailableIn(ROWS).has(400)).toBe(false)
  })

  it('finds values nested inside a row', () => {
    expect(valuesAvailableIn([{ totals: { paid: '15.00' } }]).has(1500)).toBe(true)
  })

  it('is empty for no rows, rather than permissive', () => {
    expect(valuesAvailableIn([]).size).toBe(0)
  })
})

describe('an answer whose numbers came from the rows', () => {
  it.each([
    ['the plain amount', 'Unit 4B owes 240.00 for 2026.'],
    ['a currency spelling', 'Unit 4B owes $240.00 for 2026.'],
    ['thousands separators', 'Unit 4B was assessed $1,240.00 for 2026.'],
    ['an integer spelling of a whole amount', 'Unit 4B was assessed 1240 for 2026.'],
    ['several figures at once', 'Assessed $1,240.00, paid $1,000.00, leaving $240.00.'],
    ['no numbers at all', 'Unit 4B has no recorded assessment.'],
    ['identifiers only', 'Answered from dues_status@1 for unit 4B.'],
  ])('is accepted: %s', (_label, answer) => {
    expect(accept(answer)).toBeNull()
  })
})

describe('an answer carrying a number the rows do not', () => {
  /**
   * The four shapes a hallucination actually takes. Each is planted, because a
   * validator exercised only against true answers cannot tell "nothing wrong"
   * from "nothing checked".
   */
  it('rejects an invented total', () => {
    const rejection = accept('Unit 4B owes $9,999.00 for 2026.')

    expect(rejection?.numeral).toBe('$9,999.00')
  })

  it('rejects a rounded total', () => {
    // AD-7: "rejects rounding that is not itself a returned value". 240.00 is
    // present; 240.5 and 241 are computations.
    expect(accept('Unit 4B owes about $241 for 2026.')).not.toBeNull()
  })

  it('rejects a transposed figure', () => {
    // The single most plausible model error, and the hardest for a human to
    // spot: 420.00 for 240.00.
    expect(accept('Unit 4B owes $420.00 for 2026.')).not.toBeNull()
  })

  it("rejects a figure from a different turn's rows", () => {
    const otherTurn = [{ balanceOutstanding: '77.00' }]

    expect(validateAnswer('The balance is $77.00.', otherTurn)).toBeNull()
    expect(validateAnswer('The balance is $77.00.', ROWS)).not.toBeNull()
  })

  it('rejects on the first offending numeral and names it', () => {
    const rejection = accept('Assessed $1,240.00, leaving $500.00 outstanding.')

    expect(rejection?.numeral).toBe('$500.00')
  })

  it('rejects a hallucinated amount written with a leading dot', () => {
    expect(accept('Unit 4B owes $.50.')).not.toBeNull()
    expect(accept('A fee of .5 percent applies.')).not.toBeNull()
  })

  it.each([
    ['exponent notation', 'Unit 4B owes 1e6.'],
    ['a negative exponent', 'A rate of 1e-6 applies.'],
    ['a three-part fraction', 'Unit 4B owes 1/2/3.'],
  ])('rejects %s, which the tokenizer used to swallow', (_label, answer) => {
    // Each yielded no numerals at all, so the validator had nothing to refuse
    // and accepted a hallucinated answer. Asserted here as well as in the
    // tokenizer, because "is it a candidate" and "is it grounded" are different
    // questions and only the second one ships. Raised by CodeRabbit.
    expect(accept(answer)).not.toBeNull()
  })

  it('rejects an answer whose numbers are right but whose rows are empty', () => {
    // The state where a model answers from its own memory of an earlier turn.
    expect(validateAnswer('Unit 4B owes $240.00.', [])).not.toBeNull()
  })
})

describe('a leading dot is a spelling, not a different number', () => {
  /**
   * The regression that actually existed, asserted where it bites.
   *
   * The tokenizer once required a leading digit, so `$.50` was read as `50` —
   * 5000 minor units — and a **true** answer citing it against a row carrying
   * `0.50` was rejected. Argus raised the gap as a false acceptance; checking
   * the old pattern showed the opposite, and a false rejection is the cliff that
   * gets a guard switched off rather than fixed.
   *
   * This test discriminates the fix. The hallucination case above does not: it
   * passes either way, because the old tokenizer still found `50` and still
   * refused it.
   */
  it('accepts a true answer written with a bare leading dot', () => {
    expect(validateAnswer('A fee of $.50 applies.', [{ fee: '0.50' }])).toBeNull()
    expect(validateAnswer('A fee of .5 percent applies.', [{ rate: '0.50' }])).toBeNull()
  })
})

describe('what a rejection is allowed to say', () => {
  /**
   * A rejection is written where somebody reads it — a log, a retry prompt, an
   * error. The answer being rejected carries a member's balance. Story 3.3's
   * credential scanner shipped the opposite of this and CodeRabbit caught it: it
   * copied 60 characters of the matching line into output the assertion prints.
   */
  it('names the numeral and not the sentence around it', () => {
    const answer = 'Unit 4B, held by Jane Smith, owes $9,999.00 and is 3 months in arrears.'
    const rejection = accept(answer)

    expect(rejection).not.toBeNull()
    expect(rejection?.numeral).toBe('$9,999.00')
    expect(JSON.stringify(rejection)).not.toContain('Jane Smith')
    expect(JSON.stringify(rejection)).not.toContain(answer)
  })

  it('says where it was, so two identical numerals are distinguishable', () => {
    const rejection = accept('It owes $9,999.00.')

    expect(typeof rejection?.index).toBe('number')
  })
})

describe('a numeral this system could not have produced', () => {
  it('rejects more precision than the money contract carries', () => {
    // `numeric(14,2)`. Three decimal places cannot match any stored amount, and
    // treating the parse failure as "no numerals here" would let it through.
    expect(accept('Unit 4B owes $240.005.')).not.toBeNull()
  })
})
