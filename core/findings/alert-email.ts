import { findingRoute } from '../auth/route-policy'
import type { FindingDetail } from '../ports/finding-reader'
import { toFindingDetail } from './detail-view'
import { toFindingRow } from './finding-view'

/**
 * One finding, as the message that arrives in a board member's inbox.
 *
 * ## The fourth surface, and the first one that is sent
 *
 * The dashboard row, the finding detail page and the register all wait to be
 * visited. This arrives uninvited, on a phone, and cannot be corrected
 * afterwards — there is no edit and no recall. A page that says something wrong
 * is fixed by a deploy; an email that says something wrong has already been
 * read.
 *
 * That asymmetry is the argument for everything below: the title and the
 * sentence are **taken** from `toFindingRow` and `toFindingDetail` rather than
 * written again, every interpolated value is flattened, and the copy is asserted
 * for what it must *not* say as well as what it must.
 *
 * ## Plain text, and no markup anywhere
 *
 * AD-8 binds FR-8: *"Extracted values are data, never instructions … the
 * renderer escapes on output."* A vendor name lifted off a scanned invoice is
 * placed in a subject line, and a subject line is where header injection lands.
 * The cheapest way to keep that value data is to send a document with no markup
 * for it to become — see `core/ports/mail.ts`, where the absence of an `html`
 * field is asserted rather than merely observed.
 *
 * That is the argument for the format. It is **not** an excuse to skip the
 * control-character rule, which is `oneLine` below and is applied to every value
 * that reaches the message.
 *
 * ## Nothing here throws
 *
 * `evidence` arrives as `unknown` because it is `jsonb` written by whichever
 * version of a detector ran. The view layer already degrades rather than failing
 * on a malformed one, and this must not undo that: a mailer that throws on a
 * single unfamiliar row never sends the nineteen good messages behind it in the
 * loop. The failure is not the plainer email — it is the silence.
 */

export interface AlertEmail {
  readonly subject: string
  readonly text: string
}

/**
 * The longest a subject may be before agents start truncating it themselves.
 *
 * Chosen so the truncation is *ours* and therefore visible. An agent's own
 * clipping is silent and differs per client, so the same alert would read as a
 * different sentence depending on where it was opened.
 */
const SUBJECT_CHARACTERS = 140

/** The longest any single interpolated value may be inside the body. */
const VALUE_CHARACTERS = 300

/**
 * Characters that would let a value carry structure it did not intend.
 *
 * Broader than a carriage return and a line feed, and every addition below is a
 * real spelling of "newline" somewhere:
 *
 * - **C0**, `U+0000`-`U+001F` -- includes CR, LF, vertical tab and form feed.
 * - **DEL and C1**, `U+007F`-`U+009F` -- C1 contains NEL (`U+0085`), which is a
 *   line break to more parsers than anyone expects.
 * - **`U+2028` and `U+2029`** -- the Unicode line and paragraph separators.
 *   Invisible in a diff, and treated as line terminators by a great deal of
 *   software.
 *
 * Named by code point rather than typed as literals, deliberately: a raw
 * control byte in source is invisible in a diff and has reached this
 * repository three times, most recently inside a regex that then compiled fine
 * and matched nothing.
 *
 * Each is replaced by a **space**, never removed. Removing joins the words on
 * either side, so a name broken by one becomes a single token and a board
 * member reads a vendor that does not exist.
 */
const CARRIES_STRUCTURE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu

/** Any run of whitespace, so a flattened value has single spaces between words. */
const WHITESPACE_RUN = /\s+/gu

/**
 * A value from a document, made unable to be anything but text.
 *
 * Returns `''` for a value that holds nothing once flattened — distinct from a
 * value that is present, and the caller drops the line rather than printing a
 * label with nothing after it.
 *
 * **Truncation is by code point, not by code unit.** `String.prototype.slice`
 * cuts UTF-16 units, so a cap landing inside a surrogate pair yields a lone
 * surrogate: not a character, and rendered as a replacement box in the one place
 * a board member is reading a vendor's name. Spreading into an array iterates
 * code points, which is what makes the cut safe.
 *
 * **The ellipsis is inside the cap, not added to it.** Appending after slicing
 * to `cap` produces `cap + 1` characters, which is the bug this kind of helper
 * always has.
 *
 * `core/csv/cell.ts` is the sibling — the same problem, a value becoming syntax,
 * in a different output format. Its shape is what this copies. It is
 * deliberately not extended: a formula guard and a header-injection guard are
 * different rules, and merging them makes both harder to reason about.
 */
