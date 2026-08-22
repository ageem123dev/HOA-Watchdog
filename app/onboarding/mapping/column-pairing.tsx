'use client'

import { useCallback, useState } from 'react'

import type { DocumentKind } from '@/core/extraction/record'
import type { Heading } from '@/core/extraction/headings'
import { assign, completeness, emptyDraft, unassign, type DraftMapping } from '@/core/mapping/draft'
import { targetsForKind, type TargetField } from '@/core/mapping/targets'

/**
 * Pairing a file's columns with the importer's.
 *
 * ## The keyboard is the mechanism, not a pass over a drag surface
 *
 * epics.md is explicit that this is the story where that is decided: *"keyboard
 * operation has to be designed in at 5.4, not retrofitted after the interaction
 * feels right with a mouse. The cheapest correct answer is usually a selectable
 * list pairing, with dragging as an accelerator over it rather than the
 * mechanism."*
 *
 * So the interaction is: choose a column, then choose the target it feeds. Every
 * control that changes the mapping is a native `<button>` — which means the
 * platform operates it by keyboard, with no `onKeyDown` of our own to drift out
 * of step with the pointer path. Story 5.4's drag accelerator calls `pair`, the
 * same function these buttons call.
 *
 * ## Nothing here decides what a valid pairing is
 *
 * `assign`, `unassign` and `completeness` do, in `core/mapping/draft.ts`. This
 * component renders their answers. A copy of the rules here would be the same
 * drift `targetsForKind` exists to prevent, one layer further out.
 */

export interface ColumnPairingProps {
  readonly kind: DocumentKind
  readonly headings: readonly Heading[]
}

/** What a treasurer calls each of the importer's columns. */
const TARGET_LABELS: Readonly<Record<TargetField, string>> = {
  date: 'Date',
  description: 'Description',
  amount: 'Amount',
  reference: 'Reference',
  unit: 'Unit',
  cycle: 'Billing cycle',
  year: 'Year',
}

/** A column with no heading is identified by the only thing it has. */
export const columnLabel = (heading: Heading): string =>
  heading.text.trim() === ''
    ? `Column ${heading.position} — no heading`
    : `Column ${heading.position} — ${heading.text}`

export function ColumnPairing({ kind, headings }: ColumnPairingProps) {
  const [draft, setDraft] = useState<DraftMapping>(() => emptyDraft(kind, headings.length))
  const [selected, setSelected] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)

  const { required, optional } = targetsForKind(kind)
  const { missing } = completeness(draft)

  const headingAt = useCallback(
    (position: number) => headings.find((heading) => heading.position === position),
    [headings],
  )

  /**
   * The one pairing operation.
   *
   * Both the keyboard path above and the drag accelerator call this and nothing
   * else. A drag handler that set state itself is how the two paths come to
   * disagree — and the one that disagrees silently is the keyboard one, because
   * nobody demos it.
   */
  const pair = useCallback(
    (target: TargetField, position: number) => {
      const result = assign(draft, target, position)

      if (!result.ok) {
        setRefusal(
          result.reason === 'source-already-paired'
            ? `Column ${result.position} already feeds ${TARGET_LABELS[result.heldBy]}. Unpair it first.`
            : 'That column cannot feed that field.',
        )
        return
      }

      const heading = headingAt(position)

      setDraft(result.draft)
      // Cleared, or the next activation pairs a column the treasurer thought
      // they had finished with.
      setSelected(null)
      setRefusal(null)
      setAnnouncement(
        `${TARGET_LABELS[target]} now reads ${heading ? columnLabel(heading) : `column ${position}`}.`,
      )
    },
    [draft, headingAt],
  )

  const unpair = useCallback(
    (target: TargetField) => {
      setDraft(unassign(draft, target))
      setRefusal(null)
      setAnnouncement(`${TARGET_LABELS[target]} reads no column now.`)
    },
    [draft],
  )

  const positionFor = (target: TargetField) =>
    draft.pairings.find((pairing) => pairing.target === target)?.position

  const targetHolding = (position: number) =>
    draft.pairings.find((pairing) => pairing.position === position)?.target

  return (
    <div style={styles.surface}>
      {/*
        Polite, and the only live region on this screen — nesting one inside
        another is how an announcement gets read twice or not at all.
      */}
      <p role="status" aria-live="polite" style={styles.announcement}>
        {announcement}
      </p>

      {refusal !== null && (
        <p role="alert" style={styles.refusal}>
          {refusal}
        </p>
      )}

      <div style={styles.columns}>
        <section aria-labelledby="your-columns" style={styles.pane}>
          <h2 id="your-columns" style={styles.paneHeading}>
            Your columns
          </h2>
          <ul style={styles.list}>
            {headings.map((heading) => {
              const holder = targetHolding(heading.position)
              const isSelected = selected === heading.position

              return (
                <li key={heading.position} style={styles.item}>
                  <button
                    type="button"
                    // Selection state carried in the accessible name and in
                    // `aria-pressed`, never by tint alone.
                    aria-pressed={isSelected}
                    onClick={() => {
                      setRefusal(null)
                      setSelected(isSelected ? null : heading.position)
                    }}
                    style={{ ...styles.control, ...(isSelected ? styles.controlSelected : {}) }}
                  >
                    {columnLabel(heading)}
                    {holder !== undefined && ` — feeds ${TARGET_LABELS[holder]}`}
                    {isSelected && ' — selected'}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>

        <section aria-labelledby="our-fields" style={styles.pane}>
          <h2 id="our-fields" style={styles.paneHeading}>
            What the importer needs
          </h2>
          <ul style={styles.list}>
            {[...required, ...optional].map((target) => {
              const position = positionFor(target)
              const heading = position === undefined ? undefined : headingAt(position)
              const isRequired = required.includes(target)

              return (
                <li key={target} style={styles.item}>
                  <button
                    type="button"
                    disabled={selected === null}
                    onClick={() => selected !== null && pair(target, selected)}
                    style={styles.control}
                  >
                    {TARGET_LABELS[target]}
                    {isRequired ? ' — required' : ' — optional'}
                    {heading === undefined
                      ? ' — no column yet'
                      : ` — reads ${columnLabel(heading)}`}
                  </button>
                  {position !== undefined && (
                    <button type="button" onClick={() => unpair(target)} style={styles.control}>
                      Unpair {TARGET_LABELS[target]}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      {/*
        Every one of them, named. A count would repeat the defect `completeness`
        was written to avoid: a treasurer who fixes one omission and is then
        shown the next has been made to do the work twice.
      */}
      <p style={styles.remaining}>
        {missing.length === 0
          ? 'Every required field has a column.'
          : `Still needed: ${missing.map((target) => TARGET_LABELS[target]).join(', ')}.`}
      </p>
    </div>
  )
}

const styles = {
  surface: { display: 'flex', flexDirection: 'column', gap: 'var(--space-block)' },
  announcement: { margin: 0, color: 'var(--color-ink-muted)' },
  refusal: { margin: 0 },
  // Wraps below 48rem rather than scrolling sideways (UX-DR21).
  columns: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-block)' },
  pane: { flex: '1 1 20rem', minWidth: 0 },
  paneHeading: { fontSize: 'var(--type-scale-label)', margin: 0 },
  list: { listStyle: 'none', margin: 0, padding: 0 },
  // No fixed height: rows flex for user text spacing (WCAG 1.4.12).
  item: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-inline)', padding: '0.25rem 0' },
  control: { minHeight: '2.75rem', minWidth: '2.75rem', textAlign: 'left' },
  controlSelected: { fontWeight: 600 },
  remaining: { margin: 0 },
} satisfies Record<string, React.CSSProperties>
