import { ALL_ENTRIES } from './registry'
import type { CatalogEntry } from './entry'

/**
 * A question this catalog can actually answer, in a reader's words.
 *
 * Two surfaces need one: the dashboard ask field, which shows it as a
 * placeholder so people learn what to type, and the Oracle's no-catalog-match
 * state, which offers it as the single action UX-DR17 requires. They must not
 * drift apart, and they must not be written by hand.
 *
 * ## Why hand-written copy is the failure here
 *
 * AD-5 fixes the catalog, so a capability the copy claims and the catalog lacks
 * is not a stale sentence — it is a promise that fails every time somebody
 * accepts it. The UX spec's own example names four things (*"dues status,
 * payment history, vendor totals, and invoice comparisons"*) and this catalog
 * holds **one**. Copy written from that example would be wrong three times out
 * of four, and would look completely reasonable in review.
 *
 * ## The pin
 *
 * `EXAMPLES` is keyed by catalog entry id, and a test asserts its keys are
 * exactly the ids in `ALL_ENTRIES`. Adding an entry without writing its example
 * fails; removing one and leaving its example behind fails. The copy cannot
 * outgrow the catalog silently, which is the whole of AC2.
 */

/**
 * One example question per registered entry.
 *
 * Each is phrased the way somebody would actually ask it, and stays inside what
 * its entry is scoped to. `dues_status@1` covers **one unit and one assessment
 * year**, so its example names one of each — an example spanning six months
 * would teach people to ask a question that is guaranteed to fail.
 */
const EXAMPLES: Readonly<Record<string, string>> = {
  dues_status: 'What does unit 4B owe for 2026?',
}

export interface SuggestedQuestion {
  /** The question, ready to show or to put in a `?q=`. */
  readonly text: string

  /** Which entry would answer it — `dues_status`. */
  readonly entryId: string
}

/**
 * The nearest supported question.
 *
 * Takes the entries as an argument so tests can pass a catalog that is empty or
 * larger than today's, rather than only ever exercising the one that exists.
 *
 * Returns `null` for an empty catalog. That is a real state — a deployment whose
 * registry has not been populated — and the honest surface for it says nothing
 * can be asked yet, rather than offering a question that will fail.
 */
export function suggestedQuestion(
  entries: readonly CatalogEntry[] = ALL_ENTRIES,
): SuggestedQuestion | null {
  for (const entry of entries) {
    const text = EXAMPLES[entry.id]
    if (text !== undefined) return { text, entryId: entry.id }
  }

  return null
}

/** Exposed for the test that pins these keys against the registry. */
export const EXAMPLE_IDS: readonly string[] = Object.keys(EXAMPLES)
