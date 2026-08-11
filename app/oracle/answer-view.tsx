'use client'

import { useSyncExternalStore } from 'react'

/**
 * UX-DR11's three layers — the product's central trust surface.
 *
 * "Every Oracle answer renders in three layers, top to bottom: the answer, the
 * evidence table — always present, never collapsed — and the query disclosure,
 * collapsed, labelled with catalog entry and version."
 *
 * The order carries the argument: the claim, then the evidence for it, then how
 * the evidence was obtained. A reader can stop after the first layer and act, or
 * go to the third and check.
 *
 * ## The table is not collapsed, and that is the whole design
 *
 * It is the widest thing on the page and the obvious candidate for a disclosure.
 * The spec forbids it: "A treasurer never has to know to ask for evidence; it is
 * already on screen." An answer somebody must expand something to verify is an
 * answer they stop verifying — and then AD-7's guarantee is true of a system
 * nobody is reading.
 *
 * The spec is blunt about the audience: **"In a dispute, the table is what gets
 * read aloud — not the prose."** Hence generous row height, tabular figures, and
 * no truncation of amounts or unit identifiers at any viewport.
 *
 * ## Props, not fetching
 *
 * Everything arrives as a prop, so the render tests need no server — the shape
 * story 1.6c's `QueueList` established here after importing a server action
 * pulled `next-auth` in and broke the suite's ability to load the file at all.
 */

export interface AnswerViewProps {
  /** UX-DR11: the question stays visible while the answer resolves. */
  readonly question: string
  readonly answer: string
  readonly rows: readonly Record<string, unknown>[]

  /** The pair AD-14 freezes and AD-12 logs — `dues_status@1`. */
  readonly entryId: string
  readonly version: number

  /**
   * The reviewed SQL this entry runs.
   *
   * From the catalog rather than the provenance log, and AD-14 is what makes
   * those the same text: a published version's SQL is frozen, and
   * `published-versions.json` fails the build if it moves. The log is the record
   * of *when* it ran; the catalog is the record of *what* it is.
   */
  readonly sql: string
}

/**
 * One value, as the records carry it.
 *
 * Scalars pass through untouched — these are the values AD-7 compared the prose
 * against, and re-spelling one would break "every figure in the answer must be
 * locatable in the table".
 *
 * Objects and arrays are serialized rather than coerced. A `jsonb` column
 * reaching `String()` renders `[object Object]`, which tells a reader nothing
 * and, in a dispute, is the cell somebody is trying to read aloud. Raised by
 * CodeRabbit.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)

  return String(value)
}

/**
 * Where AC4's "open state persists for the session" lives.
 *
 * `sessionStorage`, not `localStorage`: the spec says *session*, and a
 * preference that outlives the browser tab would quietly re-open the SQL on a
 * shared board laptop weeks later.
 *
 * One key for the whole surface rather than one per entry. The reader is not
 * expressing an opinion about `dues_status@1`; they are expressing that they
 * are the kind of person who reads the query, and charging them a click on
 * every question would undo the point.
 */
const DISCLOSURE_KEY = 'oracle.query.open'

/**
 * Subscribers, so every mounted `AnswerView` agrees.
 *
 * `sessionStorage` emits no event in the tab that wrote it, so a component that
 * only read it would keep rendering the old value after another one toggled.
 */
const listeners = new Set<() => void>()

function subscribe(notify: () => void): () => void {
  listeners.add(notify)

  return () => {
    listeners.delete(notify)
  }
}

/**
 * What the disclosure falls back to when storage is unavailable.
 *
 * Not merely a cache. A browser that refuses `sessionStorage` must still get a
 * disclosure that opens — the preference is a nicety, the control is not — so
 * this holds the state for the life of the page when the real store cannot.
 */
let inMemoryOpen = false


function readDisclosure(): boolean {
  // `sessionStorage` *throws* rather than returning null when a browser
  // restricts it: Safari's private mode and restricted embedding both raise
  // `SecurityError` on access. This read happens during render, so an unguarded
  // call does not degrade the disclosure — it takes down the whole Oracle, the
  // one surface in this product whose entire purpose is to be trusted. Raised
  // by Argus.
  try {
    return sessionStorage.getItem(DISCLOSURE_KEY) === 'open'
  } catch {
    return inMemoryOpen
  }
}

