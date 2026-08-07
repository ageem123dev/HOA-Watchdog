import type { HeldItem } from '../ports/quarantine-queue'
import { normaliseVendorName } from '../vendor/name'

/**
 * How a held name is matched to the candidates offered for it.
 *
 * The same rule the database indexes under, deliberately. Two definitions of
 * "the same name" is the defect the whole of epic story 1.6 exists to prevent,
 * and it would surface here as a row whose answers were filed under a key it
 * never looks up -- offering no candidates, silently, for a name that has
 * several obvious ones.
 */
export function suggestionKey(extractedName: string): string {
  return normaliseVendorName(extractedName)
}

/**
 * The names worth asking about, one per distinct vendor.
 *
 * Two documents held for the same vendor are one question asked twice, so they
 * cost one lookup rather than two. On a queue where every name differs this is
 * still one call per row, which is the honest cost of ranking candidates for
 * each: the queue is a human work list, and if it ever grows past that the
 * answer is a batched query, not a cache.
 *
 * The *first spelling* is returned, not the folded key. `suggest()` ranks by
 * similarity to what was actually written, and handing it a normalised string
 * would rank a different query than the one the treasurer is looking at.
 */
export function distinctNamesForSuggestions(items: readonly HeldItem[]): readonly string[] {
  const seen = new Set<string>()
  const names: string[] = []

  for (const held of items) {
    const key = suggestionKey(held.extractedName)
    if (seen.has(key)) continue

    seen.add(key)
    names.push(held.extractedName)
  }

  return names
}
