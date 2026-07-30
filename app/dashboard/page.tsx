import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/adapters/auth/supabase-server'
import { SIGN_IN_ROUTE } from '@/core/auth/route-policy'

export const metadata = { title: 'Dashboard — Fiduciary Watchdog' }

async function signOut() {
  'use server'

  // `required`: a swallowed failure here leaves a member believing they signed
  // out on a shared computer while the session cookie is still live.
  const supabase = await createSupabaseServerClient({ cookieWrites: 'required' })
  await supabase.auth.signOut()
  redirect(SIGN_IN_ROUTE)
}

/**
 * A placeholder that proves one thing and claims nothing else: the signed-in
 * member's identity is available server-side on an ordinary request. The real
 * dashboard — figure blocks, the ask field, the findings list — is Story 1.3
 * onward, and inventing it here would be building against an unbuilt token layer.
 */
export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // The middleware already redirects unauthenticated visitors. This is the
  // second lock: a page that reads member data must never render because a
  // matcher pattern was edited carelessly.
  if (user === null) redirect(SIGN_IN_ROUTE)

  return (
    <main style={styles.main}>
      <p style={styles.eyebrow}>Fiduciary Watchdog</p>
      <h1 style={styles.heading}>Dashboard</h1>
      <p style={styles.body}>
        Signed in as <strong>{user.email}</strong>.
      </p>
      <form action={signOut}>
        <button type="submit" style={styles.submit}>
          Sign out
        </button>
      </form>
    </main>
  )
}

const INK = '#14213D'
const INK_MUTED = '#5A6478'
const STONE = '#E5E5E0'
const RULE_STRONG = '#9E9E96'
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

const styles = {
  main: {
    minHeight: '100dvh',
    background: STONE,
    color: INK,
    fontFamily: SANS,
    fontSize: '0.9375rem',
    lineHeight: 1.5,
    padding: '40px',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    alignItems: 'flex-start',
  },
  eyebrow: {
    fontSize: '0.6875rem',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: INK_MUTED,
    margin: 0,
  },
  heading: {
    fontFamily: 'ui-serif, Georgia, "Iowan Old Style", "Times New Roman", serif',
    fontSize: '1.55rem',
    fontWeight: 600,
    margin: 0,
  },
  body: { margin: 0 },
  submit: {
    font: 'inherit',
    color: INK,
    background: 'transparent',
    border: `1px solid ${RULE_STRONG}`,
    borderRadius: 0,
    padding: '12px',
    minHeight: '44px',
    cursor: 'pointer',
  },
} as const