/**
 * Collapsed on the server, always.
 *
 * The server cannot see `sessionStorage`, and this is the value React hydrates
 * against before swapping in the client's. It is also what AC4 asks for —
 * "collapsed by default" — so the pre-hydration state is honest rather than a
 * placeholder.
 */
function serverDisclosure(): boolean {
  return false
}

function writeDisclosure(open: boolean): void {
  // The fallback is updated first and the listeners are notified last, so a
  // throwing `setItem` costs the *memory* of the preference and nothing else.
  // Wrapping the whole body in one `try` instead would skip the notify on
  // failure, and the button would silently do nothing — a worse outcome than
  // the bug being fixed, and the reason this is not a two-line change.
  inMemoryOpen = open

  try {
    sessionStorage.setItem(DISCLOSURE_KEY, open ? 'open' : 'closed')
  } catch {
    // Storage refused. The disclosure still works; it just forgets.
  }

  for (const notify of listeners) notify()
}

export function AnswerView({ question, answer, rows, entryId, version, sql }: AnswerViewProps) {
  // `useSyncExternalStore` rather than `useState` seeded in an effect. Seeding
  // in an effect is a setState during the first commit — eslint calls it a
  // cascading render and is right — and seeding it lazily instead would read
  // `sessionStorage` on the server, where it does not exist. This is the hook
  // that exists for state React does not own, and it takes the server snapshot
  // as its third argument precisely so hydration has something to agree with.
  const queryOpen = useSyncExternalStore(subscribe, readDisclosure, serverDisclosure)

  // The union of every row's keys, not the first row's. A catalog entry may
  // return rows of differing shape, and taking the first row's keys silently
  // drops a column that only later rows carry — a value missing from the table
  // is a figure in the prose a reader cannot find, which the spec calls a defect
  // rather than a display choice. Raised by CodeRabbit.
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]

  return (
    <article>
      <header>
        <h1>{question}</h1>
      </header>

      {/* Layer one. */}
      <p>{answer}</p>

      {/* Layer two — never behind a control. */}
      <section aria-label="Evidence">
        {rows.length === 0 ? (
          <p>No records matched this question.</p>
        ) : (
          <table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                // The index is the key because a result row has no identity of
                // its own — AD-16's reasoning keeps ids out of catalog results,
                // and these rows are never reordered or edited in place.
                <tr key={index}>
                  {columns.map((column) => (
                    // Rendered exactly as the rows carry them, and that is the
                    // decision rather than an omission. These are the values
                    // AD-7 compared the prose against; showing them altered
                    // would break "every figure in the answer must be locatable
                    // in the table", and re-spelling an amount here would be the
                    // second statement of money formatting that AC6 exists to
                    // forbid. In a dispute this table is what gets read aloud,
                    // so it shows what the records hold.
                    <td key={column}>{cell(row[column])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Layer three. */}
      <section>
        <button
          type="button"
          aria-expanded={queryOpen}
          // Only while the target exists. `aria-controls` pointing at an id that
          // is not in the document is a broken reference, and a screen reader
          // following it lands nowhere. The alternative — keeping the `<pre>`
          // mounted and `hidden` — would put the SQL in the accessibility tree's
          // reach for anything that ignores `hidden`. Raised by Argus.
          aria-controls={queryOpen ? 'oracle-query' : undefined}
          style={styles.disclosure}
          onClick={() => writeDisclosure(!queryOpen)}
        >
          {/* A native button, deliberately. Enter, Space, focus order and the
              role come with it; a div with an onClick has none of them and looks
              identical until somebody tries to use a keyboard. */}
          Query — {entryId}@{version}
        </button>

        {queryOpen ? (
          <pre id="oracle-query">
            <code>{sql}</code>
          </pre>
        ) : null}
      </section>
    </article>
  )
}

/**
 * The same inline-token pattern `app/dashboard/page.tsx` and
 * `app/quarantine/page.tsx` use — custom properties rather than literals, which
 * `core/design/no-raw-values.test.ts` enforces across the repo.
 *
 * `minHeight` is the exception the scanner already allows, and it is here for
 * AC7: DESIGN.md sets a 24x24 CSS px minimum target, and 44px is the size the
 * dashboard's control already uses. Matching it keeps one answer to "how big is
 * a control" rather than adding a second.
 */
const styles = {
  disclosure: {
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
