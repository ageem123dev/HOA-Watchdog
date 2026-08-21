/**
 * The headings a sample file actually has — story 5.3.
 *
 * ## Why this is not `readRows`
 *
 * `readRows` asks **may this file be ingested?** and stops at the first thing
 * that says no. A file with two `amount` columns comes back as
 * `{ reason: 'duplicate-headers' }` naming *neither* of them, which is right
 * there: taking the first or the last is how a figure arrives from the wrong
 * column with nothing to show it happened.
 *
 * This asks **what columns does this file have?**, and every answer it owes is
 * the inverse. Name the duplicates. Name the blanks. Report **all** of them at
 * once, because a treasurer who fixes a duplicate and is only then told about a
 * blank has been made to upload twice for no reason.
 *
 * ## Reporting, not refusing
 *
 * A file with problems still yields its headings. The wizard shows both halves:
 * these are your columns, and these are the ones you will want to fix. Only a
 * file with no headings at all is refused, because there is then nothing to
 * report.
 *
 * ## What it deliberately does not do
 *
 * No document kind, no mapping, no suggestion. A sample is uploaded to *learn*
 * what it contains, before there is a mapping to say what it is for — so the
 * kind story 5.2 made mandatory for ingestion has no place here.
 */

export interface Heading {
  /**
   * 1-based, because it is the number a treasurer counts to in their
   * spreadsheet. A zero-based position in a message is one they cannot use.
   */
  readonly position: number
  /** As written in the file, so it can be found in the spreadsheet. */
  readonly text: string
  /** As `readRows` would match it, which is what decides collisions. */
  readonly normalised: string
}

export type HeadingProblem =
  | {
      readonly reason: 'duplicate-heading'
      readonly heading: string
      readonly positions: readonly number[]
    }
  | { readonly reason: 'blank-heading'; readonly positions: readonly number[] }

export type HeadingsResult =
  | {
      readonly ok: true
      readonly headings: readonly Heading[]
      readonly problems: readonly HeadingProblem[]
    }
  | {
      readonly ok: false
      /**
       * Kept apart on purpose: "your file is empty" and "your headings are all
       * blank" send a treasurer to different places, and one reason covering
       * both would send them to neither.
       */
      readonly reason: 'no-rows' | 'no-headings'
    }

/**
 * How a heading is matched.
 *
 * **Exported, and `readRows` imports it**, so the sample report and the
 * importer cannot classify a heading differently. Two copies of
 * `trim().toLowerCase()` behave identically until one changes, and the symptom
 * then is a wizard showing columns the importer would treat as something else —
 * worse than either behaviour on its own. Raised by CodeRabbit.
 */
export const normaliseHeading = (heading: string): string => heading.trim().toLowerCase()

export function readHeadings(rows: readonly (readonly string[])[]): HeadingsResult {
  const [headerRow] = rows
  if (headerRow === undefined) return { ok: false, reason: 'no-rows' }

  const headings: Heading[] = headerRow.map((text, index) => ({
    position: index + 1,
    text,
    normalised: normaliseHeading(text),
  }))

  // A row of cells that are all blank names nothing, and neither does a row of
  // no cells. Both are "there are no headings here" rather than "here are some
  // headings, all of them broken" — there is no column list to show.
  if (headings.every((heading) => heading.normalised === '')) {
    return { ok: false, reason: 'no-headings' }
  }

  const problems: HeadingProblem[] = []

  // **Duplication is decided on the matched form**, because that is what would
  // collide at ingestion: `Amount` and `amount ` are one column to `readRows`,
  // and calling them distinct here would tell a treasurer their file was fine.
  const positionsByHeading = new Map<string, number[]>()
  for (const heading of headings) {
    if (heading.normalised === '') continue
    const seen = positionsByHeading.get(heading.normalised)
    if (seen === undefined) positionsByHeading.set(heading.normalised, [heading.position])
    else seen.push(heading.position)
  }

  for (const [heading, positions] of positionsByHeading) {
    // Reported once per heading with every position it occupies, rather than
    // once per extra occurrence: the treasurer has one problem to fix, not two.
    if (positions.length > 1) problems.push({ reason: 'duplicate-heading', heading, positions })
  }

  const blanks = headings
    .filter((heading) => heading.normalised === '')
    .map((heading) => heading.position)

  // Gathered into one report rather than one per column, for the same reason.
  if (blanks.length > 0) problems.push({ reason: 'blank-heading', positions: blanks })

  return { ok: true, headings, problems }
}
