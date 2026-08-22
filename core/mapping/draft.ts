/**
 * A mapping being built: which column of this file feeds which of the
 * importer's targets.
 *
 * ## The source side is a position, and that is the whole design
 *
 * Story 5.3 reports headings rather than refusing them, because a real export
 * duplicates a heading and leaves one blank. A mapping keyed on heading text
 * cannot express *which* of two `amount` columns was chosen, and cannot express
 * a column with no name at all. So a pairing names the 1-based position 5.3
 * reports, and the heading text is something the screen shows beside it.
 *
 * ## Reported, not enforced
 *
 * An incomplete draft is a valid draft. `completeness` answers what remains —
 * all of it at once — and refuses nothing, which is the same inversion story 5.3
 * made against `readRows`. A treasurer half way through building a mapping has
 * done nothing wrong, and a module that threw at them for it would be unusable.
 *
 * What *is* refused is an impossible pairing: a column the file does not have,
 * a target this kind does not have, or a column another target already holds.
 * Those are not states a mapping passes through on its way to being finished.
 *
 * ## Nothing here is stored
 *
 * No repository, no store, no persistence — story 5.7 is where a mapping is
 * remembered. These functions take a kind and a column count and nothing else,
 * so the day this needs a dependency, that is a diff someone sees.
 */

import type { DocumentKind } from '../extraction/record'
import { targetsForKind, type TargetField } from './targets'

export interface Pairing {
  readonly target: TargetField
  /** 1-based, the position story 5.3 reports. */
  readonly position: number
}

export interface DraftMapping {
  readonly kind: DocumentKind
  /** How many columns the sample has; a position outside it is not a column. */
  readonly columns: number
  readonly pairings: readonly Pairing[]
}

export type AssignResult =
  | { readonly ok: true; readonly draft: DraftMapping }
  | {
      readonly ok: false
      readonly reason: 'source-already-paired'
      /** The target that already holds this column — named, so the refusal is actionable. */
      readonly heldBy: TargetField
      readonly position: number
    }
  | { readonly ok: false; readonly reason: 'not-a-target'; readonly target: string }
  | { readonly ok: false; readonly reason: 'no-such-column'; readonly position: number }

export interface Completeness {
  readonly complete: boolean
  /** Every required target with no column yet — all of them, not the first. */
  readonly missing: readonly TargetField[]
}

export function emptyDraft(kind: DocumentKind, columns: number): DraftMapping {
  return { kind, columns, pairings: [] }
}

const offeredBy = (draft: DraftMapping): readonly string[] => {
  const { required, optional } = targetsForKind(draft.kind)
  return [...required, ...optional]
}

export function assign(draft: DraftMapping, target: TargetField, position: number): AssignResult {
  // Checked against `targetsForKind`, not against a second list. Task 1's whole
  // point is that there is one answer to "what can this kind be mapped to", and
  // a copy here would be the same drift one seam further along.
  if (!offeredBy(draft).includes(target)) return { ok: false, reason: 'not-a-target', target }

  if (!Number.isInteger(position) || position < 1 || position > draft.columns) {
    return { ok: false, reason: 'no-such-column', position }
  }

  // **Refused, never moved.** Silently re-pointing the column would change a
  // pairing the treasurer made earlier, at the top of a list they are no longer
  // looking at, with nothing to say it happened.
  const heldBy = draft.pairings.find(
    (pairing) => pairing.position === position && pairing.target !== target,
  )
  if (heldBy !== undefined) {
    return { ok: false, reason: 'source-already-paired', heldBy: heldBy.target, position }
  }

  // Re-pairing a target replaces its column rather than adding a second, and
  // frees whatever it held — otherwise that column is claimed by nobody and
  // pairable by nobody, with nothing on screen to explain it.
  const pairings = [...draft.pairings.filter((pairing) => pairing.target !== target), { target, position }]

  return { ok: true, draft: { ...draft, pairings } }
}

export function unassign(draft: DraftMapping, target: TargetField): DraftMapping {
  // A no-op for a target that holds nothing: a second key-press must not break
  // the screen.
  return { ...draft, pairings: draft.pairings.filter((pairing) => pairing.target !== target) }
}

export function completeness(draft: DraftMapping): Completeness {
  const paired = new Set(draft.pairings.map((pairing) => pairing.target))

  // Every one of them, not the first. A treasurer who fixes one omission and is
  // then shown the next has been made to do the work twice.
  const missing = targetsForKind(draft.kind).required.filter((target) => !paired.has(target))

  return { complete: missing.length === 0, missing }
}
