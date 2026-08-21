/**
 * An uploaded sample, in; the headings it has, out — story 5.3, Task 4.
 *
 * ## Why a sample does not go through `ingest`
 *
 * This is the decision Task 4 exists to record, and it has two halves.
 *
 * **It must not.** `ingest` stores the document, hashes it for AD-13
 * idempotency, writes a provenance row and resolves vendors. A sample is
 * uploaded so a treasurer can be shown its columns and then build a mapping —
 * it is *not a document the association is keeping*. One landing in `document`
 * would be a file in the permanent record that nobody asked to keep, and it
 * would count against the register a board reads.
 *
 * **It cannot.** Story 5.2 made a declared `documentKind` mandatory for
 * ingestion, and a sample has none: the mapping is what the kind is *for*. A
 * treasurer uploading a sample is not yet in a position to declare anything.
 *
 * So this composes the two halves that *are* shared — `toRectangle` decodes,
 * `readHeadings` reports — and nothing else. It takes no store, no repository
 * and no kind, and the test says so out loud: if this ever needs one, the seam
 * has moved and that is worth noticing rather than absorbing.
 *
 * ## Where the HTTP surface is
 *
 * Not here, and not yet. The wizard screen is story 5.4, and a server action
 * with nothing rendering it is precisely the shape that shipped broken in 5.2 —
 * an action requiring a field no form sent, with every gate green. The action
 * lands with the screen that calls it.
 */

import { toRectangle } from './rectangle'
import { readHeadings, type Heading, type HeadingProblem } from './headings'
import type { WorkbookDecoder } from '../ports/workbook-decoder'

/** The shape an upload arrives in, minus everything ingestion would add. */
export interface SampleFile {
  readonly filename: string
  readonly contentType: string
  readonly bytes: Uint8Array
}

export interface SampleDependencies {
  readonly workbooks?: WorkbookDecoder
}

export type SampleHeadingsResult =
  | {
      readonly ok: true
      readonly headings: readonly Heading[]
      readonly problems: readonly HeadingProblem[]
    }
  | {
      readonly ok: false
      /**
       * Four reasons, kept apart because they send a treasurer to four
       * different places: a format we cannot read, a file that would not
       * decode, an empty file, and a file whose headings are all blank.
       */
      readonly reason: 'no-reader' | 'unreadable-file' | 'no-rows' | 'no-headings'
    }

export function readSampleHeadings(
  file: SampleFile,
  deps: SampleDependencies = {},
): SampleHeadingsResult {
  const rectangle = toRectangle(file.contentType, file.bytes, deps.workbooks)
  if (!rectangle.ok) {
    // An empty file and a rectangle with no rows are the same sentence to a
    // treasurer — "there is nothing in this file" — so they arrive as one
    // reason rather than two that would need explaining apart.
    return { ok: false, reason: rectangle.reason === 'empty-file' ? 'no-rows' : rectangle.reason }
  }

  const headings = readHeadings(rectangle.rows)
  if (!headings.ok) return { ok: false, reason: headings.reason }

  return { ok: true, headings: headings.headings, problems: headings.problems }
}
