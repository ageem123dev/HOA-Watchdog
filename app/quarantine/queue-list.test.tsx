// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { HeldItem } from '@/core/ports/quarantine-queue'
import { toQueueView } from '@/core/quarantine/queue-view'
import { QueueList } from './queue-list'

const item = (overrides: Partial<HeldItem> = {}): HeldItem => ({
  documentId: 'doc-1',
  filename: 'invoice-april.pdf',
  extractedName: 'Coastal Landscaping',
  ...overrides,
})

// Without `globals: true` in vitest.config.ts, Testing Library never registers
// its automatic cleanup, so every render in this file stays in `document.body`
// and the next test queries both. Measured here: two items produced four
// matching elements. Explicit, because turning globals on for the whole suite to
// fix one file's hygiene is a large lever for a small problem.
afterEach(cleanup)

describe('the quarantine queue list', () => {
  it('shows the extracted name beside the document it came from', () => {
    // AC1. Both halves, because a name with no document is a question nobody can
    // answer and a document with no name is not the question being asked.
    render(<QueueList view={toQueueView([item()])} />)

    expect(screen.getByText('Coastal Landscaping')).toBeDefined()
    expect(screen.getByText('invoice-april.pdf')).toBeDefined()
  })

  it('shows the name exactly as the document said it', () => {
    // AC1's "as the document said it". A CSS transform or a trim would make the
    // surface disagree with the record while still displaying something
    // plausible — and the treasurer is being asked to recognise it.
    const said = 'coastal   LANDSCAPING  &  Sons'

    render(<QueueList view={toQueueView([item({ extractedName: said })])} />)

    // The identity normalizer matters: Testing Library collapses whitespace by
    // default, so `getByText(said)` would pass against a component that had
    // trimmed and squeezed the name. HTML collapses it visually either way —
    // what is asserted here is that the *record* was not rewritten on the way
    // to the page.
    expect(screen.getByText(said, { normalizer: (text) => text })).toBeDefined()
  })

  it('states plainly that nothing is waiting when the queue is empty', () => {
    // AC2. The empty state is a rendered branch, not an absence: returning null
    // gives a blank page that passes every other assertion here.
    render(<QueueList view={toQueueView([])} />)

    expect(screen.getByText(/resolved to known records/i)).toBeDefined()
  })

  it('renders nothing from the list when the queue is empty', () => {
    // Beside the case above, so "shows the sentence" cannot be satisfied by a
    // component that shows the sentence and a stray empty row.
    const { container } = render(<QueueList view={toQueueView([])} />)

    expect(container.querySelectorAll('li')).toHaveLength(0)
  })

  it('keeps two names on one document as two rows', () => {
    // AC5. Rendering the filename once and orphaning the second name is the
    // tidier-looking failure.
    render(
      <QueueList
        view={toQueueView([
          item({ documentId: 'doc-1', extractedName: 'First Unknown' }),
          item({ documentId: 'doc-1', extractedName: 'Second Unknown' }),
        ])}
      />,
    )

    expect(screen.getByText('First Unknown')).toBeDefined()
    expect(screen.getByText('Second Unknown')).toBeDefined()
    expect(screen.getAllByText('invoice-april.pdf')).toHaveLength(2)
  })

  it('offers no control that could resolve anything', () => {
    // AC3. Confirming a vendor is story 1.6d's, and a control that looks
    // actionable but is not is worse than no control — it invites a treasurer to
    // believe they have answered the question.
    const { container } = render(<QueueList view={toQueueView([item()])} />)

    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.querySelectorAll('form')).toHaveLength(0)
    expect(container.querySelectorAll('input')).toHaveLength(0)
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })

  it('shows markup in a name as text rather than interpreting it', () => {
    // AD-8: an extracted value is data, never an instruction. React escapes by
    // default, so this asserts the default was not defeated with
    // dangerouslySetInnerHTML — which is the only way this could go wrong, and
    // is exactly the kind of change that looks like a rendering improvement.
    const hostile = '<img src=x onerror="alert(1)">Acme'

    const { container } = render(
      <QueueList view={toQueueView([item({ extractedName: hostile })])} />,
    )

    expect(screen.getByText(hostile)).toBeDefined()
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })

  it('renders one row per held item', () => {
    const { container } = render(
      <QueueList
        view={toQueueView([
          item({ extractedName: 'One' }),
          item({ extractedName: 'Two' }),
          item({ extractedName: 'Three' }),
        ])}
      />,
    )

    expect(container.querySelectorAll('li')).toHaveLength(3)
  })
})
