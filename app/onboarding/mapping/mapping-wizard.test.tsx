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

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DOCUMENT_KINDS } from '@/core/extraction/record'
import { TABULAR_CONTENT_TYPES } from '@/core/extraction/rectangle'

// Typed to the action's real signature so the recorded call can be read back as
// a `FormData` without a cast at the assertion.
const readSample = vi.fn<(previous: unknown, formData: FormData) => Promise<{ status: 'idle' }>>(
  async () => ({ status: 'idle' }),
)

vi.mock('./actions', () => ({ readSample: (p: unknown, f: FormData) => readSample(p, f) }))

const { MappingWizard } = await import('./mapping-wizard')

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

describe('the fields the action reads', () => {
  it('gives every control an accessible name', () => {
    render(<MappingWizard />)

    // The `name` assertions below are about the wire; this is about whether a
    // screen-reader user can tell what either control is for. A control with a
    // correct `name` and no label submits fine and is unusable.
    expect(screen.getByLabelText(/which import/i)).toBeTruthy()
    expect(screen.getByLabelText(/sample export/i)).toBeTruthy()
  })

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

  it('offers the file extensions too, not media types alone', () => {
    render(<MappingWizard />)

    const accept = document.querySelector('input[name="sample"]')?.getAttribute('accept') ?? ''

    // A picker matches `accept` against both, inconsistently: Windows commonly
    // reports a .csv as application/vnd.ms-excel. On media types alone a
    // treasurer can find their own export greyed out. Raised by CodeRabbit.
    for (const extension of ['.csv', '.xls', '.xlsx']) expect(accept).toContain(extension)
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

describe('the form reaches the action', () => {
  it('submits the declared kind and the chosen file to readSample', async () => {
    /**
     * The control *names* are asserted above; this asserts the wiring. Story 5.2
     * shipped an action requiring a field the form never sent, with every gate
     * green — names alone would not have caught it if the form were never
     * submitted at all. Raised by CodeRabbit.
     */
    const { container } = render(<MappingWizard />)

    const kind = container.querySelector('select[name="documentKind"]') as HTMLSelectElement
    fireEvent.change(kind, { target: { value: 'deposit' } })

    // Contents are irrelevant here — the action is mocked, and what is under
    // test is what the form hands it.
    const file = new File(['Date,Amount'], 'sample.csv', { type: 'text/csv' })
    const input = container.querySelector('input[name="sample"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file] })
    fireEvent.change(input)

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    })

    await waitFor(() => expect(readSample).toHaveBeenCalled())

    const sent = readSample.mock.calls[0]?.[1] as FormData

    // The value the treasurer chose, arriving under the key the action reads.
    expect(sent.get('documentKind')).toBe('deposit')

    // The file *field* is carried, under the name the action reads. Its
    // contents are not asserted: jsdom builds `FormData` from the real `files`
    // property, which cannot be populated without a `DataTransfer` it does not
    // implement — so a test claiming the bytes arrived would be claiming
    // something this environment cannot show. `actions.test.ts` owns that half,
    // by handing the action a `FormData` directly.
    expect(sent.has('sample')).toBe(true)
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
