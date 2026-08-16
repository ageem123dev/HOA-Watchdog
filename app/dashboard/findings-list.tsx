import Link from 'next/link'

import { findingRoute } from '@/core/auth/route-policy'
import type { DashboardView } from '@/core/findings/dashboard-view'
import type { FindingRow, Severity } from '@/core/findings/finding-view'

/**
 * The queue of what nobody has looked at (UX-DR2, UX-DR4, UX-DR10, UX-DR24).
 *
 * Presentational, and it takes the whole view rather than a list of rows. The
 * three states are one decision made in `core/findings/dashboard-view.ts`, so
 * this component chooses a branch rather than re-deriving which of them applies
 * — a page that decided emptiness for itself would get "nothing needs your
 * attention" on the day the association signed up.
 *
 * ## The whole row is the click target, and there is exactly one of them
 *
 * UX-DR4, the half story 4.5 deferred until the destination existed. The link
 * wraps the row's entire contents — tick, words, evidence line, amount and date
 * — so a mis-click near the money does exactly what a mis-click near the text
 * does. **The amount is never a link of its own**, which is the clause worth
 * asserting rather than assuming: a second link inside the row would be a
 * second tab stop with no separate meaning, and the one nearest the figure is
 * the one a hurried reader hits.
 */
export function FindingsList({ view }: { view: DashboardView }) {
  if (view.kind === 'nothing-checked') {
    return (
      <section style={styles.empty} aria-labelledby="findings-heading">
        <h2 id="findings-heading" style={styles.heading}>
          Nothing has been checked yet
        </h2>
        {/*
          Deliberately not "nothing uploaded yet". Extraction is asynchronous,
          so this state also covers documents that have arrived and not been
          read — and claiming nothing was uploaded would be false for the
          treasurer looking at the upload they made a minute ago. What is true
          in both cases is that nothing has been examined, and the action is the
          same either way.
        */}
        <p style={styles.body}>
          Findings appear here once a document has been read. Nothing is being claimed about your
          records until then.
        </p>
        <Link href="/upload" style={styles.link}>
          Upload a document
        </Link>
      </section>
    )
  }

  if (view.kind === 'nothing-to-review') {
    return (
      <section style={styles.empty} aria-labelledby="findings-heading">
        <h2 id="findings-heading" style={styles.heading}>
          Nothing needs your attention
        </h2>
        {/*
          **UX-DR24.** The count is the content of the claim, not a detail
          beside it — "no reassurance without a count of what was checked". The
          view type makes it impossible to reach this branch without one.
        */}
        <p style={styles.body}>{documentsChecked(view.documentsChecked)}</p>
      </section>
    )
  }

  return (
    <section style={styles.section} aria-labelledby="findings-heading">
      <h2 id="findings-heading" style={styles.heading}>
        {view.total === 1 ? '1 finding needs review' : `${view.total} findings need review`}
      </h2>
      {/*
        Said only when it is true. The dashboard is a window onto a register
        that keeps growing, and a list of twenty under a heading reading
        "37 findings need review" would otherwise leave a board member to work
        out for themselves that they had not seen the other seventeen.
      */}
      {view.rows.length < view.total ? (
        <p style={styles.body}>Showing the {view.rows.length} most recent.</p>
      ) : null}
      <ul style={styles.list}>
        {view.rows.map((row) => (
          <Row key={row.id} row={row} />
        ))}
      </ul>
    </section>
  )
}

function documentsChecked(count: number): string {
  return count === 1 ? '1 document checked.' : `${count} documents checked.`
}

/** `flag` for the loud one, `brass` for the quiet one. DESIGN.md → Components. */
const TICK: Readonly<Record<Severity, string>> = {
  'needs-review': 'var(--color-flag)',
  'worth-checking': 'var(--color-brass)',
}

function Row({ row }: { row: FindingRow }) {
  return (
    <li>
      {/*
        **One link, wrapping everything.** The grid moves onto the anchor rather
        than sitting inside it, so the row's shape is unchanged and there is no
        second focusable thing in it. `next/link` rather than a bare anchor, for
        the reason the dashboard's other links give: an anchor triggers a full
        document load and discards the client router's state.
      */}
      <Link href={findingRoute(row.id)} style={styles.row}>
        {/*
          **`aria-hidden`, because the words beside it carry the same meaning.**
          UX-DR2 requires the tick never to be the sole channel, and the answer
          to that is the label — announcing the bar as well would read the
          severity twice to a screen-reader user and once to everyone else.
        */}
        <span aria-hidden="true" style={{ ...styles.tick, background: TICK[row.severity] }} />
        <div style={styles.text}>
          <p style={styles.severity}>{row.severityLabel}</p>
          <p style={styles.title}>{row.title}</p>
          {/*
            The finding's justification, never flavour text (DESIGN.md). Absent
            when the evidence supports no honest sentence, rather than filled
            with a plausible one.
          */}
          {row.evidenceLine === null ? null : <p style={styles.evidence}>{row.evidenceLine}</p>}
          {/*
            **EXPERIENCE.md, State Patterns: "Findings show their detection date."**
            A `<time>` rather than a bare string, so the value is legible to
            anything that reads the page rather than looks at it — and so a queue
            entry can be aged by the person reading it, which is most of what a
            queue is for.
          */}
          <p style={styles.noticed}>
            Noticed <time dateTime={row.raisedOn}>{row.raisedOn}</time>
          </p>
        </div>
        {/*
          Nothing at all where the record supports no figure — never `$0.00`, a
          dash, or a bare currency mark. Each of those is a number a board member
          could act on, manufactured from a record that has none.
        */}
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
  body: {
    margin: 0,
    fontSize: 'var(--type-scale-body)',
    color: 'var(--color-ink-muted)',
  },
  link: { color: 'var(--color-ink)' },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  // `auto` on the text column and nothing fixed on the row: UX-DR20 asks for
  // flexible row heights, so a long vendor name wraps rather than being cut.
  row: {
    // An anchor now, so its colour and underline are stated rather than
    // inherited from the browser. A queue rendered in link blue would read as
    // twenty separate destinations rather than as a register.
    color: 'inherit',
    textDecoration: 'none',
    display: 'grid',
    gridTemplateColumns: 'var(--component-margin-tick-width) 1fr auto',
    gap: 'var(--space-row)',
    alignItems: 'start',
    padding: 'var(--space-row) 0',
    // `rule-strong`, matching every other hairline in `app/`. `--color-rule` is
    // a lighter token that no surface declares a pairing for, so its contrast is
    // measured by nothing — `core/design/text-pairings.test.ts` refused it, and
    // was right to: a separator nobody can see is a separator that is not there.
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
  evidence: {
    margin: 0,
    fontSize: 'var(--type-scale-body)',
    color: 'var(--color-ink-muted)',
  },
  noticed: {
    margin: 0,
    fontFamily: 'var(--type-sans)',
    fontSize: 'var(--type-scale-label)',
    color: 'var(--color-ink-muted)',
  },
  amount: {
    margin: 0,
    textAlign: 'right',
    fontFamily: 'var(--type-serif)',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--color-ink)',
  },
} as const