export function oneLine(value: string, cap: number): string {
  const flattened = value
    .replace(CARRIES_STRUCTURE, ' ')
    .replace(WHITESPACE_RUN, ' ')
    .trim()

  const points = [...flattened]
  if (points.length <= cap) return flattened

  // `cap - 1` to leave room for the ellipsis, and `Math.max` because a cap of
  // zero or one must not produce a negative slice that returns the tail.
  return `${points.slice(0, Math.max(cap - 1, 0)).join('')}…`
}

/** `Label: value`, or nothing at all when the value flattens to nothing. */
function line(label: string, value: string | null): string | null {
  if (value === null) return null

  const flattened = oneLine(value, VALUE_CHARACTERS)

  // An absent value is never filled in. "0 invoices checked" and "unit
  // undefined" are each a statement the record does not support, and a board
  // member could act on the first.
  return flattened === '' ? null : `${label}: ${flattened}`
}

/**
 * A heading and its groups, or nothing at all.
 *
 * **Row separation happens here rather than at the call site, and that is the
 * fix for a real defect.** Interleaving blank separators before the null filter
 * puts empty strings into the list, and an empty string is not null -- so a
 * table whose every record was unreadable still looked non-empty, and the
 * caption rendered over blank lines. A heading promising evidence that is not
 * there is worse than no heading, and it is reachable: `table()` returns null
 * only when there are *no* rows, so a stored pair holding nothing legible gives
 * a row of all nulls. Raised by Argus.
 *
 * Each group is filtered on its own, empty groups vanish, and the heading
 * survives only if some group did.
 */
function block(heading: string, groups: readonly (readonly (string | null)[])[]): readonly string[] {
  const present = groups
    .map((group) => group.filter((entry): entry is string => entry !== null))
    .filter((group) => group.length > 0)

  if (present.length === 0) return []

  return [
    heading,
    // A blank line between groups but not after the last, so the trailing '' is
    // the block's own separator rather than a stray one.
    ...present.flatMap((group, index) => {
      const lines = group.map((entry) => `  ${entry}`)

      return index === present.length - 1 ? lines : [...lines, '']
    }),
    '',
  ]
}

export function toAlertEmail(finding: FindingDetail, baseUrl: string): AlertEmail {
  // Taken, not rewritten. Three surfaces describe this finding and
  // `finding-view.ts` exists so they cannot disagree; a fourth wording of
  // "possible duplicate" would be the one read aloud in a dispute.
  const row = toFindingRow(finding)
  const detail = toFindingDetail(finding)

  // `new URL` resolves the route against the base, which is what makes a base
  // with or without a trailing slash produce one link rather than `//findings`.
  // `findingRoute` is reused and never re-spelled: a second spelling of the
  // detail path is a dead link discovered by the person the alert was for.
  const link = new URL(findingRoute(finding.id), baseUrl).toString()

  const subject = oneLine(`Watchdog: ${row.title}`, SUBJECT_CHARACTERS)

  const body: readonly (string | null)[] = [
    // The detail page's sentence, verbatim. A second phrasing of it would be
    // the drift, not the addition.
    detail.summary === null ? null : oneLine(detail.summary, VALUE_CHARACTERS),
    detail.summary === null ? null : '',

    ...block('What was compared', [
      detail.figures.map((figure) => line(figure.label, figure.value)),
    ]),

    ...block(
      detail.comparisons === null ? '' : oneLine(detail.comparisons.caption, VALUE_CHARACTERS),
      // Stacked label/value groups, one record per group -- the treatment
      // EXPERIENCE.md requires of a narrow screen, and the only honest one in
      // plain text. An aligned table stops being aligned the moment a value is
      // longer than its column.
      (detail.comparisons?.rows ?? []).map((cells) =>
        cells.map((cell, column) =>
          line(detail.comparisons?.columns[column]?.label ?? '', cell),
        ),
      ),
    ),

    'Open this finding:',
    `  ${link}`,
    '',

    // Why it arrived. There is no unsubscribe — every board member receives
    // every finding, decided rather than defaulted into — so this line is the
    // whole of the explanation a director gets, and without it the message is
    // indistinguishable from something they should ignore.
    'Every board member receives every finding. Reviewing it on the page above',
    'moves it to the register, where it stays.',
  ]

  const text = body.filter((entry): entry is string => entry !== null).join('\n')

  return { subject, text }
}
