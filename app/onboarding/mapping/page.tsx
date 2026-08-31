import { redirect } from 'next/navigation'

import { auth } from '@/adapters/auth/auth'
import { SIGN_IN_ROUTE } from '@/core/auth/route-policy'
import { MappingWizard } from './mapping-wizard'

export const metadata = { title: 'Match your columns — HOA Watchdog' }

/**
 * The mapping step of onboarding (FR-9, UX-DR19–21).
 *
 * Protected without being listed anywhere: `PUBLIC_ROUTES` is an allow-list and
 * the decision is deny-by-default, so a route nobody thought about is closed
 * rather than open. The check below is the second lock, matching `/upload` — a
 * page that reads a treasurer's own export must not render because a matcher
 * pattern was edited carelessly.
 */
export default async function MappingPage() {
  const session = await auth()

  if (session?.user === undefined || session.user === null) redirect(SIGN_IN_ROUTE)

  return (
    <main style={styles.main}>
      <p style={styles.eyebrow}>HOA Watchdog</p>
      <h1 style={styles.heading}>Match your columns</h1>
      <p style={styles.body}>
        Show us one export of each kind you upload, and tell us which of your columns is which. We
        read the heading row and nothing else — the file itself is not kept.
      </p>
      <MappingWizard />
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
