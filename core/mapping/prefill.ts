/**
 * A suggestion, applied to a draft — pre-filled, never decided (story 5.6, AC3).
 *
 * ## Through `assign`, and that is the whole design
 *
 * A suggested pairing is *the same kind of thing* as one the treasurer made. Not
 * similar — the same. So this folds `assign` over the suggestions rather than
 * writing `pairings` itself, and every one of story 5.4's rules applies
 * unchanged: a column already paired is refused rather than moved, re-pairing a
 * target replaces rather than duplicates, a target the kind does not publish is
 * rejected.
 *
 * Writing the pairings directly would be a second way to build a draft. It would
 * be correct on the day it was written and divergent the day 5.4's rules
 * changed, and this project has already found that shape twice —
 * `targetsForKind` versus a hand-written list, and `TARGET_LABELS` defined
 * twice. `prefill.test.ts` asserts the fold structurally as well as
 * behaviourally, because neither half alone is sufficient.
 *
 * ## Nothing is stored
 *
 * **Story 5.7 is where a mapping is remembered.** A pre-fill that persisted
 * anything would answer 5.7's idempotency question early and wrongly. There is
 * no seam here to write through, and the import scan says so.
 */

import type { Heading } from '../extraction/headings'
import type { DocumentKind } from '../extraction/record'
import { assign, emptyDraft, type DraftMapping } from './draft'
import type { Suggestion } from './suggest'

export interface PreFilled {
  /** The draft as the treasurer first sees it. Every pairing changeable. */
  readonly draft: DraftMapping
  /**
   * How many suggested pairings were actually made.
   *
   * Observable on purpose. Without it, a suggester that proposed nothing usable
   * looks exactly like one that was never asked — which is the distinction AC2
   * exists for, one layer up.
   */
  readonly applied: number
}

/**
 * Build a draft for `headings` of `kind`, with `suggestions` already paired.
 *
 * A suggestion `assign` refuses is skipped and the rest are kept: one odd column
 * must not cost the treasurer every other suggestion.
 */
export function draftFromSuggestion(
  headings: readonly Heading[],
  kind: DocumentKind,
  suggestions: readonly Suggestion[],
): PreFilled {
  // Sized from the sample, never from the suggestion. A draft sized by what was
  // recognised would give a file nobody recognised zero columns, and then
  // nothing could be paired into it by hand either.
  let draft = emptyDraft(kind, headings.length)
  let applied = 0

  for (const suggestion of suggestions) {
    // `null` is "considered, nothing found" — not a column number. Passed
    // through it would be `no-such-column` at best and column 0 at worst.
    if (suggestion.position === null) continue

    const result = assign(draft, suggestion.target, suggestion.position)
    if (!result.ok) continue

    draft = result.draft
    applied += 1
  }

  return { draft, applied }
}
