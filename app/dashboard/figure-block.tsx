/**
 * A figure, stated (UX-DR3).
 *
 * **Non-interactive, and that is the component's main job.** EXPERIENCE.md:
 * "A balance is a statement, not a link — clicking a figure must do nothing
 * rather than navigate somewhere unexpected on a screen about money." Making it
 * a component rather than a pair of paragraphs is what gives that rule
 * somewhere to live and something to be tested against.
 *
 * `asOf` is required rather than optional. The caller always knows whether the
 * documents behind the figure predate the current period —
 * `core/findings/dashboard-view.ts` works it out once for the whole page — and
 * an optional prop is one a second caller forgets, which puts an unqualified
 * figure on a fiduciary surface.
 */
export function FigureBlock({
  label,
  figure,
  asOf,
}: {
  label: string
  figure: string
  /** The day the underlying documents are current to, or `null` while they are. */
  asOf: string | null
}) {
  return (
    <div style={styles.block}>
      <p style={styles.label}>{label}</p>
      <p style={styles.figure}>{figure}</p>
      {asOf === null ? null : <p style={styles.asOf}>as of {asOf}</p>}
    </div>
  )
}

const styles = {
  block: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-base)',
  },
  // Sans small-caps above the figure, per DESIGN.md.
  label: {
    margin: 0,
    fontFamily: 'var(--type-sans)',
    fontSize: 'var(--type-scale-label)',
    letterSpacing: 'var(--type-tracking-label)',
    textTransform: 'uppercase',
    color: 'var(--color-ink-muted)',
  },
  // `tabular-nums` is not decoration: a column of figures whose digits differ
  // in width cannot be compared down the page, which is the only reason to
  // show them together.
  figure: {
    margin: 0,
    fontFamily: 'var(--type-serif)',
    fontSize: 'var(--type-scale-figure)',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--color-ink)',
  },
  asOf: {
    margin: 0,
    fontFamily: 'var(--type-sans)',
    fontSize: 'var(--type-scale-label)',
    color: 'var(--color-ink-muted)',
  },
} as const
