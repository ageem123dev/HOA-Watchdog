import type { DocumentKind } from '@/core/extraction/record'
import type { Heading, HeadingProblem } from '@/core/extraction/headings'
import type { Suggestion } from '@/core/mapping/suggest'

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
      /**
       * What to pre-fill the mapping with - story 5.6b.
       *
       * **Computed here rather than on the client**, because the model-backed
       * half needs a credential that exists only on the server. Story 5.6
       * passed a `ColumnSuggester` to `ColumnPairing` and let it call one during
       * render; that port is synchronous and this is not, so the seam moved.
       *
       * `undefined` means **nobody was asked**; an array whose positions are all
       * `null` means asked and nothing found. Story 5.6's AC7 rests on the
       * difference and the surface still says which.
       */
      readonly suggestions?: readonly Suggestion[]
    }
  | { readonly status: 'error'; readonly error: string }

export const EMPTY_SAMPLE_STATE: SampleState = { status: 'idle' }

/**
 * What confirming a mapping produced (story 5.7, AC3 and AC6).
 *
 * `replaced` is the distinction the whole second half of the story turns on. A
 * first mapping is stored and that is the end of it; a *changed* mapping means
 * documents already imported under the old one now read differently, and the
 * treasurer has to be told before it happens. Collapsing the two into one
 * `saved` would make the warning impossible to render.
 */
export type SaveState =
  | { readonly status: 'idle' }
  | { readonly status: 'saved' }
  /**
   * A mapping was replaced, so documents already imported under the old one now
   * read differently.
   *
   * It carries no count. Working out how many documents are affected means
   * reading their bytes back from object storage, and `actions.ts` may not reach
   * it - that prohibition is what keeps the sample path away from the permanent
   * record. The number AC6 puts in front of the treasurer comes from
   * `previewReimport`, asked for by the module that owns the re-import.
   */
  | { readonly status: 'replaced' }
  | { readonly status: 'error'; readonly error: string }

export const EMPTY_SAVE_STATE: SaveState = { status: 'idle' }
