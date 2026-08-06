/**
 * The resolve action's guard, and the order it happens in.
 *
 * A server action is its own entry point. It is reachable without the page ever
 * rendering, so the page's session check protects nothing here — which is why
 * this asserts that the port is never touched rather than only that the call is
 * refused. `app/quarantine/page.test.tsx` makes the same argument for the read.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AlreadyResolved,
  VendorCreated,
  VendorMatched,
} from '@/core/ports/vendor-resolution'

const auth = vi.fn()
// Typed against the port's own outcomes, so a variant return needs no cast. The
// first version inferred the happy path and reached for `as never` to express
// `already-resolved` — a cast that would equally have hidden a genuinely wrong
// shape.
type ConfirmOutcome = VendorCreated | VendorMatched | AlreadyResolved
type MatchOutcome = VendorMatched | AlreadyResolved

const confirmAsNew = vi.fn<(documentId: string, name: string) => Promise<ConfirmOutcome>>(
  async () => ({ outcome: 'created', vendorId: 'v1' }),
)
const matchToExisting = vi.fn<
  (documentId: string, name: string, vendorId: string) => Promise<MatchOutcome>
>(async () => ({ outcome: 'matched', vendorId: 'v2' }))

vi.mock('@/adapters/auth/auth', () => ({ auth: () => auth() }))
vi.mock('@/adapters/db/vendor-resolution-postgres', () => ({
  createVendorResolution: () => ({ confirmAsNew, matchToExisting }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    // The real `redirect` throws to unwind the render, and nothing after it
    // runs. A mock that returned would let the action carry on.
    throw new Error(`NEXT_REDIRECT:${path}`)
  },
}))

const SIGNED_IN = { user: { email: 'treasurer@example.com' } }

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

async function actions() {
  return import('./actions')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe('confirming a held name as a new vendor', () => {
  it('resolves it for a signed-in member', async () => {
    auth.mockResolvedValue(SIGNED_IN)
    const { confirmAsNewVendor } = await actions()

    const result = await confirmAsNewVendor(form({ documentId: 'doc-1', extractedName: 'Acme' }))

    expect(confirmAsNew).toHaveBeenCalledWith('doc-1', 'Acme')
    expect(result.outcome).toBe('created')
  })

  it('writes nothing when there is no session', async () => {
    // G1 and G2. Asserting the port was never called, not merely that the result
    // was a refusal: an action that resolves and *then* checks has already
    // written, and returns the same refusal.
    auth.mockResolvedValue(null)
    const { confirmAsNewVendor } = await actions()

    const result = await confirmAsNewVendor(form({ documentId: 'doc-1', extractedName: 'Acme' }))

    expect(confirmAsNew).not.toHaveBeenCalled()
    expect(result.outcome).toBe('refused')
  })

  it('writes nothing for a session carrying no user', async () => {
    // The shape `app/upload/page.tsx` and the quarantine page both distinguish:
    // a session object with no user satisfies a truthiness check on the session.
    auth.mockResolvedValue({})
    const { confirmAsNewVendor } = await actions()

    await confirmAsNewVendor(form({ documentId: 'doc-1', extractedName: 'Acme' }))

    expect(confirmAsNew).not.toHaveBeenCalled()
  })

  it('reports an already-resolved item as an ordinary outcome', async () => {
    // G4. A treasurer who double-clicks has done nothing wrong and must not be
    // shown a failure.
    auth.mockResolvedValue(SIGNED_IN)
    confirmAsNew.mockResolvedValueOnce({ outcome: 'already-resolved' })
    const { confirmAsNewVendor } = await actions()

    const result = await confirmAsNewVendor(form({ documentId: 'doc-1', extractedName: 'Acme' }))

    expect(result.outcome).toBe('already-resolved')
  })

  it('refuses a submission missing the fields it needs', async () => {
    // Form data is strings-or-nothing. A missing field arriving as the literal
    // "undefined" would reach the adapter and delete a hold for a document id
    // that cannot exist — harmless by luck, not by design.
    auth.mockResolvedValue(SIGNED_IN)
    const { confirmAsNewVendor } = await actions()

    const result = await confirmAsNewVendor(form({ documentId: 'doc-1' }))

    expect(confirmAsNew).not.toHaveBeenCalled()
    expect(result.outcome).toBe('refused')
  })
})

describe('matching a held name to an existing vendor', () => {
  it('resolves it for a signed-in member', async () => {
    auth.mockResolvedValue(SIGNED_IN)
    const { matchToExistingVendor } = await actions()

    const result = await matchToExistingVendor(
      form({ documentId: 'doc-1', extractedName: 'Acme', vendorId: 'v2' }),
    )

    expect(matchToExisting).toHaveBeenCalledWith('doc-1', 'Acme', 'v2')
    expect(result.outcome).toBe('matched')
  })

  it('writes nothing when there is no session', async () => {
    auth.mockResolvedValue(null)
    const { matchToExistingVendor } = await actions()

    const result = await matchToExistingVendor(
      form({ documentId: 'doc-1', extractedName: 'Acme', vendorId: 'v2' }),
    )

    expect(matchToExisting).not.toHaveBeenCalled()
    expect(result.outcome).toBe('refused')
  })

  it('writes nothing for a session carrying no user', async () => {
    // The match path had less coverage than the confirm path, which review
    // caught. Two entry points to the same guard need the same cases, or the
    // untested one is where it rots.
    auth.mockResolvedValue({})
    const { matchToExistingVendor } = await actions()

    const result = await matchToExistingVendor(
      form({ documentId: 'doc-1', extractedName: 'Acme', vendorId: 'v2' }),
    )

    expect(matchToExisting).not.toHaveBeenCalled()
    expect(result.outcome).toBe('refused')
  })

  it('refuses a submission with no vendor chosen', async () => {
    // AC4 from the other side: nothing is preselected, so a treasurer can submit
    // without choosing. That is a refusal, never a guess at which candidate they
    // meant.
    auth.mockResolvedValue(SIGNED_IN)
    const { matchToExistingVendor } = await actions()

    const result = await matchToExistingVendor(form({ documentId: 'doc-1', extractedName: 'Acme' }))

    expect(matchToExisting).not.toHaveBeenCalled()
    expect(result.outcome).toBe('refused')
  })
})

describe('what the treasurer is told', () => {
  it('sends the outcome back to the queue so the page can say it', async () => {
    // AC5's wording, not just its substance. Without this the row simply
    // vanishes, which is feedback of a sort but is not being told anything —
    // and it looks identical to somebody else having resolved it.
    auth.mockResolvedValue(SIGNED_IN)
    const { confirmHeld } = await actions()

    await expect(confirmHeld(form({ documentId: 'doc-1', extractedName: 'Acme' }))).rejects.toThrow(
      'NEXT_REDIRECT:/quarantine?resolved=created',
    )
  })

  it('says so when somebody had already answered', async () => {
    auth.mockResolvedValue(SIGNED_IN)
    confirmAsNew.mockResolvedValueOnce({ outcome: 'already-resolved' })
    const { confirmHeld } = await actions()

    await expect(confirmHeld(form({ documentId: 'doc-1', extractedName: 'Acme' }))).rejects.toThrow(
      'NEXT_REDIRECT:/quarantine?resolved=already-resolved',
    )
  })

  it('says so when a match was recorded', async () => {
    auth.mockResolvedValue(SIGNED_IN)
    const { matchHeld } = await actions()

    await expect(
      matchHeld(form({ documentId: 'doc-1', extractedName: 'Acme', vendorId: 'v2' })),
    ).rejects.toThrow('NEXT_REDIRECT:/quarantine?resolved=matched')
  })

  it('says nothing happened when the submission was refused', async () => {
    // A refusal must not read as a resolution. Reporting `created` here would
    // tell a treasurer their unauthenticated submission worked.
    auth.mockResolvedValue(null)
    const { confirmHeld } = await actions()

    await expect(confirmHeld(form({ documentId: 'doc-1', extractedName: 'Acme' }))).rejects.toThrow(
      'NEXT_REDIRECT:/quarantine?resolved=refused',
    )
  })
})
