import { redirect } from 'next/navigation'

import { auth } from '@/adapters/auth/auth'
import { createFindingReader } from '@/adapters/db/finding-reader-postgres'
import { REGISTER_ROUTE, SIGN_IN_ROUTE } from '@/core/auth/route-policy'
import type { RegisterFilter } from '@/core/ports/finding-reader'
import { toRegisterView } from '@/core/findings/register-view'
import { ExportControl } from './export-control'
import { DEFAULT_LIMIT, filterFrom } from './filter'
import { RegisterList } from './register-list'

export const metadata = { title: 'Register — Fiduciary Watchdog' }

/**
 * The reviewed register (UX-DR14) — the fiduciary artifact.
 *
 * EXPERIENCE.md: *"The register is the fiduciary artifact. It answers 'what did
 * the board know, and when.' Export from here feeds the board packet."* Until
 * this page existed, a finding marked reviewed left the dashboard for nowhere:
 * the queue filters it out by design and nothing else read it, so the product
 * lost the record at the moment it claimed to have preserved it.
 *
 * `/findings/register` is protected without being listed anywhere, because
 * `PUBLIC_ROUTES` is an allow-list with no prefix matching. The check below is
 * the second lock every surface here carries, and it runs **before** the read —
 * redirecting afterwards would still have put the association's whole reviewed
 * history on the wire.
 *
 * ## The search is in the URL
 *
 * A GET form, so filtering needs no client JavaScript, the back button behaves,
 * and a filtered register is a link one board member can send another. For a
 * record whose purpose is being cited, that is most of its value —
 * `app/access-log/page.tsx` makes the same argument for the audit trail.
 */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await auth()

  // The id, not merely the user. A session carrying no id otherwise reaches
  // code that refuses it, and the refusal surfaces to a board member as though
  // the register were unreachable.
  if (!session?.user?.id) redirect(SIGN_IN_ROUTE)

  const params = await searchParams
  const filter = filterFrom(params)

  const register = await createFindingReader().register(filter)
  const view = toRegisterView(register, filter.search)

  return (
    <main style={styles.main}>
      <p style={styles.eyebrow}>Fiduciary Watchdog</p>
      <h1 style={styles.heading}>Register</h1>
      <p style={styles.body}>
        Every finding the board has reviewed, and who reviewed it. Nothing leaves this record.
      </p>

      {/*
        A GET form, so a filtered register is a URL. `role="search"` because
        that is what it is, and the label is visible rather than a placeholder:
        a placeholder disappears the moment somebody types, which is exactly
        when they most need to know what the box does.
      */}
      <form method="get" role="search" style={styles.search}>
        <label htmlFor="register-search" style={styles.label}>
          Search the register
        </label>
        {/*
          `key` tied to the value, not decoration. This is an uncontrolled
          input, so React keeps its DOM value across a re-render and
          `defaultValue` is read only on mount — after a soft navigation, the
          back button most obviously, the box would still show the previous
          search while the URL and the rows disagreed. Argus raised exactly this
          on the access log.
        */}
        <input
          id="register-search"
          key={`search-${filter.search ?? ''}`}
          name="search"
          type="search"
          defaultValue={filter.search ?? ''}
          placeholder="A vendor, a unit, or a kind of finding"
          style={styles.input}
        />
        {/*
          The limit rides along, because a GET form submits only the fields it
          contains. Without it, a reader who widened the page and then searched
          would be dropped back to the default — and the rows that vanished
          would look like the search's doing. Also raised on the access log.
        */}
        <input type="hidden" name="limit" value={filter.limit} />
        <button type="submit" style={styles.control}>
          Search
        </button>
      </form>

      <RegisterList view={view} />

      {/*
        **The export carries the same filter the page read.** What downloads is
        what is on screen; an export ignoring the search would hand a reader a
        different document from the one they were looking at, and on a permanent
        record quietly a much larger one.

        `total` rather than the rows: the file holds every match, so a control
        naming the page would promise a smaller document than it delivers.
      */}
      {view.kind === 'entries' ? (
        <ExportControl total={view.total} href={exportHref(filter)} />
      ) : null}
    </main>
  )
}

/**
 * The export's URL, carrying the same filter the page read.
 *
 * Built from the port's own filter rather than from the raw search params, so a
 * value the page refused — a limit of `0.5`, a repeated parameter — cannot
 * reach the route by a different path than it reached the read. The access log
 * builds its export link the same way, and CodeRabbit raised there that
 * restating the fields lets a filter gain one and silently stop being exported.
 */
function exportHref(filter: RegisterFilter): string {
  const query = new URLSearchParams()

  if (filter.search !== undefined) query.set('search', filter.search)
  if (filter.limit !== DEFAULT_LIMIT) query.set('limit', String(filter.limit))

  const search = query.toString()

  const route = `${REGISTER_ROUTE}/export`

  return search === '' ? route : `${route}?${search}`
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
  body: { margin: 0, color: 'var(--color-ink-muted)' },
  search: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-row)',
    alignItems: 'end',
  },
  label: {
    fontFamily: 'var(--type-sans)',
    fontSize: 'var(--type-scale-label)',
    letterSpacing: 'var(--type-tracking-label)',
    textTransform: 'uppercase',
    color: 'var(--color-ink-muted)',
    alignSelf: 'center',
  },
  input: {
    font: 'inherit',
    color: 'var(--color-ink)',
    background: 'transparent',
    border: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
    borderRadius: 'var(--radius-none)',
    padding: 'var(--space-row)',
    minHeight: '44px',
    minWidth: '18rem',
  },
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
