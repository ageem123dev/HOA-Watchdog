import { describe, expect, it } from 'vitest'

import { ALL_ENTRIES } from './registry'
import { EXAMPLE_IDS, suggestedQuestion } from './suggested-question'
import type { CatalogEntry } from './entry'

/**
 * The pin AC2 asks for.
 *
 * AD-5 fixes the catalog, so copy claiming a capability the catalog lacks is not
 * a stale sentence — it is a promise that fails every time somebody accepts it.
 * The UX spec's own example names four capabilities and this catalog holds one.
 */

const entry = (id: string): CatalogEntry => ({ id }) as CatalogEntry

describe('the examples cannot drift from the catalog', () => {
  it('has an example for every registered entry, and no others', () => {
    // Both directions in one assertion. Adding an entry without writing its
    // example fails here; leaving an example behind after removing its entry
    // fails here too. Either alone would let the copy rot in one direction.
    //
    // Deduplicated, because `ALL_ENTRIES` holds one object per *version* and
    // `indexEntries` accepts two versions of one id — verified, not assumed.
    // Comparing the raw list would fail the day `dues_status@2` is published,
    // which is a false alarm about copy that is still perfectly correct: the
    // example belongs to the entry, not to the version. Raised by Argus.
    const registered = [...new Set(ALL_ENTRIES.map((e) => e.id))].sort()

    expect([...EXAMPLE_IDS].sort()).toEqual(registered)
  })

  it('still fails when a genuinely new entry has no example', () => {
    // The positive control for the dedup above: relaxing the comparison must not
    // relax what it is for. A second *id* is still a gap in the copy.
    const ids = [...new Set([...ALL_ENTRIES.map((e) => e.id), 'vendor_totals'])].sort()

    expect([...EXAMPLE_IDS].sort()).not.toEqual(ids)
  })

  it('names an entry that actually exists', () => {
    const suggestion = suggestedQuestion()

    expect(suggestion).not.toBeNull()
    expect(ALL_ENTRIES.map((e) => e.id)).toContain(suggestion!.entryId)
  })
})

describe('what it offers', () => {
  it('stays inside what its entry can answer', () => {
    // `dues_status@1` covers one unit and one assessment year. An example
    // spanning six months would teach people to ask a question guaranteed to
    // fail — which is the failure UX-DR17 exists to prevent, manufactured by
    // the surface meant to prevent it.
    const { text } = suggestedQuestion()!

    expect(text).toMatch(/\bunit\b/i)
    expect(text).toMatch(/\d{4}/)
    for (const absent of [/payment history/i, /vendor/i, /invoice/i, /months/i]) {
      expect(text).not.toMatch(absent)
    }
  })

  it('returns null for a catalog with nothing in it', () => {
    // A real state: a deployment whose registry has not been populated. The
    // surface must then say nothing can be asked yet, rather than offer a
    // question that will fail.
    expect(suggestedQuestion([])).toBeNull()
  })

  it('returns null when no entry has an example written yet', () => {
    // Distinct from the empty catalog, and the more likely of the two: somebody
    // adds an entry and ships before writing its copy. Offering another entry's
    // question would be answering a different question than the one asked.
    expect(suggestedQuestion([entry('vendor_totals')])).toBeNull()
  })

  it('picks an entry that has one, when only some do', () => {
    // The positive control for the case above. Without it, a function that
    // always returned null would pass both null tests.
    const suggestion = suggestedQuestion([entry('vendor_totals'), entry('dues_status')])

    expect(suggestion?.entryId).toBe('dues_status')
  })
})
