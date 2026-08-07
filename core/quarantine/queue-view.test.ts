import { describe, expect, it } from 'vitest'

import type { HeldItem } from '../ports/quarantine-queue'
import { toQueueView } from './queue-view'

const item = (overrides: Partial<HeldItem> = {}): HeldItem => ({
  documentId: 'doc-1',
  filename: 'invoice.pdf',
  extractedName: 'Coastal Landscaping',
  ...overrides,
})

describe('the quarantine queue view', () => {
  it('carries the held items through', () => {
    const items = [item()]

    expect(toQueueView(items).items).toEqual(items)
  })

  it('reports an empty queue as empty', () => {
    // The flag belongs to the view rather than to each surface that renders it.
    // Two callers deciding separately is two definitions of "nothing is waiting",
    // and the empty state is an acceptance criterion of its own (AC2).
    expect(toQueueView([]).isEmpty).toBe(true)
  })

  it('reports a queue with one item as not empty', () => {
    // Beside the case above deliberately: `isEmpty: true` for everything would
    // satisfy the previous test on its own.
    expect(toQueueView([item()]).isEmpty).toBe(false)
  })

  it('counts what it carries', () => {
    // Cross-check. A view that dropped an item while reporting the old count
    // would pass `items` and `count` assertions taken separately.
    const items = [item({ extractedName: 'A' }), item({ extractedName: 'B' })]

    const view = toQueueView(items)

    expect(view.count).toBe(2)
    expect(view.count).toBe(view.items.length)
  })

  it('keeps two names on one document as two entries', () => {
    // AC5. Grouping or de-duplicating by document would read as tidier and would
    // silently answer only the first of two questions.
    const items = [
      item({ documentId: 'doc-1', extractedName: 'First Unknown' }),
      item({ documentId: 'doc-1', extractedName: 'Second Unknown' }),
    ]

    expect(toQueueView(items).items).toHaveLength(2)
  })

  it('does not re-order what it was given', () => {
    // AC6. The query fixes the order; a second rule here would be a second
    // answer to "which is first". Input is deliberately not alphabetical, so a
    // sort would be visible.
    const items = [
      item({ extractedName: 'Zulu' }),
      item({ extractedName: 'Alpha' }),
      item({ extractedName: 'Mike' }),
    ]

    expect(toQueueView(items).items.map((i) => i.extractedName)).toEqual(['Zulu', 'Alpha', 'Mike'])
  })

  it('leaves the caller its own array', () => {
    // Returning the same reference lets a later caller sort the view in place and
    // change what the adapter handed over. Cheap to prevent, invisible when it
    // happens.
    const items = [item()]

    const view = toQueueView(items)

    expect(view.items).not.toBe(items)
    expect(items).toHaveLength(1)
  })

  it('passes an unusual name through rather than inventing one', () => {
    // The database forbids a blank name, so a placeholder here would be dead
    // code guarding an unreachable case — and if it ever did run it would put
    // words in a document's mouth. AC1 asks for the name as the document said
    // it; that is the whole contract.
    const odd = '  Ünïcode  &  <Ampersands>  '

    expect(toQueueView([item({ extractedName: odd })]).items[0]?.extractedName).toBe(odd)
  })
})

describe('the view carrying suggestions', () => {
  const candidate = (id: string, displayName: string, score: number) => ({
    id,
    displayName,
    score,
  })

  it('offers a row the candidates found for its name', () => {
    const view = toQueueView([item({ extractedName: 'Acme Plumbing' })], {
      'acme plumbing': [candidate('v1', 'Acme Plumbing Co', 0.9)],
    })

    expect(view.suggestionsFor('Acme Plumbing').map((c) => c.id)).toEqual(['v1'])
  })

  it('finds them for a different spelling of the same name', () => {
    // F1. The lookup and the key must fold the same way, or a row whose
    // spelling differs from the key silently offers nothing — which looks
    // exactly like a name with no similar vendors.
    const view = toQueueView([item({ extractedName: 'ACME   plumbing  ' })], {
      'acme plumbing': [candidate('v1', 'Acme Plumbing Co', 0.9)],
    })

    expect(view.suggestionsFor('ACME   plumbing  ').map((c) => c.id)).toEqual(['v1'])
  })

  it('keeps the ranking it was given', () => {
    // F2. `suggest()` orders by similarity. Re-sorting here would replace a
    // measured ranking with an alphabetical one that looks just as deliberate.
    const view = toQueueView([item({ extractedName: 'Acme' })], {
      acme: [candidate('v1', 'Zulu Services', 0.8), candidate('v2', 'Alpha Supply', 0.4)],
    })

    expect(view.suggestionsFor('Acme').map((c) => c.displayName)).toEqual([
      'Zulu Services',
      'Alpha Supply',
    ])
  })

  it('offers none for a name nothing matched', () => {
    const view = toQueueView([item({ extractedName: 'Nobody' })], {})

    expect(view.suggestionsFor('Nobody')).toEqual([])
  })

  it('offers none when no suggestions were supplied at all', () => {
    // F3. The argument is optional so story 1.6c's callers and its assertions on
    // `items` keep working untouched — that shape is still correct and this
    // story has no business editing it.
    const view = toQueueView([item({ extractedName: 'Nobody' })])

    expect(view.suggestionsFor('Nobody')).toEqual([])
  })

  it('marks nothing as chosen', () => {
    // F4 and AC4. There is no selection on the view at all, so there is nothing
    // for a surface to preselect — `suggest`'s own header warns that a caller
    // treating the first entry as an answer has reintroduced automatic
    // near-matching.
    const view = toQueueView([item({ extractedName: 'Acme' })], {
      acme: [candidate('v1', 'Acme Co', 0.9)],
    })

    expect(Object.keys(view.suggestionsFor('Acme')[0] ?? {}).sort()).toEqual([
      'displayName',
      'id',
      'score',
    ])
  })
})

describe('a held name that collides with Object.prototype', () => {
  it('offers none for a name that folds to a prototype member', () => {
    // Raised in review. `suggestions['constructor']` on a plain object returns
    // the Object constructor, not undefined, so `?? []` never fires and the
    // caller gets a function where it expects an array.
    //
    // "No vendor is called that" is the reasoning this project has been wrong
    // about twice, and AD-8 is explicit that an extracted value is untrusted
    // data. The name arrives from a document.
    const view = toQueueView([item({ extractedName: 'constructor' })], {})

    expect(view.suggestionsFor('constructor')).toEqual([])
  })

  it('offers none for every prototype member, not just constructor', () => {
    // One case would be fixed by special-casing that one string.
    const view = toQueueView([], {})

    for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect(view.suggestionsFor(name)).toEqual([])
    }
  })
})
