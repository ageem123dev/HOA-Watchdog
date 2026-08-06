import type { VendorSuggestion } from '../ports/vendor-directory'
import type { HeldItem } from '../ports/quarantine-queue'
import { suggestionKey } from './suggestions'

/**
 * What the queue surface renders.
 *
 * A separate shape from `readonly HeldItem[]` for one reason: emptiness is a
 * decision, and AC2 makes it a criterion of its own. Left to each caller,
 * "nothing is waiting" gets defined once per surface and they can disagree.
 * Decided here, once.
 */
export interface QueueView {
  readonly items: readonly HeldItem[]
  readonly isEmpty: boolean
  readonly count: number
  suggestionsFor(extractedName: string): readonly VendorSuggestion[]
}

/**
 * Candidates for each held name, keyed by the folded form.
 *
 * Folded on both sides deliberately. Keying on the raw spelling means a row
 * whose name differs by a space or a capital finds nothing and offers no
 * candidates -- which is indistinguishable, on the page, from a name that
 * genuinely resembles no vendor.
 */
export type SuggestionsByName = Readonly<Record<string, readonly VendorSuggestion[]>>

/**
 * The order is the query's, and stays the query's.
 *
 * Sorting here would look harmless and would be a second answer to "which is
 * first" -- the adapter already fixed one, breaking `created_at` ties by id so
 * two renders of an unchanged queue agree. Nothing is grouped or de-duplicated
 * either: a document held for two unrecognised names is two questions, not one
 * document carrying a list.
 *
 * Suggestions sit beside `items` rather than inside them. Story 1.6c pins the
 * shape of a held item with an exact allow-list, and that shape is still
 * correct -- widening it would make this story edit an assertion that is not
 * wrong. Nothing here marks a candidate as chosen, either: there is no selection
 * on the view at all, so a surface has nothing to preselect, and `suggest`'s own
 * header warns that treating the first entry as an answer reintroduces the
 * automatic near-matching this epic exists to prevent.
 *
 * A blank name is not defended against. The column forbids it, so a placeholder
 * would be unreachable -- and on the day it did run it would show a treasurer a
 * name no document ever contained, while they are being asked to recognise one.
 */
export function toQueueView(
  items: readonly HeldItem[],
  suggestions: SuggestionsByName = {},
): QueueView {
  // Copied, so a caller sorting the view in place cannot reach back through it
  // and reorder what the adapter returned.
  const held = [...items]

  return {
    items: held,
    isEmpty: held.length === 0,
    count: held.length,
    suggestionsFor: (extractedName) => {
      // `Object.hasOwn`, not `?? []`. A plain object inherits `constructor`,
      // `toString` and the rest, so a name folding to one of those returns a
      // function where the caller expects an array -- and `?? []` never fires,
      // because the value is not nullish. Raised in review; "no vendor is called
      // that" is the reasoning this project has been wrong about twice, and AD-8
      // says an extracted value is untrusted data.
      const key = suggestionKey(extractedName)

      return Object.hasOwn(suggestions, key) ? (suggestions[key] ?? []) : []
    },
  }
}
