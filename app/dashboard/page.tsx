import { redirect } from 'next/navigation'
import { auth, signOut as authSignOut } from '@/adapters/auth/auth'
import { SIGN_IN_ROUTE } from '@/core/auth/route-policy'

export const metadata = { title: 'Dashboard — Fiduciary Watchdog' }

async function signOut() {
  'use server'

  // Auth.js clears its own session cookie and performs the navigation. A failure
  // here propagates rather than being swallowed: a member who is told they signed
  // out on a shared computer must actually have done so.
  await authSignOut({ redirectTo: SIGN_IN_ROUTE })
}

/**
 * A placeholder that proves one thing and claims nothing else: the signed-in
 * member's identity is available server-side on an ordinary request. The real
 * dashboard — figure blocks, the ask field, the findings list — is Epic 3 and
 * later stories.
 */
export default async function DashboardPage() {
  const session = await auth()
  const user = session?.user ?? null

  // The proxy already redirects unauthenticated visitors. This is the second
  // lock: a page that reads member data must never render because a matcher
  // pattern was edited carelessly.
  if (user === null) redirect(SIGN_IN_ROUTE)

  return (
    <main style={styles.main}>
      <p style={styles.eyebrow}>Fiduciary Watchdog</p>
      <h1 style={styles.heading}>Dashboard</h1>
      <p style={styles.body}>
        Signed in as <strong>{user.email}</strong>.
      </p>
      <form action={signOut}>
        <button type="submit" style={styles.control}>
          Sign out
        </button>
      </form>
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
  // Records action, not a call to action — never a filled button.
  control: {
    font: 'inherit',
    color: 'var(--color-ink)',
    background: 'transparent',
    border: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
    borderRadius: 'var(--radius-none)',
    padding: 'var(--space-row)',
    minHeight: '44px',
    cursor: 'pointer',
  },
} as const
