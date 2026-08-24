import { redirect } from 'next/navigation'

import { auth } from '@/adapters/auth/auth'
import { SIGN_IN_ROUTE } from '@/core/auth/route-policy'
import { DirectorForm } from './director-form'

export const metadata = { title: 'Add a director — Fiduciary Watchdog' }

/**
 * Provisioning a director (story 5.9).
 *
 * Until this page existed, an account came into being only by somebody running
 * `scripts/add-board-member.mjs` with the writer credential. That script remains
 * for the one case this page cannot serve — the *first* director of an
 * association, where nobody is signed in to derive an association from.
 *
 * The session check below is the second lock, as on `/upload`. It matters more
 * here: this page creates credentials, so a visitor who reached it without a
 * session could add an account and then sign in as it.
 */
export default async function DirectorsPage() {
  const session = await auth()

  if (session?.user === undefined || session.user === null) redirect(SIGN_IN_ROUTE)

  return (
    <main style={styles.main}>
      <p style={styles.eyebrow}>Fiduciary Watchdog</p>
      <h1 style={styles.heading}>Add a director</h1>
      <p style={styles.body}>
        The new director joins your association and can sign in straight away. Their password is
        shown once, here, and is not stored anywhere — pass it on before you leave this page.
      </p>
      <DirectorForm />
    </main>
  )
}

const styles = {
  main: {
    minHeight: '100dvh',
    padding: 'var(--space-section)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-tight)',
    maxWidth: '38rem',
  },
  eyebrow: { margin: 0, opacity: 0.7, letterSpacing: '0.08em', textTransform: 'uppercase' },
  heading: { margin: 0, fontSize: '1.6rem' },
  body: { margin: '0 0 var(--space-tight)' },
} as const satisfies Record<string, React.CSSProperties>
