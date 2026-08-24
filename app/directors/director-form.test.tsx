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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { neutralise } from '@/core/ports/declared-members'

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

  it('keeps the error region mounted before there is an error to announce', () => {
    /**
     * A live region created *with* its content is not announced: assistive
     * technology has to be watching the node before the text arrives. So the
     * region renders empty rather than conditionally, and this asserts the
     * empty case - which is the only one that can tell the two implementations
     * apart. Without it, mutating the component back to
     * `{state.status === 'error' && <p>...}` passes every other assertion here.
     *
     * Raised by CodeRabbit; the mutation is what showed the first version of
     * this test could not see the difference.
     */
    render(<DirectorForm />)

    const region = document.getElementById('director-error')

    expect(region).not.toBeNull()
    expect(region?.getAttribute('aria-live')).toBe('assertive')
    expect(region?.textContent).toBe('')
  })

  it('points the address field at the error region, so the two are connected', () => {
    render(<DirectorForm />)

    const field = document.querySelector('input[name="email"]') as HTMLInputElement

    expect(field.getAttribute('aria-describedby')).toContain('director-error')
  })

  it('shows no password before anything has been submitted', () => {
    // The control for everything below: if the idle render already contained
    // something password-shaped, the assertions about the added state would be
    // measuring the wrong thing.
    render(<DirectorForm />)

    expect(screen.queryByTestId('one-time-password')).toBeNull()
  })
})

describe('nothing keeps the password anywhere (AC3)', () => {
  /**
   * "Shown exactly once and never recoverable" was true by accident of
   * implementation and asserted by nothing until the AC audit looked for it.
   *
   * `useActionState` holds the value in memory, so a refresh loses it — which is
   * the intended behaviour. But nothing stopped a later edit from "helpfully"
   * stashing it in `sessionStorage` so a refresh would not lose the treasurer's
   * work, and that would put a credential somewhere it outlives the page, the
   * session and the browser being closed.
   *
   * Structural, because behaviour cannot express this: a render test can only
   * show what *did* happen on one render, never that nothing anywhere persists.
   */
  // `process.cwd()` rather than `import.meta.url`: under jsdom that is not a
  // file URL, and `fileURLToPath` throws. `alert-wiring.test.ts` reads sources
  // the same way.
  const source = neutralise(
    readFileSync(join(process.cwd(), 'app/directors/director-form.tsx'), 'utf8'),
  ).commentsBlanked

  it('writes the password to no browser storage', () => {
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/)
  })

  it('sends it nowhere either', () => {
    // A `fetch` carrying it would be the same failure by a different route.
    expect(source).not.toMatch(/\bfetch\s*\(|navigator\.clipboard/)
  })

  it('is not passing because the file was read as empty', () => {
    // All three assertions above are absences.
    expect(source).toContain('export function DirectorForm')
    expect(source).toContain('state.password')
  })

  it('offers no association field, because the association is not the form s to choose', () => {
    // AC2's other half. Nothing reads such a field today, so one added later
    // would be inert -- and inert-but-present is how a picker gets wired up by
    // somebody who assumes it was meant to work.
    render(<DirectorForm />)

    expect(document.querySelector('[name="association"]')).toBeNull()
    expect(document.querySelector('[name="associationId"]')).toBeNull()
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
