// @vitest-environment jsdom

/**
 * The provisioning surface (story 5.9).
 *
 * ## What these tests are actually protecting
 *
 * The password is shown once and exists nowhere else — not in the database,
 * which holds only its scrypt hash, and not in any log. So the render is the
 * *only* place it can be read, and two of the failure modes below are about it
 * being unreadable or shown at the wrong moment rather than about it being
 * wrong.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DirectorState } from './director-state'

const state = vi.fn<() => DirectorState>(() => ({ status: 'idle' }))

vi.mock('./actions', () => ({ addDirector: vi.fn(async () => ({ status: 'idle' })) }))
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useActionState: () => [state(), vi.fn(), false],
  }
})

const { DirectorForm } = await import('./director-form')

// Explicit, as `mapping-wizard.test.tsx` does. Auto-cleanup needs the global
// afterEach that `globals: true` registers, and this project does not set it —
// so without this the previous test's DOM survives and a later assertion reads
// a password rendered by an earlier one.
afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  state.mockReturnValue({ status: 'idle' })
})

describe('the form a director fills in', () => {
  it('asks for the address the new director will sign in with', () => {
    render(<DirectorForm />)

    const field = document.querySelector('input[name="email"]') as HTMLInputElement

    expect(field).not.toBeNull()
    // Labelled, because a field nobody can name is not usable.
    expect(document.querySelector(`label[for="${field.id}"]`)).not.toBeNull()
  })

  it('offers a display name, and does not require one', () => {
    render(<DirectorForm />)

    const field = document.querySelector('input[name="displayName"]') as HTMLInputElement

    expect(field).not.toBeNull()
    expect(field.required).toBe(false)
  })

  it('shows no password before anything has been submitted', () => {
    // The control for everything below: if the idle render already contained
    // something password-shaped, the assertions about the added state would be
    // measuring the wrong thing.
    render(<DirectorForm />)

    expect(screen.queryByTestId('one-time-password')).toBeNull()
  })
})

describe('the password, shown once', () => {
  const ADDED: DirectorState = {
    status: 'added',
    email: 'new@example.com',
    password: 'aaaa-bbbb-cccc-dddd',
  }

  it('shows the password as readable text, not hidden in an attribute', () => {
    /**
     * 3b. A value shown once that the director cannot select and copy is a value
     * lost — the account exists and nobody can sign in to it. So it has to be in
     * the document's text, which is what a screen reader and a mouse both reach.
     */
    state.mockReturnValue(ADDED)

    render(<DirectorForm />)

    expect(screen.getByTestId('one-time-password').textContent).toBe('aaaa-bbbb-cccc-dddd')
  })

  it('names the address it belongs to', () => {
    // 3e. Handing the right password to the right person for the wrong account
    // is a failure that looks like success from both sides.
    state.mockReturnValue(ADDED)

    render(<DirectorForm />)

    expect(screen.getByText(/new@example\.com/)).toBeTruthy()
  })

  it('says it cannot be shown again', () => {
    /**
     * The whole hand-off depends on the director copying it now. If the page
     * does not say so, the reasonable assumption is that it can be looked up
     * later — and there is nothing to look up, because only the hash is stored.
     */
    state.mockReturnValue(ADDED)

    render(<DirectorForm />)

    expect(document.body.textContent).toMatch(/again|once|not be shown|recover/i)
  })

  it('shows no password when the submission failed', () => {
    // 3d. Reading a password out of a failed submission would mean handing
    // somebody a credential for an account that does not exist.
    state.mockReturnValue({ status: 'error', error: 'That address is already on a board.' })

    render(<DirectorForm />)

    expect(screen.queryByTestId('one-time-password')).toBeNull()
    expect(screen.getByText(/already on a board/)).toBeTruthy()
  })
})
