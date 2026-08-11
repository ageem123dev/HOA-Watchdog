/**
 * Which characters in an answer are a quantity, and what that quantity is worth.
 *
 * AD-7: "Every numeric token in a rendered answer must match a value present in
 * the tool result set for that turn. […] The validator carries an explicit
 * normalization rule for formatting (`1240` ≡ `$1,240.00`)."
 *
 * This is that rule, and it is deliberately the only statement of it. Story
 * 3.6's renderer consumes `valueOf` rather than restating how an amount is
 * spelled — two statements of one shape with nothing failing on disagreement is
 * the mistake migration 007's comment records, and here the disagreement would
 * be a *rejected true answer*, which is the failure mode that gets a guard
 * switched off.
 *
 * ## The identifier problem, which is most of this file
 *
 * A `\d+` sweep is the obvious tokenizer and it is wrong in this system, because
 * this system emits strings whose digits are not quantities:
 *
 *   unit `4B` · catalog reference `dues_status@1` · date `2026-07-01`
 *   version `v1` · provenance id `018f3a2b-0000-…`
 *
 * Every one of those would be torn into digits, none of them appears in a result
 * set as a number, and each would therefore reject an answer that was true. So a
 * numeral is a run of digits that is **not touching** a letter, an underscore,
 * an `@`, or a hyphen with digits on the far side.
 *
 * The rule is stated here and tested in both directions in `numerals.test.ts` —
 * over-strict and under-strict are both cliffs, and only the second one is loud.
 *
 * ## Value, not text
 *
 * Comparison happens in **minor units**, via `core/assessment/minor-units.ts`.
 * That module is strict on purpose — no `$`, no thousands separators — so
 * presentation is stripped here and the strict contract is left intact rather
 * than loosened for a renderer's convenience.
 */

import { toMinorUnits } from '../assessment/minor-units'

export interface Numeral {
  /** Exactly as it appeared, so a rejection can quote the token and nothing else. */
  readonly text: string

  /** Where it started, so two identical numerals are distinguishable. */
  readonly index: number
}

/**
 * A candidate numeral: an optional sign and currency symbol, digits with
 * optional thousands separators, an optional fraction, an optional percent.
 *
 * Deliberately permissive about *spelling* — narrowing happens in `isQuantity`,
 * where the surrounding characters decide. Splitting it this way keeps "what a
 * number looks like" and "what makes it an identifier" as two rules that can be
 * read and tested separately.
 */
const CANDIDATE = /-?\$?\d[\d,]*(?:\.\d+)?%?/g

/** A character that, adjacent to digits, means the run is part of a name. */
const IDENTIFIER_CHARACTER = /[A-Za-z0-9_@]/

export function numeralsIn(text: string): readonly Numeral[] {
  const found: Numeral[] = []

  for (const match of text.matchAll(CANDIDATE)) {
    const start = match.index
    const token = match[0]

    if (isQuantity(text, start, token)) {
      found.push({ text: token, index: start })
    }
  }

  return found
}

function isQuantity(text: string, start: number, token: string): boolean {
  const before = text[start - 1]
  const after = text[start + token.length]

  // `4B`, `v1`, `unit_2_summary`, `dues_status@1` — a letter, digit, underscore
  // or `@` touching the run means it names something rather than counts it.
  if (before !== undefined && IDENTIFIER_CHARACTER.test(before)) return false
  if (after !== undefined && IDENTIFIER_CHARACTER.test(after)) return false

  // `2026-07-01`, `018f3a2b-0000-…` and the `09:30:00` half of a timestamp.
  //
  // A hyphen is a minus sign between a space and a digit, and a *separator*
  // between two digits — the difference is whether there is a digit on the far
  // side of it. A colon is the same rule, and it is the one the first version
  // missed: the date half of an ISO timestamp was excluded by its hyphens while
  // the time half walked straight through, so `2026-07-01T09:30:00Z` yielded
  // `30` and `00` as quantities.
  const separators = ['-', ':']
  if (separators.includes(before ?? '') && /\d/.test(text[start - 2] ?? '')) return false
  if (separators.includes(after ?? '') && /\d/.test(text[start + token.length + 1] ?? '')) {
    return false
  }

  return true
}

/**
 * What a numeral is worth, in minor units.
 *
 * Presentation is stripped, then `toMinorUnits` does the arithmetic — which
 * means the exactness argument in its header carries through here rather than
 * being re-made. `Number('0.29') * 100` is 28.999999999999996, and that bug is
 * correct in testing and wrong in an association's ledger.
 *
 * Throws on anything that is not a numeral, and on more precision than
 * `numeric(14,2)` can hold. Three decimal places is not a formatting variant of
 * a stored amount; it is a number this system cannot have produced, so treating
 * it as one would let a fabricated figure match by rounding.
 */
export function valueOf(numeral: string): number {
  const bare = numeral.replace(/[$,%]/g, '')

  if (!/^-?\d+(?:\.\d+)?$/.test(bare)) {
    throw new TypeError(`not a numeral: ${JSON.stringify(numeral.slice(0, 40))}`)
  }

  // `toMinorUnits` enforces the two-place limit and rejects everything wider,
  // which is the check this needs. Not re-implemented here.
  return toMinorUnits(bare)
}
