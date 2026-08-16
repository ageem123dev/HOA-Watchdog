import type { ComparisonTable, FindingDetailView } from '@/core/findings/detail-view'
import type { ReviewOutcome } from '@/core/findings/review'
import { ReviewControl } from '../review-control'

/**
 * The finding, laid out (AC2, AC6).
 *
 * Presentational, and it takes the whole view rather than the record — every
 * decision about wording, severity and what the evidence supports was made in
 * `core/findings/detail-view.ts`, so this file chooses markup and nothing else.
 * The same split the dashboard's list makes, for the same reason: copy assembled
 * inside JSX can only be checked by rendering it.
 *
 * **Whether the action appears is decided by the record, not by this component.**
 * `view.reviewed` is present exactly when the register has already answered, and
 * a reviewed finding offers nothing to press — not an error, an ordinary outcome
 * that someone got there first.
 */
export function FindingDetailPanel({
  view,
  markReviewed,
}: {
  readonly view: FindingDetailView
  readonly markReviewed: (findingId: string) => Promise<ReviewOutcome>
}) {
  return (
    <main style={styles.main}>
      <p style={styles.eyebrow}>{view.severityLabel}</p>
      <h1 style={styles.heading}>{view.title}</h1>

      {/*
        The dashboard row's sentence, verbatim. UX-DR23 governs it there and
        here, and it is the same string rather than a second phrasing of it.
      */}
      {view.summary === null ? null : <p style={styles.body}>{view.summary}</p>}

      <p style={styles.noticed}>
        Noticed <time dateTime={view.raisedOn}>{view.raisedOn}</time>
      </p>

      {view.figures.length === 0 ? null : (
        <dl style={styles.figures}>
          {view.figures.map((figure) => (
            <div key={figure.label} style={styles.figure}>
              <dt style={styles.figureLabel}>{figure.label}</dt>
              <dd style={figure.numeric ? styles.figureValueNumeric : styles.figureValue}>
                {figure.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {view.comparisons === null ? null : <Comparisons table={view.comparisons} />}

      {/*
        **AC6.** A finding the register has already answered for offers no
        action — the sentence and nothing else. AC7's refusal says the same
        words, because both come from one `reviewMessage`.
      */}
      {view.reviewed === null ? (
        <ReviewControl findingId={view.id} markReviewed={markReviewed} />
      ) : (
        <p role="status" style={styles.body}>
          {view.reviewed.text}
        </p>
      )}
    </main>
  )
}

/**
 * What was compared.
 *
 * A real `<table>` with `<th scope="col">`, following `app/oracle/answer-view.tsx`
 * — UX-DR5. In a dispute this is the part that gets read aloud, so it is marked
 * up as the tabular data it is rather than as a grid of divs that looks like one.
 *
 * An empty cell where the record holds no value, and never a dash or a zero:
 * both are marks a board member could read as a figure.
 */
function Comparisons({ table }: { table: ComparisonTable }) {
  return (
    // **No scroller.** The first version of this wrapped the table in
    // `overflow-x: auto`, which EXPERIENCE.md forbids in as many words: evidence
    // tables "do not scroll horizontally -- a table that scrolls sideways in a
    // meeting is a table nobody reads". Below 48rem the stylesheet stacks each
    // row into label/value groups instead, and `data-column` is what lets it
    // name the value once the header row is out of sight. Story 4.7 owns that
    // treatment for both surfaces.
    <div>
      <table className="evidence-table" style={styles.table}>
        <caption style={styles.caption}>{table.caption}</caption>
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th
                key={column.label}
                scope="col"
                style={column.numeric ? styles.headNumeric : styles.head}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            // The index is the key because a comparison has no identity of its
            // own — these rows are never reordered or edited in place, and the
            // same reasoning `answer-view.tsx` records for its result rows.
            <tr key={index}>
              {row.map((cell, column) => (
                // Keyed by position, like the row above it and for the same
                // reason: a cell has no identity of its own and the columns are
                // a module constant that never reorders. The label-based key
                // this replaced carried an `?? column` fallback that could not
                // fire, since every row is built with the columns' own arity.
                <td
                  key={column}
                  // Read by the stacked layout below 48rem, where the header
                  // row is hidden and CSS cannot reach the <th> above.
                  data-column={table.columns[column]?.label ?? ''}
                  data-numeric={String(table.columns[column]?.numeric === true)}
                  style={table.columns[column]?.numeric === true ? styles.cellNumeric : styles.cell}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
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
    fontFamily: 'var(--type-sans)',
    fontSize: 'var(--type-scale-label)',
    letterSpacing: 'var(--type-tracking-label)',
    textTransform: 'uppercase',
    color: 'var(--color-ink-muted)',
    margin: 0,
  },
  heading: {
    fontFamily: 'var(--type-serif)',
    fontSize: 'var(--type-scale-title)',
    fontWeight: 600,
    margin: 0,
    color: 'var(--color-ink)',
  },
  body: { margin: 0, color: 'var(--color-ink)' },
  noticed: {
    margin: 0,
    fontFamily: 'var(--type-sans)',
    fontSize: 'var(--type-scale-label)',
    color: 'var(--color-ink-muted)',
  },
  figures: {
    margin: 0,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-section)',
  },
  figure: { display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' },
  figureLabel: {
    fontFamily: 'var(--type-sans)',
    fontSize: 'var(--type-scale-label)',
    letterSpacing: 'var(--type-tracking-label)',
    textTransform: 'uppercase',
    color: 'var(--color-ink-muted)',
  },
  figureValue: { margin: 0, color: 'var(--color-ink)' },
  figureValueNumeric: {
    margin: 0,
    fontFamily: 'var(--type-serif)',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--color-ink)',
  },
  table: { borderCollapse: 'collapse', width: '100%' },
  caption: {
    textAlign: 'left',
    fontFamily: 'var(--type-sans)',
    fontSize: 'var(--type-scale-label)',
    letterSpacing: 'var(--type-tracking-label)',
    textTransform: 'uppercase',
    color: 'var(--color-ink-muted)',
    paddingBottom: 'var(--space-row)',
  },
  head: {
    textAlign: 'left',
    fontFamily: 'var(--type-sans)',
    fontSize: 'var(--type-scale-label)',
    color: 'var(--color-ink-muted)',
    padding: 'var(--space-row)',
    borderBottom: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
    whiteSpace: 'nowrap',
  },
  headNumeric: {
    textAlign: 'right',
    fontFamily: 'var(--type-sans)',
    fontSize: 'var(--type-scale-label)',
    color: 'var(--color-ink-muted)',
    padding: 'var(--space-row)',
    borderBottom: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
    whiteSpace: 'nowrap',
  },
  cell: {
    textAlign: 'left',
    padding: 'var(--space-row)',
    borderBottom: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
    color: 'var(--color-ink)',
  },
  cellNumeric: {
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    padding: 'var(--space-row)',
    borderBottom: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
    color: 'var(--color-ink)',
  },
} as const
