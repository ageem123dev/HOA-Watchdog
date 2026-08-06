import { redirect } from 'next/navigation'

import { auth } from '@/adapters/auth/auth'
import { createQuarantineQueue } from '@/adapters/db/quarantine-queue-postgres'
import { createVendorDirectory } from '@/adapters/db/vendor-directory-postgres'
import { SIGN_IN_ROUTE } from '@/core/auth/route-policy'
import type { SuggestionsByName } from '@/core/quarantine/queue-view'
import { toQueueView } from '@/core/quarantine/queue-view'
import { resolutionMessage } from '@/core/quarantine/resolution-message'
import { distinctNamesForSuggestions, suggestionKey } from '@/core/quarantine/suggestions'
import { confirmHeld, matchHeld } from './actions'
import { QueueList } from './queue-list'

export const metadata = { title: 'Waiting on you — Fiduciary Watchdog' }

/**
 * How many candidates a row offers.
 *
 * Small on purpose. A long list of near-matches is a list somebody scrolls past,
 * and the point of ranking is that the plausible ones are visible without
 * hunting -- if none of the top few is right, confirming a new vendor is the
 * honest answer.
 */
const SUGGESTIONS_PER_NAME = 5

/**
 * The quarantine queue (epic story 1.6, AC2 and AC5).
 *
 * `/quarantine` is protected without being listed anywhere: `PUBLIC_ROUTES` is
 * an allow-list and the decision is deny-by-default, so a route nobody thought
 * about is closed rather than open. The check below is the second lock, matching
 * the dashboard and the upload page.
 *
 * The guard runs *before* the queue is read, not after. Redirecting afterwards
 * would still have put a query for the association's vendor names on the wire,
 * and nothing visible from a browser would say so.
 */
export default async function QuarantinePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
} = {}) {
  const session = await auth()

  if (session?.user === undefined || session.user === null) redirect(SIGN_IN_ROUTE)

  // What the last resolution did, carried back by the action's redirect. A
  // repeated parameter arrives as an array, which is not an outcome — `?:`
  // narrows it away rather than rendering the first of several.
  const params = await searchParams
  const reported = params?.resolved
  const message = resolutionMessage(typeof reported === 'string' ? reported : undefined)

  const held = await createQuarantineQueue().held()

  // One lookup per distinct vendor, not per row: two documents held for the same
  // name are one question asked twice. `suggest` ranks for a human and decides
  // nothing, so the limit is a decision made here rather than a value threaded
  // in from a request -- it also throws on a limit that is not a non-negative
  // integer.
  const directory = createVendorDirectory()
  const entries = await Promise.all(
    distinctNamesForSuggestions(held).map(
      async (name) =>
        [suggestionKey(name), await directory.suggest(name, SUGGESTIONS_PER_NAME)] as const,
    ),
  )
  const suggestions: SuggestionsByName = Object.fromEntries(entries)

  const view = toQueueView(held, suggestions)

  return (
    <main style={styles.main}>
      <p style={styles.eyebrow}>Fiduciary Watchdog</p>
      <h1 style={styles.heading}>Waiting on you</h1>
      <p style={styles.body}>
        These invoices named a vendor nobody here recognises. Their figures are stored; what is
        waiting is who the vendor is.
      </p>
      {message !== null && (
        <p role="status" style={styles.body}>
          {message}
        </p>
      )}
      <QueueList view={view} confirmAction={confirmHeld} matchAction={matchHeld} />
    </main>
  )
}

const styles = {
  main: {
    minHeight: '100dvh',
    padding: 'var(--space-section)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-block)',
    alignItems: 'flex-start',
    maxWidth: '70ch',
  },
  eyebrow: {
    fontSize: 'var(--type-scale-label)',
    letterSpacing: 'var(--type-tracking-label)',
    textTransform: 'uppercase',
    color: 'var(--color-ink-muted)',
    margin: 0,
  },
  heading: {
    fontFamily: 'var(--type-serif)',
    fontSize: 'var(--type-scale-figure)',
    fontWeight: 600,
    margin: 0,
  },
  body: { margin: 0 },
} satisfies Record<string, React.CSSProperties>
