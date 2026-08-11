// @vitest-environment jsdom

/**
 * The Oracle page's guard, and what it does with a failure it does not know.
 *
 * The page itself is thin — it authenticates, asks, and hands three layers to
 * `AnswerView`. What is worth pinning is the two places it decides something on
 * a board member's behalf: **who may ask**, and **what they are told when the
 * turn fails**.
 *
 * The pattern here is `app/quarantine/page.test.tsx`'s, including the detail
 * that makes it work: the `redirect` mock *throws*. The real one unwinds the
 * render and code after it never runs, so a mock that returned would let the
 * page carry on and ask the question anyway — and this suite would pass against
 * a page that leaks.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SIGN_IN_ROUTE } from '@/core/auth/route-policy'

const auth = vi.fn()
const askOracle = vi.fn()
const entryFor = vi.fn()
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`)
})

vi.mock('@/adapters/auth/auth', () => ({ auth: () => auth() }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => redirect(path) }))
vi.mock('./ask', () => ({ askOracle: (input: unknown) => askOracle(input) }))
vi.mock('@/catalog/registry', () => ({
  entryFor: (id: string, version: number) => entryFor(id, version),
}))

const TURN = {
  question: 'What does 4B owe for 2026?',
  answer: 'Unit 4B owes $240.00 for 2026.',
  rows: [{ unitNumber: '4B', balanceOutstanding: '240.00' }],
  entryId: 'dues_status',
  version: 1,
  provenanceId: 'prov-1',
}

beforeEach(() => {
  vi.resetAllMocks()
  entryFor.mockReturnValue({ sql: 'select 1' })
})

afterEach(cleanup)

async function renderPage(q?: string) {
  const { default: OraclePage } = await import('./page')
  return OraclePage({ searchParams: Promise.resolve({ q }) })
}

describe('who may ask', () => {
  it('redirects a visitor with no session', async () => {
    auth.mockResolvedValue(null)

    await expect(renderPage('anything')).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN_ROUTE}`)
    expect(askOracle).not.toHaveBeenCalled()
  })

  it('redirects a session whose user carries no id', async () => {
    // The finding this test exists for. `askOracle` refuses a blank actorId,
    // that refusal is caught below, and the board member is told "the records
    // could not be reached" — a lie about which thing is broken. AD-12 logs who
    // asked, and there is nobody here to log. Raised by CodeRabbit.
    auth.mockResolvedValue({ user: { email: 'treasurer@example.com' } })

    await expect(renderPage('What does 4B owe?')).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN_ROUTE}`)
    expect(askOracle).not.toHaveBeenCalled()
  })

  it('lets a session with an id through, and passes that id as the actor', async () => {
    // The positive control, in the same breath as the two refusals above. A
    // page that redirected unconditionally would satisfy both of them, and
    // story 3.5 has already been bitten once by an absence that could not tell
    // "correctly excluded" from "never seen".
    auth.mockResolvedValue({ user: { id: 'user-7' } })
    askOracle.mockResolvedValue(TURN)

    render(await renderPage('What does 4B owe for 2026?'))

    expect(askOracle).toHaveBeenCalledWith({
      question: 'What does 4B owe for 2026?',
      actorId: 'user-7',
    })
    expect(screen.getByText(/Unit 4B owes \$240\.00/)).toBeTruthy()
  })
})

describe('what a failure leaves behind', () => {
  beforeEach(() => {
    auth.mockResolvedValue({ user: { id: 'user-7' } })
  })

  it('logs an unrecognised failure before flattening it to one sentence', async () => {
    // Otherwise the only record of a fault is a generic sentence on a board
    // member's screen, and nothing on the server to diagnose it from. Raised by
    // CodeRabbit.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = new TypeError('socket hang up')
    askOracle.mockRejectedValue(boom)

    render(await renderPage('What does 4B owe?'))

    expect(logged).toHaveBeenCalledWith('oracle turn failed', boom)
    expect(screen.getByText(/records could not be reached/i)).toBeTruthy()
    logged.mockRestore()
  })

  it('does not log the two failures that are expected and self-describing', async () => {
    // A no-catalog-match is the most likely daily failure per the UX spec.
    // Logging it as a fault would bury the real ones in noise.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { NoCatalogMatchError } = await import('@/adapters/agent/chat-client')
    askOracle.mockRejectedValue(new NoCatalogMatchError('no entry'))

    render(await renderPage('What is the weather?'))

    expect(logged).not.toHaveBeenCalled()
    expect(screen.getByText(/can't answer that one/i)).toBeTruthy()
    logged.mockRestore()
  })

  it('keeps the question on screen through a failure, per UX-DR11', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    askOracle.mockRejectedValue(new Error('down'))

    render(await renderPage('What does 4B owe for 2026?'))

    expect(screen.getByText('What does 4B owe for 2026?')).toBeTruthy()
    logged.mockRestore()
  })
})
