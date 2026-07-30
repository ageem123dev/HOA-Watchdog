import type { CSSProperties } from 'react'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/adapters/auth/supabase-server'
import { MissingSupabaseConfigError } from '@/adapters/auth/env'
import { DEFAULT_SIGNED_IN_ROUTE, SIGN_IN_ROUTE, safeRedirectTarget } from '@/core/auth/route-policy'

export const metadata = { title: 'Sign in — Fiduciary Watchdog' }

/**
 * Failure reasons the surface can report. The credentials case is deliberately
 * one reason rather than two: telling a visitor that an address exists but the
 * password was wrong confirms who is on the board, and the board roster is not
 * something an unauthenticated visitor gets to enumerate.
 */
const MESSAGES = {
  credentials: "That email and password don't match an account.",
  unconfigured: 'This installation is not connected to its account service yet.',
  missing: 'Enter your email address and password.',
} as const

type Reason = keyof typeof MESSAGES

function messageFor(raw: string | undefined): string | null {
  if (raw === undefined) return null
  return raw in MESSAGES ? MESSAGES[raw as Reason] : MESSAGES.credentials
}

async function signIn(formData: FormData) {
  'use server'

  const next = safeRedirectTarget(String(formData.get('next') ?? ''), DEFAULT_SIGNED_IN_ROUTE)
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  const back = (reason: Reason) =>
    `${SIGN_IN_ROUTE}?reason=${reason}&next=${encodeURIComponent(next)}`

  if (email === '' || password === '') redirect(back('missing'))

  let failed: Reason | null = null
  try {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) failed = 'credentials'
  } catch (error) {
    if (!(error instanceof MissingSupabaseConfigError)) throw error
    failed = 'unconfigured'
  }

  // Outside the try: `redirect` signals by throwing, and catching it here would
  // swallow the navigation and leave the member staring at a submitted form.
  redirect(failed === null ? next : back(failed))
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next
  const rawReason = Array.isArray(params.reason) ? params.reason[0] : params.reason

  const next = safeRedirectTarget(rawNext, DEFAULT_SIGNED_IN_ROUTE)
  const message = messageFor(rawReason)

  return (
    <main style={styles.main}>
      {/*
        The focus ring cannot be expressed as an inline style — `:focus-visible`
        is a pseudo-class — and WCAG 2.2 requires it here, so it ships as a style
        element rather than being quietly omitted. DESIGN.md: 2px solid ink with a
        2px offset, on stone grounds. Story 1.3 moves this into the token layer.
      */}
      <style>{`
        .watchdog-sheet :focus-visible {
          outline: 2px solid ${INK};
          outline-offset: 2px;
        }
      `}</style>
      <div className="watchdog-sheet" style={styles.sheet}>
        <p style={styles.eyebrow}>Fiduciary Watchdog</p>
        <h1 style={styles.heading}>Sign in</h1>
        <p style={styles.intro}>
          The association&rsquo;s records are open to board members only.
        </p>

        {message !== null && (
          <p id="sign-in-error" role="alert" style={styles.error}>
            {message}
          </p>
        )}

        <form action={signIn} style={styles.form}>
          <input type="hidden" name="next" value={next} />

          <div style={styles.field}>
            <label htmlFor="email" style={styles.label}>
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              aria-describedby={message === null ? undefined : 'sign-in-error'}
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label htmlFor="password" style={styles.label}>
              Password
            </label>
            {/*
              autoComplete and an ordinary password input are what satisfy WCAG
              2.2 SC 3.3.8: a password manager can fill both fields, so nobody is
              asked to recall or transcribe anything. Do not add a CAPTCHA, a
              memorable-word challenge, or paste blocking — each reintroduces the
              cognitive-function test this criterion forbids.
            */}
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-describedby={message === null ? undefined : 'sign-in-error'}
              style={styles.input}
            />
          </div>

          <button type="submit" style={styles.submit}>
            Sign in
          </button>
        </form>

        <p style={styles.footnote}>
          Board members are added by the association&rsquo;s administrator. If you cannot sign in,
          ask them to check your account.
        </p>
      </div>
    </main>
  )
}

/*
 * Literal DESIGN.md values, inlined deliberately. Story 1.3 introduces the token
 * layer and replaces every value here; inventing a second token system now would
 * mean two to reconcile later.
 *
 * ink #14213D · ink-muted #5A6478 · stone #E5E5E0 · stone-raised #F2F2EE
 * rule-strong #9E9E96 · flag #8C2F1E · square corners · no shadows
 */
const INK = '#14213D'
const INK_MUTED = '#5A6478'
const STONE = '#E5E5E0'
const STONE_RAISED = '#F2F2EE'
const RULE_STRONG = '#9E9E96'
const FLAG = '#8C2F1E'
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

const styles: Record<string, CSSProperties> = {
  main: {
    minHeight: '100dvh',
    background: STONE,
    color: INK,
    fontFamily: SANS,
    fontSize: '0.9375rem',
    lineHeight: 1.5,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  sheet: {
    background: STONE_RAISED,
    borderTop: `2px solid ${INK}`,
    padding: '40px',
    width: '100%',
    maxWidth: '26rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
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
    textWrap: 'balance',
  },
  intro: { margin: 0, color: INK_MUTED, maxWidth: '32ch' },
  error: {
    margin: 0,
    padding: '12px',
    background: '#F6E4DF',
    borderLeft: `3px solid ${FLAG}`,
    color: FLAG,
  },
  form: { display: 'flex', flexDirection: 'column', gap: '24px' },
  field: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: {
    fontSize: '0.6875rem',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: INK_MUTED,
  },
  input: {
    font: 'inherit',
    color: INK,
    background: '#FFFFFF',
    border: `1px solid ${RULE_STRONG}`,
    borderRadius: 0,
    padding: '12px',
    minHeight: '44px',
  },
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
  footnote: { margin: 0, color: INK_MUTED, fontSize: '0.8125rem' },
}
