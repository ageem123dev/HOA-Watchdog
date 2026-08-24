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
  /**
   * The mapping changed and the documents were re-imported, but the record of
   * it was not written.
   *
   * A distinct state rather than an error, because reporting this as a failure
   * would be a lie in the direction that matters: the treasurer's documents
   * *were* re-parsed, and telling them it failed invites them to do it again.
   * It is not `changed` either - AC6 asks for a durable record, and there is
   * none, so somebody has to know.
   *
   * There is no transaction that could have prevented it. The change spans
   * object storage and many rows across two tables, and migration 027 revokes
   * UPDATE so the record cannot be written first and corrected after. Naming
   * the gap is the honest option. Raised by ocr.
   */
  | { readonly status: 'changed-unrecorded'; readonly documents: readonly ReimportOutcome[] }
  | { readonly status: 'error'; readonly error: string }

export const EMPTY_CHANGE_STATE: ChangeState = { status: 'idle' }
