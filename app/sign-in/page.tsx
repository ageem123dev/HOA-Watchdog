import type { CSSProperties } from 'react'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/adapters/auth/supabase-server'
import { MissingSupabaseConfigError } from '@/adapters/auth/env'
import { DEFAULT_SIGNED_IN_ROUTE, SIGN_IN_ROUTE, safeRedirectTarget } from '@/core/auth/route-policy'
import { signInMessage, type SignInReason } from '@/core/auth/sign-in-feedback'

export const metadata = { title: 'Sign in — Fiduciary Watchdog' }

/**
 * A failure Supabase could not complete, as opposed to one it completed with a
 * verdict of "no". Reporting an outage as a wrong password sends directors off
 * to reset credentials that were never the problem.
 */
function isProviderUnavailable(error: { name?: string; status?: number }): boolean {
  if (error.name === 'AuthRetryableFetchError') return true
  const { status } = error
  return status === undefined || status === 0 || status >= 500
}

async function signIn(formData: FormData) {
  'use server'

  const next = safeRedirectTarget(String(formData.get('next') ?? ''), DEFAULT_SIGNED_IN_ROUTE)
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  const back = (reason: SignInReason) =>
    `${SIGN_IN_ROUTE}?reason=${reason}&next=${encodeURIComponent(next)}`

  if (email === '' || password === '') redirect(back('missing'))

  let failed: SignInReason | null = null
  try {
    const supabase = await createSupabaseServerClient({ cookieWrites: 'required' })
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) failed = isProviderUnavailable(error) ? 'unavailable' : 'credentials'
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
  const message = signInMessage(rawReason)

  return (
    <main style={styles.main}>
      <div style={styles.sheet}>
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
            {/*
              After a failure the page arrives as a fresh document, and a live
              region that is already present when the document loads is not
              announced — announcement requires the region to change after it
              exists. Focusing the first field instead makes a screen reader read
              its `aria-describedby` target, so the error is spoken on arrival.
              `autoFocus` is the HTML attribute here, so it works without script.
            */}
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus={message !== null}
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

const styles: Record<string, CSSProperties> = {
  main: {
    minHeight: '100dvh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-block)',
  },
  sheet: {
    background: 'var(--color-stone-raised)',
    borderTop: 'var(--component-rule-heading) solid var(--color-ink)',
    padding: 'var(--space-section)',
    width: '100%',
    maxWidth: '26rem',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-block)',
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
    textWrap: 'balance',
  },
  intro: { margin: 0, color: 'var(--color-ink-muted)', maxWidth: '32ch' },
  error: {
    margin: 0,
    padding: 'var(--space-row)',
    background: 'var(--color-flag-tint)',
    borderLeft: 'var(--component-margin-tick-width) solid var(--color-flag)',
    color: 'var(--color-flag)',
  },
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-block)' },
  field: { display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' },
  label: {
    fontSize: 'var(--type-scale-label)',
    letterSpacing: 'var(--type-tracking-label)',
    textTransform: 'uppercase',
    color: 'var(--color-ink-muted)',
  },
  input: {
    font: 'inherit',
    color: 'var(--color-ink)',
    background: 'var(--color-on-ink)',
    border: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
    borderRadius: 'var(--radius-none)',
    padding: 'var(--space-row)',
    minHeight: '44px',
  },
  submit: {
    font: 'inherit',
    color: 'var(--color-ink)',
    background: 'transparent',
    border: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
    borderRadius: 'var(--radius-none)',
    padding: 'var(--space-row)',
    minHeight: '44px',
    cursor: 'pointer',
  },
  // Body scale, not label scale. The pre-token value was 13px and the token set
  // has no 13px step; snapping to `scale-label` (11px) would have shrunk running
  // prose to the size reserved for uppercase tracked labels, which is a
  // legibility regression in a story about legibility.
  footnote: { margin: 0, color: 'var(--color-ink-muted)', fontSize: 'var(--type-scale-body)' },
}
