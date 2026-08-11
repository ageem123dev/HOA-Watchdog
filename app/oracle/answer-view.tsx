'use client'

import { useState } from 'react'

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

export function AnswerView({ question, answer, rows, entryId, version, sql }: AnswerViewProps) {
  const [queryOpen, setQueryOpen] = useState(false)

  const columns = rows.length > 0 ? Object.keys(rows[0]!) : []

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
                    <td key={column}>{String(row[column] ?? '')}</td>
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
          onClick={() => setQueryOpen((open) => !open)}
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
