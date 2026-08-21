/**
 * Bytes and a content type into the rectangle every tabular reader works on.
 *
 * ## Why this is shared rather than copied
 *
 * `ingest` already decided how a CSV and a workbook become rows. Story 5.3
 * needs the same decision for a **sample** — same types, same decoding — but a
 * sample must not go through `ingest`, which stores the document, hashes it for
 * AD-13 idempotency, writes provenance and resolves vendors. *A sample is not a
 * document the association is keeping*: it is uploaded so the treasurer can be
 * shown its columns, and then it is gone.
 *
 * Two copies of the dispatch would drift, and the drift is invisible: a format
 * accepted for ingestion but missing here is one a treasurer can upload and then
 * cannot build a mapping for, with nothing saying why. So this is the one place
 * that knows, and both callers read `TABULAR_CONTENT_TYPES` from it.
 *
 * ## Why `no-reader` is not `unreadable-file`
 *
 * A type nothing can read yet is *held* for a human; a file that would not
 * decode is refused. `ingest` has always drawn that line — collapsing it turns
 * "we cannot read PDFs yet" into "your file is corrupt", which sends a
 * treasurer to re-export a file that was never the problem.
 */

import type { WorkbookDecoder } from '../ports/workbook-decoder'
import { parseCsv } from './csv'

/** Spreadsheets, which need the injected decoder rather than a parser here. */
const SPREADSHEET_TYPES = [
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const

/**
 * Every content type that can become rows.
 *
 * Exported so no caller holds its own copy. `ACCEPTED_CONTENT_TYPES` in
 * `core/ingestion/acceptance.ts` is a wider list — it includes the scans that go
 * to the model extractor, which never see a header row (AD-9).
 */
export const TABULAR_CONTENT_TYPES = ['text/csv', ...SPREADSHEET_TYPES] as const

export type Rectangle =
  | { readonly ok: true; readonly rows: readonly (readonly string[])[] }
  | {
      readonly ok: false
      /**
       * `empty-file` is kept apart from `unreadable-file` because `parseCsv`
       * already knows the difference and it would be thrown away here
       * otherwise. "Your file is empty" and "your file could not be read" send
       * a treasurer to different places, and the second is actively misleading
       * about the first — it invites them to re-export a file that exported
       * fine.
       */
      readonly reason: 'unreadable-file' | 'no-reader' | 'empty-file'
    }

export function toRectangle(
  contentType: string,
  bytes: Uint8Array,
  workbooks?: WorkbookDecoder,
): Rectangle {
  if (contentType === 'text/csv') {
    const parsed = parseCsv(new TextDecoder().decode(bytes))
    if (parsed.ok) return { ok: true, rows: parsed.rows }

    // The CSV problem is not otherwise restated: the file was never a table, so
    // it has no headers to be missing and no columns to report. Emptiness is
    // the exception, because it is a different sentence.
    return { ok: false, reason: parsed.reason === 'empty' ? 'empty-file' : 'unreadable-file' }
  }

  if ((SPREADSHEET_TYPES as readonly string[]).includes(contentType)) {
    // An absent decoder is "no reader here", not a broken file — the caller
    // simply was not given one.
    if (workbooks === undefined) return { ok: false, reason: 'no-reader' }

    const decoded = workbooks.decode(bytes)
    return decoded.ok ? { ok: true, rows: decoded.rows } : { ok: false, reason: 'unreadable-file' }
  }

  return { ok: false, reason: 'no-reader' }
}
