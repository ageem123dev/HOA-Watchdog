import Link from 'next/link'

import { findingRoute } from '@/core/auth/route-policy'
import { counted } from '@/core/findings/evidence'
import type { RegisterEntry, RegisterView } from '@/core/findings/register-view'
import type { Severity } from '@/core/findings/finding-view'

/**
 * The register a board member reads (AC1, AC2, AC3, AC7).
 *
 * Presentational, and it takes the whole view rather than a list of rows. The
 * three states were decided once in `core/findings/register-view.ts`, so this
 * file chooses a branch rather than re-deriving which applies — a page deciding
 * emptiness for itself tells somebody who searched for one vendor that nothing
 * has ever been reviewed.
 *
 * The row is the dashboard's row with its attribution beneath it, linked whole,
 * for UX-DR4's reason: a mis-click near the money must not do something
 * different from a mis-click near the text.
 */
export function RegisterList({ view }: { view: RegisterView }) {
  if (view.kind === 'nothing-reviewed') {
    return (
      <section style={styles.empty} aria-labelledby="register-heading">
        <h2 id="register-heading" style={styles.heading}>
          Nothing has been reviewed yet
        </h2>
        {/*
          **Not an error, and EXPERIENCE.md says so by name.** An empty
          permanent record on the day an association signs up is the ordinary
          state of a new register, and copy that apologised for it would teach a
          board member to distrust the surface that matters most.
        */}
        <p style={styles.body}>
          Findings arrive here after a board member has reviewed them on the dashboard. Nothing is
          missing.
        </p>
      </section>
    )
  }

  if (view.kind === 'no-matches') {
    return (
      <section style={styles.empty} aria-labelledby="register-heading">
        <h2 id="register-heading" style={styles.heading}>
          No reviewed findings match that search
        </h2>
        {/*
          The search is named back so the reader can see their own typo. Told
          "nothing has been reviewed yet" instead, they would learn something
          false about the whole record from a question about one vendor.
        */}
        <p style={styles.body}>
          Nothing in the register matches <strong>{view.search}</strong>. The findings that are here
          were not removed by searching.
        </p>
      </section>
    )
  }

  return (
    <section style={styles.section} aria-labelledby="register-heading">
      <h2 id="register-heading" style={styles.heading}>
        {counted(view.total, 'reviewed finding')}
      </h2>
      {/*
        Said only when it is true. A permanent record that always claims to be
        truncated teaches a reader to ignore the one time it is.
      */}
      {view.showingAll ? null : (
        <p style={styles.body}>Showing the {view.entries.length} most recent.</p>
      )}
      <ul style={styles.list}>
        {view.entries.map((entry) => (
          <Entry key={entry.row.id} entry={entry} />
        ))}
      </ul>
    </section>
  )
}

/** `flag` for the loud one, `brass` for the quiet one. DESIGN.md → Components. */
const TICK: Readonly<Record<Severity, string>> = {
  'needs-review': 'var(--color-flag)',
  'worth-checking': 'var(--color-brass)',
}

function Entry({ entry }: { entry: RegisterEntry }) {
  const { row } = entry

  return (
    <li>
      <Link href={findingRoute(row.id)} style={styles.row}>
        {/* The words carry the severity; announcing the bar as well would read
            it twice to a screen-reader user and once to everyone else. */}
        <span aria-hidden="true" style={{ ...styles.tick, background: TICK[row.severity] }} />
        <div style={styles.text}>
          <p style={styles.severity}>{row.severityLabel}</p>
          <p style={styles.title}>{row.title}</p>
          {row.evidenceLine === null ? null : <p style={styles.evidence}>{row.evidenceLine}</p>}
          <p style={styles.noticed}>
            Noticed <time dateTime={row.raisedOn}>{row.raisedOn}</time>
          </p>
          {/*
            **The register's own column: who signed it off.** The dashboard's
            row cannot carry this — everything on it is unreviewed — and it is
            the whole reason an auditor is handed this page rather than that one.
          */}
          {entry.reviewed === null ? null : (
            <p style={styles.reviewed}>{entry.reviewed.text}</p>
          )}
        </div>
        {row.amount === null ? null : <p style={styles.amount}>{row.amount}</p>}
      </Link>
    </li>
  )
}

const styles = {
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-row)',
    width: '100%',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-row)',
    alignItems: 'flex-start',
  },
  heading: {
    margin: 0,
    fontFamily: 'var(--type-serif)',
    fontSize: 'var(--type-scale-title)',
    fontWeight: 600,
    color: 'var(--color-ink)',
  },
  body: { margin: 0, fontSize: 'var(--type-scale-body)', color: 'var(--color-ink-muted)' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' },
  row: {
    color: 'inherit',
    textDecoration: 'none',
    display: 'grid',
    gridTemplateColumns: 'var(--component-margin-tick-width) 1fr auto',
    gap: 'var(--space-row)',
    alignItems: 'start',
    padding: 'var(--space-row) 0',
    borderBottom: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
  },
  tick: { alignSelf: 'stretch' },
  text: { display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' },
  severity: {
    margin: 0,
    fontFamily: 'var(--type-sans)',
    fontSize: 'var(--type-scale-label)',
    letterSpacing: 'var(--type-tracking-label)',
    textTransform: 'uppercase',
    color: 'var(--color-ink-muted)',
  },
  title: { margin: 0, color: 'var(--color-ink)' },
  evidence: { margin: 0, fontSize: 'var(--type-scale-body)', color: 'var(--color-ink-muted)' },
  noticed: {
    margin: 0,
    fontFamily: 'var(--type-sans)',
    fontSize: 'var(--type-scale-label)',
    color: 'var(--color-ink-muted)',
  },
  // `brass` is DESIGN.md's token for "register and archival affordances", which
  // is exactly what this line is.
  reviewed: {
    margin: 0,
    fontFamily: 'var(--type-sans)',
    fontSize: 'var(--type-scale-label)',
    color: 'var(--color-brass)',
  },
  amount: {
    margin: 0,
    textAlign: 'right',
    fontFamily: 'var(--type-serif)',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--color-ink)',
  },
} as const
