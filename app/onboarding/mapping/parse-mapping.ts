import { assign, emptyDraft, type DraftMapping } from '@/core/mapping/draft'
import type { DocumentKind } from '@/core/extraction/record'
import type { TargetField } from '@/core/mapping/targets'

/**
 * A submitted list of pairings into a mapping, or nothing (story 5.7).
 *
 * ## Why both actions come through here
 *
 * `saveMapping` and `changeMapping` both store a mapping, and they were written
 * separately: one built the draft server-side by folding through `assign`, the
 * other accepted a whole `DraftMapping` object from the form and checked its
 * *shape*. Argus found what that difference bought — a form could declare
 * `documentKind: deposit`, so the shape was derived for a deposit, and send a
 * mapping whose own `kind` was `invoice`. It would be stored under the deposit
 * shape and applied to every later deposit export, pairing that file's columns
 * to an invoice's fields. Nothing would throw, and every value would still be a
 * plausible value in the wrong field.
 *
 * The fix is not a check that the two kinds match. It is that **the client never
 * sends a kind or a column count at all**: both are derived here from the
 * request's own context, and only the pairings come from the form. A rule that
 * cannot be violated beats one that is verified.
 *
 * ## `assign` decides, not this
 *
 * Whether a target belongs to a kind, whether a column exists, whether a source
 * is already paired — `core/mapping/draft.ts` owns all three. This folds and
 * reports; a second answer to any of them here is the duplicated-rule defect
 * this project has found six times.
 *
 * ## All or nothing
 *
 * One rejected pairing rejects the submission. A partially applied mapping is
 * the failure that looks like success: the treasurer is told it saved, one
 * column they set is quietly absent, and it surfaces weeks later as a column of
 * empty amounts.
 */
export function draftFromPairings(
  kind: DocumentKind,
  columns: number,
  pairings: unknown,
): DraftMapping | null {
  if (!Array.isArray(pairings)) return null

  /**
   * An empty list is not a mapping.
   *
   * `assign` never sees it, so nothing downstream refuses it - and a stored
   * mapping with no pairings is worse than no mapping at all: `applyMapping`
   * emits an empty header row, so every later upload of that shape fails with
   * `missing-headers` *and* finds a saved mapping, which is the state the wizard
   * exists to get the treasurer out of. Raised by CodeRabbit.
   */
  if (pairings.length === 0) return null

  let draft = emptyDraft(kind, columns)

  for (const pairing of pairings) {
    if (typeof pairing !== 'object' || pairing === null) return null

    const { target, position } = pairing as { target?: unknown; position?: unknown }
    if (typeof target !== 'string' || typeof position !== 'number') return null

    // `assign` refuses a non-integer, an out-of-range column and an unknown
    // target, so `NaN` and a fractional position are refused there rather than
    // re-checked here.
    const result = assign(draft, target as TargetField, position)
    if (!result.ok) return null

    draft = result.draft
  }

  return draft
}

/**
 * `JSON.parse` that answers `null` rather than throwing at a form field.
 *
 * Shared by both actions. It existed verbatim in each, and two copies of a
 * transport rule is how one entry point ends up stricter than the other -
 * the defect this project has spent six review rounds on, in miniature.
 * Raised by CodeRabbit.
 */
export function parseJson(value: FormDataEntryValue | null): unknown {
  if (typeof value !== 'string') return null

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
