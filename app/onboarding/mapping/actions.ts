'use server'

import { auth } from '@/adapters/auth/auth'
import { readWorkbook } from '@/adapters/extraction/workbook-sheetjs'
import { MAX_DOCUMENT_BYTES } from '@/core/ingestion/acceptance'
import { isDocumentKind } from '@/core/extraction/record'
import { readSampleHeadings } from '@/core/extraction/sample-headings'
import { suggestWithModel } from '@/core/mapping/suggest-with-model'
import { askModelForColumns } from '@/adapters/extraction/suggester-gemini'
import { assign, emptyDraft, type DraftMapping } from '@/core/mapping/draft'
import type { TargetField } from '@/core/mapping/targets'
import { readHeadings } from '@/core/extraction/headings'
import { shapeKey } from '@/core/mapping/saved'
import { createMappingStore } from '@/adapters/db/mapping-store-postgres'
import type { SampleState, SaveState } from './sample-state'

/**
 * A sample in, its column headings out.
 *
 * ## What this module may reach, and what it still may not
 *
 * Story 5.7 made "nothing here stores anything" false: a mapping is remembered,
 * and this is where the treasurer confirms it. So the claim narrowed rather than
 * disappeared, and `actions.test.ts` narrowed with it.
 *
 * **It may reach the mapping store.** That is the whole of story 5.7's AC3.
 *
 * **It still may not reach a document repository, object storage or `ingest`.**
 * Those are the sample path's prohibition, and they survive because a sample is
 * not a document the association is keeping. The re-import a mapping change
 * triggers needs all three - which is exactly why it lives in its own module and
 * not here.
 *
 * A behavioural test cannot prove the absence of a write it never triggered —
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

/**
 * The treasurer confirms their mapping, and it is remembered (AC1, AC3).
 *
 * ## The shape is computed here, never accepted
 *
 * The form sends the sample's **header row**, and this recomputes the shape from
 * it through `readHeadings` and `shapeKey` - the same two functions an upload
 * goes through. A client-supplied shape string would decide which stored mapping
 * a later upload matches, which is the one input that must not be assertable.
 * Story 5.6b moved the suggestion seam server-side for the narrower version of
 * this reason.
 *
 * ## Every pairing goes through `assign`
 *
 * Not "validated here". `core/mapping/draft.ts` owns what a valid pairing is -
 * a target the kind offers, a column that exists, no source paired twice - and a
 * second answer to that question in a server action is the duplicated-rule
 * defect this project has now found six times. One rejected pairing rejects the
 * submission rather than being dropped: a mapping silently missing a column the
 * treasurer set is worse than one refused.
 *
 * ## What it does not do
 *
 * It does not re-import. `save` reports what it replaced, and this turns that
 * into the number AC6 puts in front of the treasurer *before* they agree. The
 * re-import itself is a second, deliberate act in its own module - which is also
 * why no object storage or `ingest` appears in this file.
 */
export async function saveMapping(_previous: SaveState, formData: FormData): Promise<SaveState> {
  const session = await auth()
  const savedBy = session?.user?.id

  // A server action is its own entry point, reachable without the page ever
  // rendering. Without this, anyone could write a mapping into a board's setup.
  if (typeof savedBy !== 'string' || savedBy.trim() === '') {
    return { status: 'error', error: 'Your session has expired. Sign in again to continue.' }
  }

  const kind = formData.get('documentKind')
  if (!isDocumentKind(kind)) {
    return { status: 'error', error: 'Choose which kind of import you are setting up.' }
  }

  const header = parseJson(formData.get('headerRow'))
  if (!Array.isArray(header) || !header.every((cell) => typeof cell === 'string')) {
    return { status: 'error', error: 'That mapping could not be read. Start the wizard again.' }
  }

  // The importer's own reading of the header row, not the client's. `readHeadings`
  // is what an upload uses, so a shape stored here and a shape derived at upload
  // time cannot disagree.
  const headings = readHeadings([header])
  if (!headings.ok) {
    return { status: 'error', error: 'That file has no readable column headings.' }
  }

  const pairings = parseJson(formData.get('pairings'))
  if (!Array.isArray(pairings)) {
    return { status: 'error', error: 'That mapping could not be read. Start the wizard again.' }
  }

  const draft = fold(pairings, emptyDraft(kind, headings.headings.length))
  if (draft === null) {
    return { status: 'error', error: 'That mapping is not valid. Check the columns and try again.' }
  }

  const replaced = await createMappingStore().save({
    savedBy,
    kind,
    shape: shapeKey(kind, headings.headings),
    mapping: draft,
  })

  // Changed, not created - and that is *all* this reports. Counting what the
  // change affects means reading every candidate document's bytes back out of
  // object storage, which this module may not reach: the sample path's
  // prohibition on a document store and `ingest` is what keeps a wizard from
  // touching the permanent record. The count is `previewReimport`, asked for
  // separately by the module that owns the re-import.
  return replaced === null ? { status: 'saved' } : { status: 'replaced' }
}

/** `JSON.parse` that answers `null` rather than throwing at a form field. */
function parseJson(value: FormDataEntryValue | null): unknown {
  if (typeof value !== 'string') return null

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * Every pairing through `assign`, or nothing.
 *
 * All-or-nothing because a partially applied mapping is the failure that looks
 * like success: the treasurer sees "saved" and one column they set is quietly
 * absent, which surfaces later as a column of empty amounts.
 */
function fold(pairings: readonly unknown[], start: DraftMapping): DraftMapping | null {
  let draft = start

  for (const pairing of pairings) {
    if (typeof pairing !== 'object' || pairing === null) return null

    const { target, position } = pairing as { target?: unknown; position?: unknown }
    if (typeof target !== 'string' || typeof position !== 'number') return null

    const result = assign(draft, target as TargetField, position)
    if (!result.ok) return null

    draft = result.draft
  }

  return draft
}


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
