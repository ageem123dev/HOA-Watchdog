import { redirect } from 'next/navigation'

import { auth } from '@/adapters/auth/auth'
import { SIGN_IN_ROUTE } from '@/core/auth/route-policy'
import { UploadForm } from './upload-form'

export const metadata = { title: 'Upload documents — HOA Watchdog' }

/**
 * The upload surface (FR-1, UX-DR12).
 *
 * `/upload` is protected without being listed anywhere: `PUBLIC_ROUTES` is an
 * allow-list and the decision is deny-by-default, so a route nobody thought
 * about is closed rather than open. The check below is the second lock, matching
 * the dashboard — a page that writes to the association's record must not render
 * because a matcher pattern was edited carelessly.
 */
export default async function UploadPage() {
  const session = await auth()

  if (session?.user === undefined || session.user === null) redirect(SIGN_IN_ROUTE)

  return (
    <main style={styles.main}>
      <p style={styles.eyebrow}>HOA Watchdog</p>
      <h1 style={styles.heading}>Upload documents</h1>
      <p style={styles.body}>
        Statements, invoices, and ledger exports. Each file is recorded once — uploading the same
        document again will not duplicate it.
      </p>
      <UploadForm />
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
