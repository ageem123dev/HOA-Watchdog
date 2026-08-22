/**
 * A bounded slice of a sample, and the count it is a slice *of*.
 *
 * ## Why bounded at all
 *
 * The slice crosses a server-action boundary and is serialised to the client.
 * An unbounded one means a 25 MB sample becomes 25 MB of React state, for a
 * screen that shows twenty rows. The bound is what makes carrying the rows
 * viable instead of asking the treasurer to upload the file twice.
 *
 * ## Why the total travels with it
 *
 * Because UX-DR24 forbids reassurance without a count of what was checked. Once
 * the preview is a *sample* of the sample, "your mapping looks right" is a claim
 * about twenty rows dressed up as a claim about the file. `totalDataRows` is
 * what lets the screen say "read 20 of 143" instead.
 *
 * The two counts are deliberately computed apart: clamp both with the same
 * expression and the screen can only ever say "20 of 20".
 */

/** How many data rows a preview reads. Twenty is a screenful, not a limit anyone tuned. */
export const PREVIEW_ROW_LIMIT = 20

/**
 * And how large those rows may be, serialised.
 *
 * **The row count alone does not bound the payload**, which is what this whole
 * design exists to keep small: twenty rows of a 25 MB file can still be 25 MB
 * if the cells are wide, and the state crosses a server-action boundary either
 * way. Raised by the CodeRabbit CLI, against a rationale that had claimed the
 * row bound was enough.
 *
 * 256 KB is comfortably more than a screenful of ordinary rows and far less
 * than anything that would trouble a page.
 */
export const PREVIEW_MAX_BYTES = 256 * 1024

export interface BoundedSample {
  /**
   * The header row followed by at most `PREVIEW_ROW_LIMIT` data rows.
   *
   * The header travels with it because `applyMapping` takes a rectangle and
   * drops row 0. Carrying bare data rows would mean prepending a dummy header
   * at every call site, which is a seam nobody remembers.
   */
  readonly rows: readonly (readonly string[])[]
  /** Data rows in the whole file — never clamped, or AC5 cannot be honest. */
  readonly totalDataRows: number
}

export function boundedSample(
  rows: readonly (readonly string[])[],
  limit: number = PREVIEW_ROW_LIMIT,
): BoundedSample {
  // No header means no rectangle. Inventing one would report a shape the sample
  // never had.
  if (rows.length === 0) return { rows: [], totalDataRows: 0 }

  const [header, ...dataRows] = rows

  // Whole rows only. A partial row would render as a row with missing cells,
  // which reads as a defect in the treasurer's file rather than a limit of the
  // preview. If even the first will not fit, none are carried and the counts
  // still tell the truth: "0 of 143".
  const head = header ?? []
  const carried: (readonly string[])[] = []

  // **The whole candidate payload, in UTF-8 bytes.** Summing rows with
  // `JSON.stringify(row).length` was wrong twice over: `.length` counts UTF-16
  // code units, so a cell of non-ASCII text is up to three bytes each and a
  // 256 KB budget carried 688 KB; and summing rows individually omits the
  // array brackets and the commas between them. Measuring the rectangle it
  // would actually serialise is both exact and obviously so. Raised by the
  // CodeRabbit CLI.
  //
  // At most `PREVIEW_ROW_LIMIT` iterations, so re-measuring each time costs
  // nothing worth optimising away.
  const encoder = new TextEncoder()
  const bytesOf = (rectangle: readonly (readonly string[])[]): number =>
    encoder.encode(JSON.stringify(rectangle)).length

  for (const row of dataRows.slice(0, limit)) {
    if (bytesOf([head, ...carried, row]) > PREVIEW_MAX_BYTES) break
    carried.push(row)
  }

  return {
    // Bounded on the *data* rows, not the rectangle: slicing `rows` to `limit`
    // yields `limit - 1` data rows while the screen says `limit`.
    rows: [head, ...carried],
    // Deliberately not `Math.min(...)`. The whole point of carrying this is
    // that it can exceed what was read; clamped by the same expression as the
    // slice, the screen can only ever say "20 of 20".
    totalDataRows: dataRows.length,
  }
}
