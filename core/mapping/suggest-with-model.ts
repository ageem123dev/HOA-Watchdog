/**
 * Deterministic first, the model on the residue (story 5.6b, AC1/AC2/AC8).
 *
 * ## Why the composition lives in `core/`
 *
 * Because the merge decides what a valid pairing is, and that question already
 * has an owner here: `assign`. A merge written beside the adapter would be a
 * *third* set of rules about what may pair with what — after `assign` and
 * `suggestColumns` — and this project has watched that shape drift four times.
 * The model arrives as an injected `ResidueAsker`, so `core/` still imports
 * nothing outward.
 *
 * ## Falling back is the ordinary path
 *
 * Every way an asker can fail — throwing, rejecting, hanging up, answering
 * nonsense, answering about columns it was never asked about — returns the
 * deterministic suggestion *unchanged*. FR-10 requires the wizard to work when
 * the model does not, and epics.md puts it plainly: *"the model earns its place
 * on the residue, not on the whole job, and building it that way means the
 * wizard still works when the model is unreachable."*
 *
 * ## The deterministic answer always wins
 *
 * A model pairing never replaces one the matcher made and never takes a column
 * one already holds. `Amt` matched by an alias table is not a guess, and a guess
 * does not get to overrule it.
 */

import type { Heading } from '../extraction/headings'
import type { DocumentKind } from '../extraction/record'
import { residueOf, type Residue } from './residue'
import { suggestColumns, type Suggestion } from './suggest'
import { targetsForKind, type TargetField } from './targets'

/**
 * Whatever can answer questions about a residue.
 *
 * The port story 5.6b's Gemini adapter implements. It is deliberately the *only*
 * thing injected: headings and a kind in, pairings out. An asker needing a
 * store, a client or an association id would mean this seam is drawn wrong.
 */
export type ResidueAsker = (
  residue: Residue,
  kind: DocumentKind,
) => Promise<readonly Suggestion[]>

/**
 * Suggest columns for `headings`, asking `ask` about whatever is left over.
 *
 * Never rejects. The result is always at least as good as `suggestColumns` and
 * always the same shape as it.
 */
export const DEFAULT_ASK_TIMEOUT_MS = 15_000

export async function suggestWithModel(
  headings: readonly Heading[],
  kind: DocumentKind,
  ask?: ResidueAsker,
  timeoutMs: number = DEFAULT_ASK_TIMEOUT_MS,
): Promise<readonly Suggestion[]> {
  const deterministic = suggestColumns(headings, kind)

  if (ask === undefined) return deterministic

  const residue = residueOf(headings, kind)

  // Nothing unmatched means nothing to ask, and asking anyway would spend a
  // model call on every ordinary file (AC1).
  if (residue.unfilled.length === 0 || residue.headings.length === 0) return deterministic

  let answered: readonly Suggestion[]
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    // `await` inside the `try`: a rejected promise and a synchronous throw are
    // the same failure to a caller, and only one of them is caught by a bare
    // call outside it.
    // **A deadline of this function's own, not the adapter's.** Story 5.6b's
    // Gemini adapter bounds its own call, but `ResidueAsker` is a port and a
    // hanging promise is not a rejected one — nothing in a `try` catches it. An
    // asker that never settles would hold `readSample` open, and with it the
    // treasurer's upload. Longer than the adapter's own bound so that a normal
    // slow answer is still the adapter's to refuse, not this one's. Raised by
    // `ocr`.
    answered = await Promise.race([
      ask(residue, kind),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('ask timed out')), timeoutMs)
        // `unref` where the runtime has it, *and* cleared in `finally`: unref
        // alone stops a pending timer holding the process open, but the timer
        // still sits in the queue for the whole timeout after an answer that
        // arrived in milliseconds.
        ;(timer as unknown as { unref?: () => void }).unref?.()
      }),
    ])
  } catch {
    // Not inspected and not logged. The asker reaches a model over a network
    // holding a credential, and its errors are the ones most likely to carry
    // something that must not be kept.
    return deterministic
  } finally {
    // **Cleared however the race ends.** `unref` alone only stops a pending
    // timer holding the process open; it still sits in the queue for the whole
    // timeout after an answer that arrived in milliseconds. Raised by
    // CodeRabbit.
    if (timer !== undefined) clearTimeout(timer)
  }

  if (!Array.isArray(answered)) return deterministic

  return merge(deterministic, answered, residue, kind)
}

/**
 * Fold the model's answer into the deterministic one.
 *
 * **Guards independently of the adapter.** Story 5.6b's Gemini adapter refuses
 * a duplicate or an unoffered position before anything gets here, but
 * `ResidueAsker` is a port and that adapter is not the only implementation the
 * type admits. A guard that relies on one particular caller behaving is not a
 * guard.
 */
function merge(
  deterministic: readonly Suggestion[],
  answered: readonly Suggestion[],
  residue: Residue,
  kind: DocumentKind,
): readonly Suggestion[] {
  const { required, optional } = targetsForKind(kind)
  const offered = new Set(residue.headings.map((heading) => heading.position))
  const wanted = new Set<TargetField>(residue.unfilled)

  const found = new Map<TargetField, number>()
  const claimed = new Set<number>()

  // The deterministic pairings first, so they hold their columns against
  // anything the model proposes.
  for (const suggestion of deterministic) {
    if (suggestion.position === null) continue
    found.set(suggestion.target, suggestion.position)
    claimed.add(suggestion.position)
  }

  for (const entry of answered) {
    // **All or nothing, as the adapter does it.** This filtered before, and the
    // inconsistency was real: the adapter discards a contradictory reply whole
    // on the grounds that keeping the plausible half is how a wrong pairing
    // acquires the appearance of having been checked. The same argument applies
    // to a port that answers about a column it was never shown. Falling back
    // costs nothing — the deterministic answer is already in hand. Raised by
    // `ocr`.
    if (typeof entry !== 'object' || entry === null) return deterministic

    const { target, position } = entry

    if (typeof position !== 'number' || typeof target !== 'string') return deterministic
    // `wanted` alone: it is `residue.unfilled`, which is built from
    // `targetsForKind(kind).required`, so a target in it is published by
    // definition. A `published.has(target)` check stood beside this and survived
    // mutation — it could never fire, because nothing reaches it that `wanted`
    // has not already accepted.
    if (!wanted.has(target)) return deterministic
    // Only a column the asker was actually shown, and only one nobody holds.
    if (!offered.has(position) || claimed.has(position)) return deterministic
    if (found.has(target)) return deterministic

    found.set(target, position)
    claimed.add(position)
  }

  // Built exactly as `suggestColumns` builds it, so nothing downstream can tell
  // which half produced a pairing (AC8).
  return [
    ...required.map((target) => ({ target, position: found.get(target) ?? null })),
    ...optional.flatMap((target) => {
      const position = found.get(target)
      return position === undefined ? [] : [{ target, position }]
    }),
  ]
}
