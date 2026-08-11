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
 *
 * **The `|\.\d+` alternative, and what missing it actually did.** The first
 * version required a leading digit. Argus raised it as a false *acceptance* —
 * a numeral the tokenizer never sees being one the validator never checks — and
 * that reading is wrong, which was worth establishing before writing it down:
 * `-?\$?\d[\d,]*…` matches `50` inside `$.50`, so a *hallucinated* `$.50` was
 * still refused, just reported as `50`.
 *
 * The real defect ran the other way. A **true** answer citing `$.50` against a
 * row carrying `0.50` was read as `50`, valued at 5000 minor units, and rejected
 * — a false rejection, which is the quiet cliff that gets a guard switched off.
 * Verified by running the old regex rather than by reading it.
 *
 * **The leading `-` is a sign only when a digit does not precede it.** Without
 * the lookbehind, `240.00-500.00` read its second figure as `-500.00` — a
 * negative five hundred that no row carries, so a true range became a false
 * rejection. A hyphen between two digits is a range or a subtraction; a hyphen
 * after a space is a sign.
 *
 * **The exponent group is here to make `1e6` refusable, not readable.** Without
 * it the token fell between the rules — `e` is an identifier character, so `1`
 * was excluded by what followed and `6` by what preceded, and the whole thing
 * vanished. `valueOf` refuses exponent notation, which is correct: no row in
 * this system carries it. The point is that it is refused out loud rather than
 * not seen. Raised by CodeRabbit.
 */
const CANDIDATE = /(?<!\d)-?\$?(?:\d[\d,]*(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?%?/g

/** A character that, adjacent to digits, means the run is part of a name. */
const IDENTIFIER_CHARACTER = /[A-Za-z0-9_@]/

/**
 * A slash date, matched **whole** rather than by adjacency.
 *
 * Adjacency was the first attempt and it was a worse bug than the one it fixed:
 * treating `/` as a generic separator blinded the tokenizer to *any* two numbers
 * with a slash between them, so `$999.00/2026` yielded nothing and the validator
 * accepted a hallucinated amount. A false rejection traded for a false
 * acceptance.
 *
 * A date has a shape, so the shape is what is matched. Everything else with a
 * slash in it — `1/2`, `12/40` — stays a pair of numerals, which may cost a
 * false rejection on prose the model should not have written with digits. That
 * is the right way round: under-strict fails silently and over-strict does not.
 * Raised by Argus on the fix diff.
 *
 * **The four-digit year is load-bearing.** The first version asked only for
 * digit-slash-digit-slash-digit, which swallowed `1/2/3` and every numeral in
 * it. Dates in this system are ISO-8601 per the Consistency Conventions, so a
 * date a model spells with slashes still carries a four-digit year — and
 * requiring one is what keeps this pattern from eating arbitrary triples.
 * Raised by CodeRabbit.
 */
const SLASH_DATE = /\d{4}\/\d{1,2}\/\d{1,2}|\d{1,2}\/\d{1,2}\/\d{4}/

/**
 * Every shape whose digits are structure rather than quantity, matched **whole**.
 *
 * This replaced an adjacency rule, and the replacement is the point. Excluding a
 * digit run because a hyphen or colon with a digit on the far side touched it
 * removed ISO dates and timestamps — and removed ordinary pairs with them.
 * `240.00-500.00` is a range a model would plausibly write, and every numeral in
 * it disappeared, so a hallucinated range was accepted in silence.
 *
 * Nothing in the suite failed, and that is the instructive part: the exclusion
 * tests asserted only that a date yields *nothing*, which a rule yielding
 * nothing for everything satisfies just as well. An assertion that something is
 * absent cannot tell "correctly excluded" from "never seen".
 *
 * A shape has a shape. Listing them costs a line each and cannot over-reach.
 * Raised by CodeRabbit on MR !42.
 */
const EXCLUDED_SHAPES = [
  // Timestamp before date: the union of spans makes order irrelevant, but the
  // longer shape is listed first so a reader meets the specific case first.
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[-+]\d{2}:\d{2})?/,
  /\d{4}-\d{2}-\d{2}/,
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
  SLASH_DATE,
]

export function numeralsIn(text: string): readonly Numeral[] {
  const found: Numeral[] = []
  const excluded = excludedSpans(text)

  for (const match of text.matchAll(CANDIDATE)) {
    const start = match.index
    const token = match[0]
    const end = start + token.length

    // The **whole** token against the whole span, not just its start. No shape
    // here can begin mid-candidate today, so a start-only test happens to be
    // right — and it stops being right the moment the list above grows, which
    // is the sort of correctness that expires without anything failing. Raised
    // by CodeRabbit.
    const overlapsAShape = excluded.some(([from, to]) => start < to && end > from)
    if (overlapsAShape) continue

    if (isQuantity(text, start, token)) {
      found.push({ text: token, index: start })
    }
  }

  return found
}

function excludedSpans(text: string): readonly (readonly [number, number])[] {
  const spans: (readonly [number, number])[] = []

  for (const shape of EXCLUDED_SHAPES) {
    // A fresh global regex per call: the sources are module constants, and
    // sharing a `lastIndex` across calls is how a scanner starts returning
    // different answers for the same input.
    for (const match of text.matchAll(new RegExp(shape.source, 'g'))) {
      spans.push([match.index, match.index + match[0].length])
    }
  }

  return spans
}

function isQuantity(text: string, start: number, token: string): boolean {
  const before = text[start - 1]
  const after = text[start + token.length]

  // `4B`, `v1`, `unit_2_summary`, `dues_status@1` — a letter, digit, underscore
  // or `@` touching the run means it names something rather than counts it.
  if (before !== undefined && IDENTIFIER_CHARACTER.test(before)) return false
  if (after !== undefined && IDENTIFIER_CHARACTER.test(after)) return false

  // `07-B`. A hyphen with a *letter* on the far side is part of a name, not a
  // minus sign — the separator rule below only looks for digits, so this shape
  // walked through it. Note that `unit-07-summary` was already excluded, but for
  // an accidental reason: the leading `-` in `CANDIDATE` is optional, so the
  // match starts at the hyphen and puts a letter adjacent to it. Relying on that
  // is relying on a regex detail, so the rule is stated here too.
  if (after === '-' && /[A-Za-z]/.test(text[start + token.length + 1] ?? '')) return false
  if (before === '-' && /[A-Za-z]/.test(text[start - 2] ?? '')) return false

  // Dates, timestamps and uuids are handled by `EXCLUDED_SHAPES` above, as whole
  // shapes. There is deliberately no separator-adjacency rule here any more: it
  // could not tell `2026-07-01` from `240.00-500.00`, and silently ate both.

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
  // A bare leading dot is a spelling of the same value, so it is normalized
  // rather than rejected — `.5` is `0.5`. `toMinorUnits` requires the digit and
  // is right to: it parses stored amounts, which never arrive that way.
  // A replacer function, not `'$10.'`. That string is *correct* — with fewer
  // than ten capture groups JavaScript reads it as group 1 followed by `0.` —
  // and it reads like a reference to group 10, which is a trap for whoever adds
  // a second group. Raised by Argus.
  const bare = numeral.replace(/[$,%]/g, '').replace(/^(-?)\./, (_match, sign: string) => `${sign}0.`)

  if (!/^-?\d+(?:\.\d+)?$/.test(bare)) {
    throw new TypeError(`not a numeral: ${JSON.stringify(numeral.slice(0, 40))}`)
  }

  // `toMinorUnits` enforces the two-place limit and rejects everything wider,
  // which is the check this needs. Not re-implemented here.
  return toMinorUnits(bare)
}
