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
      /**
       * The header row plus a bounded slice of data rows - story 5.5, so the
       * preview can parse the treasurer's own rows without asking for the file
       * again. Bounded because this is serialised to the client.
       */
      readonly rows: readonly (readonly string[])[]
      /** Data rows the file holds - UX-DR24's "of 143". */
      readonly totalDataRows: number
    }
  | { readonly status: 'error'; readonly error: string }

export const EMPTY_SAMPLE_STATE: SampleState = { status: 'idle' }
