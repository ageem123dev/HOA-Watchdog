import { redirect } from 'next/navigation'

import { auth } from '@/adapters/auth/auth'
import { createQuarantineQueue } from '@/adapters/db/quarantine-queue-postgres'
import { SIGN_IN_ROUTE } from '@/core/auth/route-policy'
import { toQueueView } from '@/core/quarantine/queue-view'
import { QueueList } from './queue-list'

export const metadata = { title: 'Waiting on you — Fiduciary Watchdog' }

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
export default async function QuarantinePage() {
  const session = await auth()

  if (session?.user === undefined || session.user === null) redirect(SIGN_IN_ROUTE)

  const view = toQueueView(await createQuarantineQueue().held())

  return (
    <main style={styles.main}>
      <p style={styles.eyebrow}>Fiduciary Watchdog</p>
      <h1 style={styles.heading}>Waiting on you</h1>
      <p style={styles.body}>
        These invoices named a vendor nobody here recognises. Their figures are stored; what is
        waiting is who the vendor is.
      </p>
      <QueueList view={view} />
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
