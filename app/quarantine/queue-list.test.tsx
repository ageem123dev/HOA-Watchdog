// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { HeldItem } from '@/core/ports/quarantine-queue'
import { toQueueView } from '@/core/quarantine/queue-view'
import { QueueList } from './queue-list'

/**
 * The actions are props, so these tests need no server at all. When the
 * component imported them directly, `'use server'` pulled `next-auth` in and
 * this file stopped loading — a design problem the suite reported as an import
 * error.
 */
const noop = () => undefined

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
    render(<QueueList confirmAction={noop} matchAction={noop} view={toQueueView([item()])} />)

    expect(screen.getByText('Coastal Landscaping')).toBeDefined()
    expect(screen.getByText('invoice-april.pdf')).toBeDefined()
  })

  it('shows the name exactly as the document said it', () => {
    // AC1's "as the document said it". A CSS transform or a trim would make the
    // surface disagree with the record while still displaying something
    // plausible — and the treasurer is being asked to recognise it.
    const said = 'coastal   LANDSCAPING  &  Sons'

    render(<QueueList confirmAction={noop} matchAction={noop} view={toQueueView([item({ extractedName: said })])} />)

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
    render(<QueueList confirmAction={noop} matchAction={noop} view={toQueueView([])} />)

    expect(screen.getByText(/resolved to known records/i)).toBeDefined()
  })

  it('renders nothing from the list when the queue is empty', () => {
    // Beside the case above, so "shows the sentence" cannot be satisfied by a
    // component that shows the sentence and a stray empty row.
    const { container } = render(<QueueList confirmAction={noop} matchAction={noop} view={toQueueView([])} />)

    expect(container.querySelectorAll('li')).toHaveLength(0)
  })

  it('keeps two names on one document as two rows', () => {
    // AC5. Rendering the filename once and orphaning the second name is the
    // tidier-looking failure.
    render(
      <QueueList
        confirmAction={noop}
        matchAction={noop}
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

  it('offers exactly the controls this story adds, and no others', () => {
    // **Replaces** story 1.6c's `offers no control that could resolve anything`,
    // which asserted zero buttons, forms, inputs and links. That premise expired
    // the moment resolving became possible: it is the *expired test* the review
    // gate names, and it would have failed loudly, looked like a regression, and
    // invited a quiet weakening.
    //
    // Replaced rather than deleted, because the property worth keeping is what
    // the queue offers — and counted rather than enumerated as forbidden, since
    // story 1.6c's review showed a deny-list passes anything nobody listed.
    const { container } = render(
      <QueueList
        confirmAction={noop}
        matchAction={noop}
        view={toQueueView([item()], {
          'coastal landscaping': [
            { id: 'v1', displayName: 'Coastal Landscaping Co', score: 0.9 },
            { id: 'v2', displayName: 'Coastal Lawn Care', score: 0.4 },
          ],
        })}
      />,
    )

    // One confirm-as-new, plus one per candidate.
    expect(container.querySelectorAll('button')).toHaveLength(3)
    // One form per row: confirming and matching are submitted from the same one.
    expect(container.querySelectorAll('form')).toHaveLength(1)
    // No free text anywhere — a treasurer chooses, never types a vendor.
    expect(container.querySelectorAll('input[type="text"]')).toHaveLength(0)
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })

  it('marks no candidate as chosen', () => {
    // AC4 and H1. Preselecting the most similar is automatic near-matching with
    // one extra click, and it is the failure this whole epic exists to prevent.
    //
    // Asserted on DOM *properties*, not attributes. The first version queried
    // `[autofocus]`, `[checked]` and `[selected]`, and adding
    // `autoFocus={candidate.score > 0.5}` to the component did not fail it —
    // React sets those as properties and the attribute selectors never matched.
    // A guard that passes whether or not the thing it guards against is present,
    // in a test written to catch exactly that.
    const { container } = render(
      <QueueList
        confirmAction={noop}
        matchAction={noop}
        view={toQueueView([item()], {
          'coastal landscaping': [
            { id: 'v1', displayName: 'Coastal Landscaping Co', score: 0.9 },
            { id: 'v2', displayName: 'Coastal Lawn Care', score: 0.4 },
          ],
        })}
      />,
    )

    // Nothing grabbed focus on render.
    expect(document.activeElement).toBe(document.body)

    for (const control of container.querySelectorAll('button, input')) {
      expect((control as HTMLButtonElement & { checked?: boolean }).autofocus ?? false).toBe(false)
      expect((control as HTMLInputElement).checked ?? false).toBe(false)
      expect(control.getAttribute('aria-pressed')).toBeNull()
    }
  })

  it('offers a row with no candidates only the confirm control', () => {
    // Zero, one, many — and the control that must always be there is the one
    // that needs no candidates.
    const { container } = render(<QueueList confirmAction={noop} matchAction={noop} view={toQueueView([item()])} />)

    expect(container.querySelectorAll('button')).toHaveLength(1)
  })

  it('offers no control at all when nothing is waiting', () => {
    // H4. The empty state is a sentence, not a form.
    const { container } = render(<QueueList confirmAction={noop} matchAction={noop} view={toQueueView([])} />)

    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.querySelectorAll('form')).toHaveLength(0)
  })

  it('names each candidate so a treasurer can tell them apart', () => {
    render(
      <QueueList
        confirmAction={noop}
        matchAction={noop}
        view={toQueueView([item()], {
          'coastal landscaping': [
            { id: 'v1', displayName: 'Coastal Landscaping Co', score: 0.9 },
            { id: 'v2', displayName: 'Coastal Lawn Care', score: 0.4 },
          ],
        })}
      />,
    )

    expect(screen.getByText(/Coastal Landscaping Co/)).toBeDefined()
    expect(screen.getByText(/Coastal Lawn Care/)).toBeDefined()
  })

  it('shows markup in a name as text rather than interpreting it', () => {
    // AD-8: an extracted value is data, never an instruction. React escapes by
    // default, so this asserts the default was not defeated with
    // dangerouslySetInnerHTML — which is the only way this could go wrong, and
    // is exactly the kind of change that looks like a rendering improvement.
    const hostile = '<img src=x onerror="alert(1)">Acme'

    const { container } = render(
      <QueueList confirmAction={noop} matchAction={noop} view={toQueueView([item({ extractedName: hostile })])} />,
    )

    expect(screen.getByText(hostile)).toBeDefined()
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })

  it('renders one row per held item', () => {
    const { container } = render(
      <QueueList
        confirmAction={noop}
        matchAction={noop}
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
