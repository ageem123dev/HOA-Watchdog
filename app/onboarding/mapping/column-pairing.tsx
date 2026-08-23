'use client'

import { useCallback, useState } from 'react'

import type { DocumentKind } from '@/core/extraction/record'
import type { Heading, HeadingProblem } from '@/core/extraction/headings'
import { assign, completeness, unassign, type DraftMapping } from '@/core/mapping/draft'
import { draftFromSuggestion } from '@/core/mapping/prefill'
import type { Suggestion } from '@/core/mapping/suggest'
import { targetsForKind, type TargetField } from '@/core/mapping/targets'
import { TARGET_LABELS } from './target-labels'
import { MappingPreview } from './mapping-preview'

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
  /**
   * What story 5.3 found wrong with the header row — reported here, never a
   * refusal. A file with two `amount` columns is still a file worth mapping.
   */
  readonly problems?: readonly HeadingProblem[]
  /**
   * The sample's rows, bounded - story 5.5. Absent until a sample has been
   * read, and the preview simply does not render without them.
   */
  readonly rows?: readonly (readonly string[])[]
  /** Data rows the file holds, for the count UX-DR24 requires. */
  readonly totalDataRows?: number
  /**
   * What to pre-fill the mapping with — story 5.6, computed server-side by 5.6b.
   *
   * **A suggestion, not a suggester.** Story 5.6 took a `ColumnSuggester` and
   * called it during render. Story 5.6b's model-backed half is async and needs a
   * credential that exists only on the server, so `readSample` now computes this
   * and `SampleState` carries it here.
   *
   * That also retires the referential-stability contract this prop used to
   * carry: an array has no identity to compare, so there is no "must be a module
   * constant" rule and no reset keyed on a function's identity. Raised on MR !83
   * as a footgun 5.6b would arm; 5.6b removed the gun instead.
   *
   * `undefined` means **nobody was asked**; an array whose positions are all
   * `null` means asked and nothing found. AC7 rests on that difference.
   */
  readonly suggestions?: readonly Suggestion[]
}

/**
 * The format the drag payload travels under.
 *
 * A custom type rather than `text/plain`, so a stray drop of selected text from
 * anywhere else on the page carries nothing this reads.
 */
export const DRAG_FORMAT = 'application/x-column-position'

/**
 * `A`, `A and B`, `A, B and C` — the reading a treasurer expects.
 *
 * Joining with ` and ` alone produced "Column 3 and Column 5 has no heading",
 * which the single-blank fixture never showed. Raised by CodeRabbit.
 */
