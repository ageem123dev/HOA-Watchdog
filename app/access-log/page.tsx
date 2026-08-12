import { redirect } from 'next/navigation'

import { auth } from '@/adapters/auth/auth'
import { createQueryLogReader } from '@/adapters/db/query-log-reader-postgres'
import { SIGN_IN_ROUTE } from '@/core/auth/route-policy'
import { LogTable } from './log-table'
import { filterFrom, DEFAULT_LIMIT } from './filter'

export const metadata = { title: 'Access log — Fiduciary Watchdog' }

/**
 * The access log (story 3.8, NFR-5 and UX-DR16).
 *
 * AD-12 has written a provenance record on every catalog execution since story
 * 3.1, and until now nobody could read it. An audit trail nobody reads is a
 * promise rather than a control.
 *
 * ## The filters are in the URL
 *
 * Story 3.6c's shape: a GET form, so filtering needs no client JavaScript, the
 * back button behaves, and a filtered view is a link somebody can send to
 * another board member — which for an audit trail is most of its value.
 */
export default async function AccessLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await auth()
  // The id, not merely the user — story 3.6b's finding. A session with no id
  // otherwise reaches code that refuses it, and the refusal surfaces to a board
  // member as though the records were unreachable.
  if (!session?.user?.id) redirect(SIGN_IN_ROUTE)

  const params = await searchParams
  const filter = filterFrom(params)

  const records = await createQueryLogReader().recent(filter)

  return (
    <main style={styles.main}>
      <p style={styles.eyebrow}>Fiduciary Watchdog</p>
      <h1 style={styles.heading}>Access log</h1>
      <p style={styles.body}>
        Every question asked of the association&rsquo;s records, and who asked it.
      </p>

      {/*
        A GET form, so a filtered view is a URL. Same reasoning as the dashboard
        ask field: no client JavaScript, correct back button, and the result is
        shareable — which for an audit trail is the point rather than a bonus.
      */}
      <form method="get" role="search" style={styles.filters}>
        <label htmlFor="actor" style={styles.label}>
          Who asked
        </label>
        <input
          id="actor"
          name="actorId"
          type="search"
          defaultValue={filter.actorId ?? ''}
          style={styles.input}
        />

        <label htmlFor="entry" style={styles.label}>
          What ran
        </label>
        <input
          id="entry"
          name="entryId"
          type="search"
          defaultValue={filter.entryId ?? ''}
          style={styles.input}
        />

        <button type="submit" style={styles.control}>
          Filter
        </button>
      </form>

      <LogTable records={records} filtered={isFiltered(filter)} />

      {/*
        The export carries the same filter, so what downloads is what is on
        screen. An export that ignored the filter would hand a reader a
        different document from the one they were looking at — and on an audit
        trail, quietly a much larger one.
      */}
      <a href={`/access-log/export?${exportQuery(filter)}`} style={styles.control}>
        Download CSV
      </a>
    </main>
  )
}

function isFiltered(filter: { actorId?: string; entryId?: string }): boolean {
  return filter.actorId !== undefined || filter.entryId !== undefined
}

function exportQuery(filter: {
  actorId?: string
  entryId?: string
  limit: number
}): string {
  const query = new URLSearchParams()
  if (filter.actorId !== undefined) query.set('actorId', filter.actorId)
  if (filter.entryId !== undefined) query.set('entryId', filter.entryId)
  if (filter.limit !== DEFAULT_LIMIT) query.set('limit', String(filter.limit))

  return query.toString()
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
    fontSize: 'var(--type-scale-figure)',
    margin: 0,
  },
  body: {
    margin: 0,
    maxWidth: '60ch',
  },
  filters: {
    display: 'flex',
    gap: 'var(--space-row)',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  label: {
    fontSize: 'var(--type-scale-label)',
    letterSpacing: 'var(--type-tracking-label)',
    textTransform: 'uppercase',
    color: 'var(--color-ink-muted)',
  },
  input: {
    font: 'inherit',
    color: 'var(--color-ink)',
    background: 'transparent',
    border: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
    borderRadius: 'var(--radius-none)',
    padding: 'var(--space-row)',
    minHeight: '44px',
    minWidth: '44px',
  },
  control: {
    display: 'inline-block',
    font: 'inherit',
    color: 'var(--color-ink)',
    background: 'transparent',
    border: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
    borderRadius: 'var(--radius-none)',
    padding: 'var(--space-row)',
    minHeight: '44px',
    minWidth: '44px',
    cursor: 'pointer',
  },
} as const
