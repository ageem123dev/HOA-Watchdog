import type { QueueView } from '@/core/quarantine/queue-view'

/**
 * A server action, as the page hands it in.
 *
 * Taken as a prop rather than imported. Importing the actions here dragged
 * `next-auth` into every rendering test through `'use server'`, and the suite
 * simply failed to load the file — the test saying, plainly, that a
 * presentational component had started reaching for the server.
 *
 * Returns `void`, which is what React's `formAction` accepts. The actions
 * themselves return an outcome and are tested on it; the page wraps them, and
 * what a treasurer sees of `already-resolved` today is the row disappearing
 * rather than a sentence. Reporting it in words needs `useActionState` in a
 * client component, as `app/upload/upload-form.tsx` does — recorded, not done.
 */
type ResolveAction = (formData: FormData) => void | Promise<void>

/**
 * The queue, rendered.
 *
 * Presentational and separate from the page on purpose. The page is a server
 * component that reaches the database; this takes a view and returns markup, so
 * what a treasurer actually sees can be asserted without standing up Postgres.
 * The seam is the design, not a concession to testing.
 *
 * Story 1.6d gave it controls. Each row offers confirm-as-new, and one button
 * per candidate the similarity ranking turned up.
 *
 * Nothing is preselected and there is no free-text field: a treasurer chooses an
 * identity or creates one, and never types a vendor. A preselected candidate is
 * automatic near-matching with one extra click, which is the failure the whole
 * of epic story 1.6 exists to prevent -- `suggest`'s own header says a caller
 * treating the first entry as an answer has reintroduced it.
 */
export function QueueList({
  view,
  confirmAction,
  matchAction,
}: {
  view: QueueView
  confirmAction: ResolveAction
  matchAction: ResolveAction
}) {
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

          {/*
            One form per row. Both actions read the same two hidden fields, and
            the vendor id is what tells them apart -- `matchToExistingVendor`
            refuses a submission without one rather than guessing which candidate
            was meant.
          */}
          <form style={styles.controls}>
            <input type="hidden" name="documentId" value={held.documentId} readOnly />
            <input type="hidden" name="extractedName" value={held.extractedName} readOnly />

            <button type="submit" formAction={confirmAction} style={styles.control}>
              Confirm as a new vendor
            </button>

            {view.suggestionsFor(held.extractedName).map((candidate) => (
              <button
                key={candidate.id}
                type="submit"
                name="vendorId"
                value={candidate.id}
                formAction={matchAction}
                style={styles.control}
              >
                This is {candidate.displayName}
              </button>
            ))}
          </form>
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
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-row)',
    marginTop: 'var(--space-base)',
  },
  // Records an action rather than urging one -- never a filled button, matching
  // the sign-out control on the dashboard.
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
  document: {
    fontSize: 'var(--type-scale-label)',
    letterSpacing: 'var(--type-tracking-label)',
    textTransform: 'uppercase',
    color: 'var(--color-ink-muted)',
  },
} satisfies Record<string, React.CSSProperties>
