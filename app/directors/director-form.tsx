'use client'

import { useActionState } from 'react'

import { addDirector } from './actions'
import { EMPTY_DIRECTOR_STATE, type DirectorState } from './director-state'

/**
 * Adding a director, and the one place their password can be read.
 *
 * ## The password exists only here
 *
 * The database holds its scrypt hash and nothing else; no log carries it; the
 * action returns it once. So this render is not *a* way to read it — it is the
 * only one, and a value shown where the director cannot select and copy it is a
 * value lost along with the account.
 *
 * That is also why the page says it cannot be shown again. Without that
 * sentence the reasonable assumption is that it can be looked up later, and
 * there is nothing to look up.
 */
export function DirectorForm() {
  const [state, submit, pending] = useActionState<DirectorState, FormData>(
    addDirector,
    EMPTY_DIRECTOR_STATE,
  )

  return (
    <>
      <form action={submit} style={styles.form}>
        <label htmlFor="director-email" style={styles.label}>
          Email address
        </label>
        <p id="director-email-hint" style={styles.hint}>
          The address this director will sign in with. They cannot change it themselves.
        </p>
        <input
          id="director-email"
          name="email"
          type="email"
          required
          aria-describedby="director-email-hint director-error"
          style={styles.field}
        />

        <label htmlFor="director-name" style={styles.label}>
          Name (optional)
        </label>
        <input id="director-name" name="displayName" type="text" style={styles.field} />

        <button type="submit" disabled={pending} style={styles.submit}>
          {pending ? 'Adding…' : 'Add director'}
        </button>
      </form>

      {/*
        Always mounted, so assistive technology announces the message when it
        appears. A live region that is created *with* its content is not
        announced - the region has to be watched before the text arrives, which
        is why this renders empty rather than conditionally. Raised by
        CodeRabbit, and this project has an accessibility floor (UX-DR19-21)
        that a form refusing submissions silently would not meet.
      */}
      <p id="director-error" role="alert" aria-live="assertive" style={styles.error}>
        {state.status === 'error' ? state.error : ''}
      </p>

      {/*
        Mounted unconditionally for the same reason as the error region above,
        which this originally failed to follow - and this is the region holding
        the only copy of the password, so a director using a screen reader would
        have been told nothing at the one moment it exists. `styles.result` is a
        margin and nothing else, so the empty region shows nothing. Raised by
        CodeRabbit on the merge request.
      */}
      <section id="director-result" style={styles.result} aria-live="polite">
        {state.status === 'added' && (
          <>
            <h2 style={styles.resultHeading}>{state.email} can now sign in</h2>
            <p style={styles.body}>
              Give them this password. It is not stored anywhere and{' '}
              <strong>cannot be shown again</strong> — if it is lost, the account has to be added
              afresh.
            </p>
            <p data-testid="one-time-password" style={styles.password}>
              {state.password}
            </p>
          </>
        )}
      </section>
    </>
  )
}

const styles = {
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' },
  label: { fontWeight: 600 },
  hint: { margin: 0, opacity: 0.8, fontSize: '0.9rem' },
  field: { padding: '0.6rem', fontSize: '1rem' },
  submit: { padding: '0.7rem 1.2rem', fontSize: '1rem', marginTop: 'var(--space-tight)' },
  error: { color: 'var(--color-flag)', fontWeight: 600 },
  result: { marginTop: 'var(--space-section)' },
  resultHeading: { fontSize: '1.1rem', margin: '0 0 var(--space-tight)' },
  body: { margin: '0 0 var(--space-tight)' },
  password: {
    fontFamily: 'var(--type-mono)',
    fontSize: '1.15rem',
    userSelect: 'all',
    wordBreak: 'break-all',
  },
} as const satisfies Record<string, React.CSSProperties>
