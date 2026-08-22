import type { DocumentKind } from '@/core/extraction/record'
import type { Heading, HeadingProblem } from '@/core/extraction/headings'

/**
 * What the mapping step holds between submissions.
 *
 * Kept out of `actions.ts` because a `'use server'` module may export only async
 * functions, so a shared type and constant have to live beside it. Same reason
 * `app/upload/upload-state.ts` exists.
 *
 * **The kind travels with the headings.** It is the treasurer's declaration of
 * which import they are setting up, not the file's declaration of what it is —
 * `readSampleHeadings` still takes no kind, exactly as story 5.3 built it. But
 * the mapping is keyed on kind, because `targetsForKind` cannot offer a target
 * list without one, so the step that reads a sample is where it is asked for.
 */
export type SampleState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'read'
      readonly kind: DocumentKind
      readonly headings: readonly Heading[]
      readonly problems: readonly HeadingProblem[]
    }
  | { readonly status: 'error'; readonly error: string }

export const EMPTY_SAMPLE_STATE: SampleState = { status: 'idle' }
