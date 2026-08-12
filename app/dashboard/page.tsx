import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth, signOut as authSignOut } from '@/adapters/auth/auth'
import { QUARANTINE_ROUTE, SIGN_IN_ROUTE } from '@/core/auth/route-policy'
import { AskField } from './ask-field'

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
      {/*
        **Before the links, deliberately.** EXPERIENCE.md requires the ask field
        to be "reachable by keyboard from the top of the dashboard without
        traversing every finding", and tab order follows DOM order — so where
        this sits in the markup *is* the accessibility requirement, not a
        layout preference. UX-DR10's figure blocks and findings list land after
        it for the same reason.
      */}
      <AskField />

      {/*
        Shown whether or not anything is waiting. EXPERIENCE.md lists this
        surface as entered from the dashboard "when non-empty", and the queue's
        own empty state is what makes the unconditional link the better reading:
        a link that appears only when there is something behind it cannot be
        learned, and its absence is indistinguishable from having forgotten where
        the page was. The dashboard also has no other reason to query held vendor
        names, and adding one to decide whether to draw a link is a read nobody
        asked for.
      */}
      {/*
        `next/link`, not a bare anchor. This is the first internal link in the
        product, so it sets the precedent: an anchor triggers a full document
        load and discards the client router's state, where Link navigates
        client-side and prefetches. Raised in review — the accompanying claim
        that it fails `@next/next/no-html-link-for-pages` did not reproduce, but
        the navigation difference is real on its own.
      */}
      <Link href={QUARANTINE_ROUTE} style={styles.link}>
        Waiting on you
      </Link>
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
  link: { color: 'var(--color-ink)' },
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
