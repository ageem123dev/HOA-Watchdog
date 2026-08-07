import { describe, expect, it } from 'vitest'

import type { HeldItem } from '../ports/quarantine-queue'
import { distinctNamesForSuggestions, suggestionKey } from './suggestions'

const item = (extractedName: string, documentId = 'doc-1'): HeldItem => ({
  documentId,
  filename: 'invoice.pdf',
  extractedName,
})

describe('choosing which names to ask about', () => {
  it('asks about each held name', () => {
    expect(distinctNamesForSuggestions([item('Coastal Landscaping')])).toEqual([
      'Coastal Landscaping',
    ])
  })

  it('asks once for two spellings of one name', () => {
    // E1. Two documents held for the same vendor are one question asked twice.
    // Deduplicating on the raw string would ask twice and — worse — file the two
    // answers under different keys, so one row would silently offer none.
    const names = distinctNamesForSuggestions([
      item('Acme Plumbing', 'doc-1'),
      item('ACME   plumbing  ', 'doc-2'),
    ])

    expect(names).toHaveLength(1)
  })

  it('asks using the spelling the document used, not the folded form', () => {
    // E2. `suggest()` ranks by trigram similarity against what was written; a
    // folded string is a different query and would rank differently.
    expect(distinctNamesForSuggestions([item('ACME   plumbing  ')])).toEqual(['ACME   plumbing  '])
  })

  it('keeps the first spelling when two collide', () => {
    const names = distinctNamesForSuggestions([
      item('Acme Plumbing', 'doc-1'),
      item('ACME PLUMBING', 'doc-2'),
    ])

    expect(names).toEqual(['Acme Plumbing'])
  })

  it('asks about nothing when the queue is empty', () => {
    // E3. Zero, one, many.
    expect(distinctNamesForSuggestions([])).toEqual([])
  })

  it('keeps two genuinely different names apart', () => {
    // Beside the dedupe cases: a function returning one name always would pass
    // every assertion above.
    expect(distinctNamesForSuggestions([item('Acme', 'a'), item('Beta', 'b')])).toEqual([
      'Acme',
      'Beta',
    ])
  })

  it('keys a name the same way the database indexes it', () => {
    // The key is what joins a row to its answers, and the database's unique
    // index uses the same rule. Two definitions of "the same name" is the defect
    // the whole of epic story 1.6 exists to prevent.
    expect(suggestionKey('Acme  Plumbing')).toBe(suggestionKey('ACME plumbing'))
    expect(suggestionKey('Acme')).not.toBe(suggestionKey('Beta'))
  })
})
