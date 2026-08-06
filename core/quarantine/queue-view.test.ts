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
