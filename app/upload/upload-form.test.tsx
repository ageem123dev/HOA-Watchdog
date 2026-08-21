// @vitest-environment jsdom

/**
 * The upload form declares what the documents are (story 5.2, AC4).
 *
 * ## Why this file exists at all
 *
 * `actions.ts` was changed to require `documentKind` and to refuse a submission
 * without one — and the form was not changed to send it. Everything compiled,
 * `tsc` was at baseline, and 3300 tests passed, because **no test rendered the
 * form and looked at what it submits**. The feature was shipped broken and
 * found by reading the form, not by running anything.
 *
 * So the assertions here are deliberately about the *wire*: the control's
 * `name`, the values it offers, and the absence of a pre-selected one. A test
 * that only checked "a select is rendered" would have passed against a control
 * named anything at all.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DOCUMENT_KINDS } from '@/core/extraction/record'

// The server action is mocked at the module boundary, not stubbed inside the
// component. `actions.ts` is a `'use server'` module that reaches next-auth
// and a database on import, none of which a render test can or should load —
// and the thing under test here is what the *form* submits, not what the action
// does with it. `actions.test.ts` owns the other half.
vi.mock('./actions', () => ({ uploadDocuments: vi.fn(async () => ({ outcomes: [], error: null })) }))

const { UploadForm } = await import('./upload-form')

describe('declaring what the documents are', () => {
  it('submits the field the server action reads', () => {
    render(<UploadForm />)

    // `name`, not `id`: the name is what reaches `formData.get('documentKind')`,
    // and a renamed control would leave every upload refused while the page
    // still looked right.
    const control = document.querySelector('select[name="documentKind"]')

    expect(control).not.toBeNull()
  })

  it('offers every kind the domain publishes, and no others', () => {
    render(<UploadForm />)

    const values = [...document.querySelectorAll('select[name="documentKind"] option')]
      .map((option) => (option as HTMLOptionElement).value)
      .filter((value) => value !== '')

    // Compared as sets against `DOCUMENT_KINDS` rather than a list written
    // here: a kind added to the domain and missed by the form would be a kind
    // nobody can upload, and a second hand-written list is how that happens
    // quietly.
    expect(new Set(values)).toEqual(new Set(DOCUMENT_KINDS))
  })

  it('pre-selects nothing, so the kind is chosen rather than defaulted', () => {
    render(<UploadForm />)

    const control = document.querySelector('select[name="documentKind"]') as HTMLSelectElement

    // The whole argument of this story in one assertion. A pre-selected kind
    // would put the decision back where it was — made by omission — and a roll
    // uploaded as a bank statement fails silently: the units simply never
    // appear.
    expect(control.value).toBe('')
  })

  it('still offers the file input, so the kind was added rather than substituted', () => {
    render(<UploadForm />)

    expect(document.querySelector('input[name="documents"]')).not.toBeNull()
  })

  it('labels the control, because a select nobody can name is not usable', () => {
    render(<UploadForm />)

    expect(screen.getByLabelText(/what are these documents/i)).toBeTruthy()
  })
})
