/**
 * Search text, as a `LIKE` pattern.
 *
 * ## Why this is tested here and not only through the database
 *
 * `npm test` — the gate every change runs — **skips the db suite**. The escaping
 * below is the difference between a search box and a pattern language, and its
 * first version was wrong: `_` went unescaped, so `_oastal` matched `Coastal`
 * and a search appeared to work while answering a different question. That was
 * caught by a db test, which most runs never execute.
 *
 * So the rule is asserted where it is always run. The db tests still prove the
 * pattern reaches Postgres and means there what it means here — a unit test
 * cannot know that `escape` is wired up, and the version of this query that
 * rendered `escape ''` from a template literal passed every assertion in this
 * file.
 */

import { describe, expect, it } from 'vitest'

import { likePattern } from './finding-reader-postgres'

describe('a search becomes a pattern that matches it literally', () => {
  it('wraps ordinary text so it matches anywhere in the value', () => {
    expect(likePattern('Coastal')).toBe('%Coastal%')
  })

  it('escapes the any-run wildcard', () => {
    // Unescaped, a search for `%` matches every row and reports the whole
    // register as a hit.
    expect(likePattern('50%')).toBe('%50\\%%')
  })

  it('escapes the single-character wildcard', () => {
    // The one the first version missed. `_oastal` silently matches `Coastal`,
    // `Roastal` and anything else of that shape.
    expect(likePattern('_oastal')).toBe('%\\_oastal%')
  })

  it('escapes the escape character itself, and does it first', () => {
    // Order matters. Escaping the backslash *after* the wildcards would escape
    // the backslashes this function had just added, turning `\%` back into a
    // literal backslash followed by a live wildcard.
    expect(likePattern('a\\b')).toBe('%a\\\\b%')
  })

  it('leaves a value that is only wildcards matching nothing but itself', () => {
    expect(likePattern('%_%')).toBe('%\\%\\_\\%%')
  })

  it('keeps a vendor name with punctuation intact', () => {
    // Nothing else is touched: these are names off real invoices, and a search
    // that quietly rewrote them would stop finding the row it came from.
    expect(likePattern("O'Brien & Sons (Ltd.)")).toBe("%O'Brien & Sons (Ltd.)%")
  })

  it('passes an empty string through as a match-anything pattern', () => {
    // Callers are expected to have decided *before* here that an empty search is
    // no search at all — `RegisterFilter.search` says so and the adapter does
    // it. This function does not guess, so that decision stays in one place.
    expect(likePattern('')).toBe('%%')
  })
})
