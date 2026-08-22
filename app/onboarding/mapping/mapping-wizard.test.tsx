// @vitest-environment jsdom

/**
 * The step that reaches the action (story 5.4, Task 3's other half).
 *
 * **This file exists because of story 5.2.** There, `actions.ts` was changed to
 * require `documentKind` and the form was not changed to send it: everything
 * compiled, `tsc` was at baseline and 3300 tests passed, because nothing
 * rendered the form and looked at what it submits. Story 5.3 then deliberately
 * withheld this action until the screen that calls it existed, which is here.
 *
 * So the assertions are about the *wire*: the control names, because a name is
 * what reaches `formData.get(...)`, and a renamed one leaves every submission
 * refused while the page still looks right.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DOCUMENT_KINDS } from '@/core/extraction/record'
import { TABULAR_CONTENT_TYPES } from '@/core/extraction/rectangle'

vi.mock('./actions', () => ({
  readSample: vi.fn(async () => ({ status: 'idle' as const })),
}))

const { MappingWizard } = await import('./mapping-wizard')

afterEach(cleanup)

describe('the fields the action reads', () => {
  it('submits a control named documentKind', () => {
    render(<MappingWizard />)

    expect(document.querySelector('select[name="documentKind"]')).not.toBeNull()
  })

  it('submits a file control named sample', () => {
    render(<MappingWizard />)

    const control = document.querySelector('input[name="sample"]')

    expect(control).not.toBeNull()
    expect(control?.getAttribute('type')).toBe('file')
  })

  it('offers every kind the domain publishes, and no others', () => {
    render(<MappingWizard />)

    const values = [...document.querySelectorAll('select[name="documentKind"] option')]
      .map((option) => (option as HTMLOptionElement).value)
      .filter((value) => value !== '')

    expect([...values].sort()).toEqual([...DOCUMENT_KINDS].sort())
  })

  it('pre-selects no kind', () => {
    render(<MappingWizard />)

    const control = document.querySelector('select[name="documentKind"]') as HTMLSelectElement

    // A default would put the decision back where story 5.2 took it from —
    // decided by omission rather than by the treasurer.
    expect(control.value).toBe('')
  })

  it('accepts the formats the reader can actually read, and says so', () => {
    render(<MappingWizard />)

    const accept = document.querySelector('input[name="sample"]')?.getAttribute('accept') ?? ''

    // Derived from the reader's own list, so a format added there is one the
    // picker offers. Non-empty asserted first.
    expect(TABULAR_CONTENT_TYPES.length).toBeGreaterThan(0)
    for (const type of TABULAR_CONTENT_TYPES) expect(accept).toContain(type)
  })
})

describe('what the treasurer is told', () => {
  it('shows the refusal the action returned', () => {
    render(<MappingWizard initialState={{ status: 'error', error: 'That file is empty.' }} />)

    expect(screen.getByRole('alert').textContent).toContain('That file is empty.')
  })

  it('renders the pairing surface once a sample has been read', () => {
    render(
      <MappingWizard
        initialState={{
          status: 'read',
          kind: 'deposit',
          headings: [
            { position: 1, text: 'Date', normalised: 'date' },
            { position: 2, text: 'Amount', normalised: 'amount' },
          ],
          problems: [],
        }}
      />,
    )

    // The whole reason 5.3 held the action back: an action with nothing
    // rendering it is the shape that shipped broken in 5.2.
    expect(screen.getByRole('button', { name: /^Column 1/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Amount — required/ })).toBeTruthy()
  })

  it('renders no pairing surface before a sample has been read', () => {
    render(<MappingWizard />)

    expect(screen.queryByRole('button', { name: /^Column / })).toBeNull()
  })
})
