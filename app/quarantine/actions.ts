'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { auth } from '@/adapters/auth/auth'
import { createVendorResolution } from '@/adapters/db/vendor-resolution-postgres'
import { QUARANTINE_ROUTE } from '@/core/auth/route-policy'

/**
 * Recording a treasurer's answer — the composition root for resolution, as
 * `app/upload/actions.ts` is for ingestion.
 *
 * The session is checked here and not merely on the page. A server action is its
 * own entry point, reachable without the page ever rendering, so a page-only
 * guard protects the view and nothing else. This is the surface that writes.
 */

/** `refused` is this layer's own outcome: the port never saw the request. */
export type ResolveResult =
  | { readonly outcome: 'created'; readonly vendorId: string }
  | { readonly outcome: 'matched'; readonly vendorId: string }
  | { readonly outcome: 'already-resolved' }
  | { readonly outcome: 'refused' }

async function signedIn(): Promise<boolean> {
  const session = await auth()

  // Both shapes, as the pages distinguish them: a session object carrying no
  // user satisfies a truthiness check on the session alone.
  return session?.user !== undefined && session.user !== null
}

/**
 * Form values are strings or nothing, and `String(null)` is `"null"`.
 *
 * Coercing instead would send a plausible-looking string to the adapter, which
 * would then delete a hold for a document id that cannot exist — harmless by
 * luck rather than by design, and it would report success.
 */
function required(formData: FormData, field: string): string | null {
  const value = formData.get(field)

  return typeof value === 'string' && value.length > 0 ? value : null
}

export async function confirmAsNewVendor(formData: FormData): Promise<ResolveResult> {
  if (!(await signedIn())) return { outcome: 'refused' }

  const documentId = required(formData, 'documentId')
  const extractedName = required(formData, 'extractedName')
  if (documentId === null || extractedName === null) return { outcome: 'refused' }

  return createVendorResolution().confirmAsNew(documentId, extractedName)
}

export async function matchToExistingVendor(formData: FormData): Promise<ResolveResult> {
  if (!(await signedIn())) return { outcome: 'refused' }

  const documentId = required(formData, 'documentId')
  const extractedName = required(formData, 'extractedName')
  // Nothing is preselected on the page, so submitting without choosing is
  // ordinary. It is a refusal rather than a guess at which candidate was meant —
  // guessing here is the automatic near-matching this epic exists to prevent,
  // wearing a form's clothes.
  const vendorId = required(formData, 'vendorId')
  if (documentId === null || extractedName === null || vendorId === null) {
    return { outcome: 'refused' }
  }

  return createVendorResolution().matchToExisting(documentId, extractedName, vendorId)
}

/**
 * `void`-returning wrappers, for React's `formAction`, which carry the outcome
 * back to the queue as a query parameter.
 *
 * They live here rather than in the page because this file declares
 * `'use server'` at file scope; an inline directive inside a module-scope
 * function in a component file is a shape Next.js does not promise to support.
 *
 * The redirect is what makes AC5's *wording* true rather than only its
 * substance. Without it a resolved row simply vanishes — which is feedback of a
 * sort, and is indistinguishable from somebody else having answered first. The
 * treasurer is told which of those happened.
 */
async function resolveAndReport(run: () => Promise<ResolveResult>): Promise<never> {
  // The catch wraps the port call and nothing else. `redirect` signals control
  // flow by throwing, so wrapping it too would turn every successful resolution
  // into a reported failure.
  //
  // The adapter throws for a vendor that no longer exists, which an ordinary
  // queue page reaches whenever one is deleted between render and submit. Left
  // to escape, it replaces AC5's sentence with a framework error page — the
  // outcome the redirect exists to prevent. Raised in review.
  let result: ResolveResult

  try {
    result = await run()
  } catch (error) {
    // Logged before it is discarded. A deleted vendor, an exhausted pool, a
    // statement timeout and a broken migration all reach the treasurer as the
    // same sentence, and this is the only write path in the flow — so it is the
    // one that most needs a trace of which actually happened. Raised in review.
    console.error('quarantine resolution failed', error)
    result = { outcome: 'refused' }
  }

  revalidatePath(QUARANTINE_ROUTE)

  redirect(`${QUARANTINE_ROUTE}?resolved=${result.outcome}`)
}

export async function confirmHeld(formData: FormData): Promise<void> {
  await resolveAndReport(() => confirmAsNewVendor(formData))
}

export async function matchHeld(formData: FormData): Promise<void> {
  await resolveAndReport(() => matchToExistingVendor(formData))
}
