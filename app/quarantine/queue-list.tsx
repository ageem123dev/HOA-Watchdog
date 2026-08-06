import type { QueueView } from '@/core/quarantine/queue-view'

/**
 * The queue, rendered.
 *
 * Presentational and separate from the page on purpose. The page is a server
 * component that reaches the database; this takes a view and returns markup, so
 * what a treasurer actually sees can be asserted without standing up Postgres.
 * The seam is the design, not a concession to testing.
 *
 * There is nothing to click. Confirming a vendor is story 1.6d's, and a control
 * that looks actionable before it works is worse than no control -- it invites
 * someone to believe they have answered a question that is still open.
 */
export function QueueList({ view }: { view: QueueView }) {
  if (view.isEmpty) {
    // A rendered branch, not an absence. Returning null gives a blank page,
    // which satisfies "no rows" and tells a treasurer nothing -- and AC2 asks
    // for the fact to be stated, because "nothing is waiting" and "the page did
    // not load" look identical otherwise.
    return (
      <p style={styles.empty}>
        Nothing is waiting. All vendors on the invoices uploaded so far resolved to known records.
      </p>
    )
  }

  return (
    <ul style={styles.list}>
      {view.items.map((held) => (
        // Keyed on both halves: one document held for two unrecognised names is
        // two rows, and the document id alone would collide between them.
        //
        // The pair cannot collide either, which is not obvious from here. The
        // unique index is on (document_id, normalised_name), and two identical
        // strings normalise identically -- so a second row carrying the same
        // extracted name for the same document cannot be inserted. Raised in
        // review as a possible duplicate-key warning; the constraint is what
        // rules it out, and an index-based key would trade a warning that cannot
        // happen for reconciliation that breaks on reorder.
        <li key={`${held.documentId}:${held.extractedName}`} style={styles.row}>
          {/*
            The name is interpolated as text and nothing more. AD-8 treats an
            extracted value as data, never an instruction, and React escapes by
            default -- so the rule here is simply that the default is never
            defeated for the sake of a nicer-looking name.
          */}
          <span style={styles.name}>{held.extractedName}</span>
          <span style={styles.document}>{held.filename}</span>
        </li>
      ))}
    </ul>
  )
}

const styles = {
  empty: { margin: 0, color: 'var(--color-ink-muted)' },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-row)',
    width: '100%',
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-base)',
    paddingBottom: 'var(--space-row)',
    // `rule-strong`, not `rule`: `core/design/text-pairings.ts` measures the
    // contrast of every colour a surface references, and `rule` is declared in
    // no pairing. Adding one would be a design-system change made in passing,
    // inside a story about a queue.
    borderBottom: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
  },
  name: { fontFamily: 'var(--type-serif)', fontSize: 'var(--type-scale-title)' },
  document: {
    fontSize: 'var(--type-scale-label)',
    letterSpacing: 'var(--type-tracking-label)',
    textTransform: 'uppercase',
    color: 'var(--color-ink-muted)',
  },
} satisfies Record<string, React.CSSProperties>
