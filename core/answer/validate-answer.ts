/**
 * AD-7 — numbers are provenance-bound, not prompt-restricted.
 *
 * "Every numeric token in a rendered answer must match a value present in the
 * tool result set for that turn. A pre-render validator rejects any unreferenced
 * numeral and forces a retry. […] **This supersedes NFR-3's system-prompt
 * mechanism; prompt directives may remain as defence in depth but carry no
 * enforcement weight.**"
 *
 * The reason that supersession matters is worth carrying into the code: a prompt
 * is a request. It fails silently, it fails more often on the confusing turn,
 * and nothing downstream can tell a compliant answer from a lucky one. This
 * function is a property of the code, so it holds on the turn where the model is
 * confused — which is the only turn that matters.
 *
 * ## It never computes
 *
 * There is no arithmetic here, deliberately. AD-6 requires catalog entries to
 * return every value their answers reference, "**including derived ones** —
 * deltas, percentages, trailing averages, counts". So if an answer needs a
 * number the rows do not carry, the correct outcome is a rejection and a new
 * catalog entry, not a subtraction in this file. A validator that derived values
 * would accept exactly the figures a model is most likely to get wrong.
 *
 * ## What a rejection may say
 *
 * The numeral and its position. Never the sentence. A rejection is written where
 * somebody reads it — a log, a retry prompt, an error — and the answer being
 * rejected carries a member's balance and possibly their name. Story 3.3's
 * credential scanner shipped the opposite and CodeRabbit caught it: it copied 60
 * characters of the matching line into output the assertion prints.
 */

import { numeralsIn, valueOf } from './numerals'

export interface Rejection {
  /** The offending token, exactly as it appeared. */
  readonly numeral: string

  /** Where it was, so two identical numerals are distinguishable. */
  readonly index: number

  /** Why, in words safe to log. Carries no part of the answer but the numeral. */
  readonly reason: string
}

/**
 * Every value the rows make available, in minor units.
 *
 * Walks nested structures, because a catalog entry may return a shaped object
 * and a number inside one is still a number the answer may cite.
 *
 * A string counts only if it is an amount. `unitNumber: '4B'` contributes
 * nothing — if it contributed `4`, an answer citing four of anything would be
 * accepted on the strength of a unit's name.
 */
export function valuesAvailableIn(rows: readonly unknown[]): ReadonlySet<number> {
  const values = new Set<number>()

  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return

    if (typeof node === 'number') {
      // Integers only. A float in a row is not the money contract — amounts
      // cross as decimal strings — so it is something else, and rounding it into
      // minor units would invent a value.
      if (Number.isSafeInteger(node)) values.add(node * 100)
      return
    }

    if (typeof node === 'string') {
      try {
        values.add(valueOf(node))
      } catch {
        // Not an amount. `'4B'`, `'dues_status'`, a date — none of them is a
        // value an answer may cite as a quantity.
      }
      return
    }

    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }

    if (typeof node === 'object') {
      for (const item of Object.values(node as Record<string, unknown>)) walk(item)
    }
  }

  walk(rows)

  return values
}

/**
 * `null` if every numeral in the answer came from the rows; the first offending
 * numeral otherwise.
 *
 * First rather than all: the caller's next move is identical either way — retry
 * — and collecting every offender means holding more of the answer to report.
 */
export function validateAnswer(answer: string, rows: readonly unknown[]): Rejection | null {
  const available = valuesAvailableIn(rows)

  for (const numeral of numeralsIn(answer)) {
    let value: number

    try {
      value = valueOf(numeral.text)
    } catch {
      // Unparsable *as a quantity this system can hold* — more precision than
      // `numeric(14,2)`, for instance. Rejected rather than skipped: treating a
      // parse failure as "no numeral here" is the hole through which a
      // fabricated figure walks, and it would be silent.
      return {
        numeral: numeral.text,
        index: numeral.index,
        reason: 'not a quantity this system can produce',
      }
    }

    if (!available.has(value)) {
      return {
        numeral: numeral.text,
        index: numeral.index,
        reason: 'does not appear in the rows this answer was drawn from',
      }
    }
  }

  return null
}
