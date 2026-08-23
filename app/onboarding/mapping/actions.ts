'use server'

import { auth } from '@/adapters/auth/auth'
import { readWorkbook } from '@/adapters/extraction/workbook-sheetjs'
import { MAX_DOCUMENT_BYTES } from '@/core/ingestion/acceptance'
import { isDocumentKind } from '@/core/extraction/record'
import { readSampleHeadings } from '@/core/extraction/sample-headings'
import { suggestWithModel } from '@/core/mapping/suggest-with-model'
import { askModelForColumns } from '@/adapters/extraction/suggester-gemini'
import type { SampleState } from './sample-state'

/**
 * A sample in, its column headings out.
 *
 * ## Nothing here stores anything, and that is checked structurally
 *
 * There is no document repository, no object store and no `ingest` in this
 * module's imports, and `actions.test.ts` reads the file to say so. A
 * behavioural test cannot prove the absence of a write it never triggered —
 * story 5.3 made the same argument for the shared folding, after a check that
 * asserted the nearest observable thing passed against a decorative import.
 *
 * The reason is story 5.3's, unchanged: a sample is uploaded so a treasurer can
 * be shown their own column names. It is not a document the association is
 * keeping, and one landing in `document` would sit in the permanent record and
 * count against the register a board reads.
 *
 * ## The kind is the treasurer's, not the file's
 *
 * `readSampleHeadings` takes no kind and still does not. The form asks which
 * import is being set up because `targetsForKind` cannot offer targets without
 * knowing, and the answer is carried forward with the headings.
 */
const workbookDecoder = { decode: readWorkbook }

/** One sample, so the whole-submission limits do not apply — this is the per-document one. */
const MAX_SAMPLE_BYTES = MAX_DOCUMENT_BYTES

export async function readSample(
  _previous: SampleState,
  formData: FormData,
): Promise<SampleState> {
  const session = await auth()
  const reader = session?.user?.id

  // A server action is its own entry point, reachable without the page ever
  // rendering, so the route's protection guards nothing here. Without this the
  // action is a public file parser.
  if (typeof reader !== 'string' || reader.trim() === '') {
    return { status: 'error', error: 'Your session has expired. Sign in again to continue.' }
  }

  const declaredKind = formData.get('documentKind')

  // Refused rather than defaulted, for story 5.2's reason: a default would let
  // the submission decide by omission which import is being configured.
  if (!isDocumentKind(declaredKind)) {
    return { status: 'error', error: 'Choose which kind of import you are setting up.' }
  }

  const chosen = formData.get('sample')

  if (!(chosen instanceof File) || (chosen.size === 0 && chosen.name === '')) {
    return { status: 'error', error: 'Choose a sample file to read.' }
  }

  // Checked against the declared size, before a byte is read. Reading first
  // would hold the whole file in memory to decide it was too big to hold.
  if (chosen.size > MAX_SAMPLE_BYTES) {
    return {
      status: 'error',
      error: `Samples are up to ${MAX_SAMPLE_BYTES / (1024 * 1024)} MB. A few rows is plenty — only the headings and the first few rows are read.`,
    }
  }

  const result = readSampleHeadings(
    {
      filename: chosen.name,
      contentType: chosen.type,
      bytes: new Uint8Array(await chosen.arrayBuffer()),
    },
    { workbooks: workbookDecoder },
  )

  if (!result.ok) return { status: 'error', error: REFUSALS[result.reason] }

  return {
    status: 'read',
    kind: declaredKind,
    headings: result.headings,
    problems: result.problems,
    rows: result.rows,
    totalDataRows: result.totalDataRows,
    // Deterministic first; the model only on what is left over, and only
    // when it is configured. `suggestWithModel` never rejects, so this
    // cannot turn a readable sample into a refusal.
    suggestions: await suggestWithModel(result.headings, declaredKind, askModelForColumns),
  }
}

/**
 * Four reasons, four sentences.
 *
 * Story 5.3 kept `empty-file` apart from `unreadable-file` because *"your file
 * is empty"* and *"your file could not be read"* send a treasurer to different
 * places — and the second is actively misleading about the first, inviting them
 * to re-export a file that exported perfectly well. Collapsing them here would
 * throw that away at the last step.
 */
const REFUSALS: Record<'no-reader' | 'unreadable-file' | 'no-rows' | 'no-headings', string> = {
  'no-reader': 'That file type cannot be read. Export the sample as CSV or as a spreadsheet.',
  'unreadable-file': 'That file could not be read. It may be damaged, or saved in another format.',
  'no-rows': 'That file is empty. Export it again with at least the heading row and one row of data.',
  'no-headings': 'That file has a first row, but every heading in it is blank. Add the column names.',
}
