import type { ReimportOutcome } from '@/core/mapping/reimport'

/**
 * What changing a mapping would cost, and then what it did (story 5.7, AC6).
 *
 * Kept out of the action modules because a `'use server'` module may export only
 * async functions — the same reason `sample-state.ts` exists.
 */

/**
 * The answer to "what would this change do", before anything is written.
 *
 * `nothing-to-change` is not an error and must not be rendered as one: it is the
 * ordinary answer for a shape nobody has mapped yet, and it is what tells the
 * wizard to use the plain save instead of the change.
 */
export type PreviewState =
  | { readonly status: 'idle' }
  | { readonly status: 'nothing-to-change' }
  | {
      readonly status: 'would-replace'
      /** Documents that would be re-read. The number AC6 puts in front of the treasurer. */
      readonly affected: number
      /**
       * Held, but unreachable or unparseable. Counted separately rather than
       * folded into `affected`, because a treasurer told only "3 will be
       * re-read" would never learn a fourth is beyond reach — and this is the
       * moment they are deciding, so it is the moment the fact is worth
       * something. Silence here reads as zero.
       */
      readonly unreadable: number
    }
  | { readonly status: 'error'; readonly error: string }

export const EMPTY_PREVIEW_STATE: PreviewState = { status: 'idle' }

/** What the change did, per document. AC7 refuses a single summarised "done". */
export type ChangeState =
  | { readonly status: 'idle' }
  | { readonly status: 'changed'; readonly documents: readonly ReimportOutcome[] }
  | { readonly status: 'error'; readonly error: string }

export const EMPTY_CHANGE_STATE: ChangeState = { status: 'idle' }