const columnList = (
  positions: readonly number[],
  label: (position: number) => string = (position) => `Column ${position}`,
): string => {
  const parts = positions.map(label)

  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** A column with no heading is identified by the only thing it has. */
export const columnLabel = (heading: Heading): string =>
  heading.text.trim() === ''
    ? `Column ${heading.position} — no heading`
    : `Column ${heading.position} — ${heading.text}`

/**
 * The draft a suggestion pre-fills.
 *
 * One function called from both the initialiser and the new-sample reset, so the
 * two cannot drift. That drift is the whole risk: the reset path is the one
 * nobody demonstrates, and a pre-fill living only in the initialiser is silently
 * absent from the second sample onward.
 */
const preFill = (
  kind: DocumentKind,
  headings: readonly Heading[],
  suggestions: readonly Suggestion[] | undefined,
): { draft: DraftMapping; suggestions: readonly Suggestion[]; applied: number } => {
  // No suggestions at all is not an empty guess — a different thing the screen
  // has to be able to say (AC7).
  const offered = suggestions ?? []
  const { draft, applied } = draftFromSuggestion(headings, kind, offered)

  return { draft, suggestions: offered, applied }
}

export function ColumnPairing({
  kind,
  headings,
  problems = [],
  rows,
  totalDataRows,
  suggestions,
}: ColumnPairingProps) {
  const [initial] = useState(() => preFill(kind, headings, suggestions))
  const [draft, setDraft] = useState<DraftMapping>(initial.draft)
  const [suggested, setSuggested] = useState<readonly Suggestion[]>(initial.suggestions)
  const [appliedCount, setAppliedCount] = useState(initial.applied)
  const [selected, setSelected] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)

  /**
   * **A mapping must not outlive the file it was built against.**
   *
   * The wizard leaves its form on screen after a read, so a treasurer can submit
   * a second sample — a different kind, a different set of columns. `useState`'s
   * initialiser runs once, so without this the old draft survives: pairings
   * pointing at positions that now mean different columns, and a bound belonging
   * to the previous file. Silent, and wrong in the worst direction, because the
   * mapping still looks finished.
   *
   * Reset during render rather than in an effect — React's documented way to
   * adjust state when props change, and it avoids rendering one frame of the
   * stale mapping. Kept here rather than as a `key` in the caller so the
   * component is correct however it is mounted. Raised by CodeRabbit.
   */
  // `JSON.stringify` rather than a delimiter of our own: it is unambiguous
  // whatever a heading contains, and - the reason it is worth a comment - it
  // is printable. The first version separated the parts with U+0000/U+0001/
  // U+0002, written through a shell heredoc that turned the escapes into the
  // bytes themselves. Git then classed this file as binary and ESLint could
  // not read it, while every test stayed green, because a NUL is a perfectly
  // valid character in a template literal. Found by Argus.
  // **The suggestion is part of what the draft was built from**, so it belongs in
  // the key, by value. Comparing the array by *identity* would re-impose the
  // contract MR !83 flagged and story 5.6b set out to remove — `suggestColumns`
  // returns a fresh array per call, so any caller computing it inline would
  // reset the draft on every render and silently discard the treasurer's
  // overrides. Story 5.4 already chose value comparison here, for its stated
  // reason: the component is correct however it is mounted.
  const sample = JSON.stringify([
    kind,
    headings.map((h) => [h.position, h.text]),
    suggestions ?? null,
  ])
  const [renderedSample, setRenderedSample] = useState(sample)


  if (renderedSample !== sample) {
    // **Re-suggested, not merely emptied.** Story 5.6: a pre-fill that only ran
    // in the initialiser would leave the second sample blank with nothing to
    // explain it — correct on the path anyone demonstrates, missing on the one
    // they do not, which is exactly the shape story 5.2 shipped.
    const fresh = preFill(kind, headings, suggestions)

    setRenderedSample(sample)
    setDraft(fresh.draft)
    setSuggested(fresh.suggestions)
    setAppliedCount(fresh.applied)
    setSelected(null)
    setRefusal(null)
    setAnnouncement('')
  }

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
      // The completion notice rides on the same announcement rather than a
      // second live region — nesting one inside another is how a message gets
      // read twice or not at all. Without it, a screen-reader user pairing the
      // last field hears only that the field was paired, never that the mapping
      // is now finished; the "every required field" line is static text.
      const paired = `${TARGET_LABELS[target]} now reads ${heading ? columnLabel(heading) : `column ${position}`}.`
      const remaining = completeness(result.draft)

      setAnnouncement(
        remaining.complete ? `${paired} Every required field now has a column.` : paired,
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

  /**
   * The drag accelerator, and the whole of it.
   *
   * It reads a position off the event and calls `pair`. It sets no state of its
   * own — that is what keeps it an accelerator rather than a second
   * implementation, and it is why `drag.test.tsx` builds the same mapping both
   * ways and compares the surface rather than reading this file.
   *
   * The position travels on the `DataTransfer`, not the heading text: columns 2
   * and 4 of a real export are both `amount`, and text would pair whichever a
   * lookup found first.
   */
  const onDropInto = useCallback(
    (target: TargetField) => (event: React.DragEvent) => {
      event.preventDefault()

      const position = Number(event.dataTransfer.getData(DRAG_FORMAT))

      // A drop from somewhere else entirely carries nothing usable. Unguarded,
      // `Number('')` is 0 and `Number('x')` is NaN, and the field would read
      // "column NaN" with nothing refusing it.
      if (!Number.isInteger(position) || position < 1) return

      pair(target, position)
    },
    [pair],
  )

  const positionFor = (target: TargetField) =>
    draft.pairings.find((pairing) => pairing.target === target)?.position

  const targetHolding = (position: number) =>
    draft.pairings.find((pairing) => pairing.position === position)?.target

  /**
   * What the suggestion said about `target`, if it said anything.
   *
   * `undefined` — never mentioned — and `null` — considered, nothing found — are
   * different answers, and AC2 exists for exactly that difference.
   */
  const suggestionFor = (target: TargetField): number | null | undefined =>
    suggested.find((suggestion) => suggestion.target === target)?.position

  /**
   * **Derived from the current pairing, never from history.**
   *
   * The moment a treasurer moves or clears a suggested column, this stops being
   * true and the marker goes. A screen that kept crediting the suggestion would
   * be saying the machine chose what the human chose — against AC8, which is the
   * point of the whole story.
   */
  const isStillTheSuggestion = (target: TargetField, position: number | undefined) =>
    position !== undefined && suggestionFor(target) === position

  /**
   * The sentence under the heading, and it is deliberately three sentences
   * rather than one conditional.
   *
   * Never asked, asked and found nothing, and asked and found some are three
   * situations. Collapsing the first two would leave a treasurer unable to tell
   * whether the tool looked at their file and gave up, or was never running —
   * which is what they need to decide how much to trust it.
   */
  const suggestionSummary =
    suggestions === undefined
      ? 'Nothing was suggested for this file. Pair each column yourself below.'
      : appliedCount === 0
        ? 'We could not suggest a column for any of these fields. Pair them yourself below.'
        : `We suggested ${appliedCount} ${appliedCount === 1 ? 'column' : 'columns'} for you. Check each one before you continue — you can change any of them.`

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

      {/*
        Static text, **not** a second live region. Story 5.4: "the only live
        region on this screen — nesting one inside another is how an
        announcement gets read twice or not at all." It is also not announced on
        mount: a live region firing as the screen appears is read over whatever
        the user was doing.
      */}
      <p data-testid="suggestion-summary" style={styles.suggestionSummary}>
        {suggestionSummary}
      </p>

      {problems.length > 0 && (
        <section data-testid="heading-problems" aria-labelledby="heading-problems-title">
          <h2 id="heading-problems-title" style={styles.paneHeading}>
            Worth knowing about your headings
          </h2>
          <ul style={styles.list}>
            {problems.map((problem) => (
              <li key={`${problem.reason}-${problem.positions.join('-')}`} style={styles.item}>
                {problem.reason === 'duplicate-heading'
                  ? /*
                      **Named as the treasurer wrote them, not as the importer
                      folds them.** The problem carries the normalised heading
                      because that is what collides; the written forms are in the
                      headings. Reporting only `amount` sends someone looking for
                      a column their spreadsheet has not got.
                    */
                    `${columnList(
                      problem.positions,
                      (position) => {
                        const heading = headingAt(position)
                        return heading === undefined
                          ? `Column ${position}`
                          : `Column ${position} (${heading.text.trim()})`
                      },
                    )} are the same column name to the importer. Map whichever you mean.`
                  : `${columnList(problem.positions)} ${
                      problem.positions.length === 1 ? 'has' : 'have'
                    } no heading. You can still map ${
                      problem.positions.length === 1 ? 'it' : 'them'
                    } by position.`}
              </li>
            ))}
          </ul>
        </section>
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
                    // The accelerator. Selecting and activating still works
                    // exactly as it did; this adds a second way in, over the
                    // same operation, rather than a second mechanism.
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(DRAG_FORMAT, String(heading.position))
                      event.dataTransfer.effectAllowed = 'move'
                    }}
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
                    // **`aria-disabled`, never `disabled`.** A disabled button
                    // receives no drag events in any real browser, so the
                    // accelerator would be dead there while passing here — jsdom
                    // dispatches to disabled elements regardless. It is also out
                    // of the tab order, which meant a treasurer could not tab to
                    // these fields to discover what the importer needs until
                    // they had already selected a column. The `onClick` below is
                    // what actually refuses; this only says so.
                    aria-disabled={selected === null}
                    // Without `preventDefault` on drag-over the browser never
                    // fires a drop at all: passing in jsdom, dead in a browser.
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={onDropInto(target)}
                    onClick={() => selected !== null && pair(target, selected)}
                    style={styles.control}
                  >
                    {TARGET_LABELS[target]}
                    {isRequired ? ' — required' : ' — optional'}
                    {heading === undefined
                      ? ' — no column yet'
                      : ` — reads ${columnLabel(heading)}`}
                    {/*
                      **In the accessible name, not in a tint.** Story 5.4 made
                      this call for selection state and it holds here: a marker
                      only sighted users can see is not a marker for the
                      treasurer this project keeps in mind.

                      "No suggestion" is said only for a field still empty and
                      only when a suggestion was made at all — a field the
                      treasurer has since filled does not need telling that
                      nobody guessed it, and with no suggestion at all the sentence
                      above already covers the whole screen.
                    */}
                    {isStillTheSuggestion(target, position) && ' — suggested'}
                    {suggestions !== undefined &&
                      position === undefined &&
                      suggestionFor(target) === null &&
                      ' — no suggestion'}
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

      {rows !== undefined && (
        <MappingPreview
          draft={draft}
          rows={rows}
          // Defaulting to 0 let the preview say it had read more rows than the
          // file holds. Absent, the rows in hand are the best count there is.
          totalDataRows={totalDataRows ?? Math.max(rows.length - 1, 0)}
        />
      )}

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
  suggestionSummary: { margin: 0, color: 'var(--color-ink-muted)' },
  remaining: { margin: 0 },
} satisfies Record<string, React.CSSProperties>
