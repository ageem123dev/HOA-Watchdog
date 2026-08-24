/**
 * A mapping a treasurer set up once, and how the next export finds it again
 * (story 5.7).
 *
 * ## Every earlier story in this epic said "nothing is stored"
 *
 * They meant it, and they meant *until here*. `prefill.ts` says "story 5.7 is
 * where a mapping is remembered"; story 5.6's AC3 says the same. This module is
 * the shape of the thing they were deferring — not the storage itself, which is
 * an adapter's job, but *what* is stored and *how it is found*.
 *
 * ## The key is the design
 *
 * A mapping stores **positions**. That is what makes it reusable and what makes
 * it dangerous: applied to a file whose columns have moved, every pairing points
 * at the wrong column and dates are read as amounts — silently, because every
 * cell is still a plausible value. So the key includes the headings *in order*,
 * and a reordered export is a different shape that goes back to the wizard.
 *
 * The folding is `normaliseHeading`, imported. Two exports the importer
 * considers identical must key identically, or a treasurer maps the same file
 * twice and cannot see why. This is the fifth place in this epic that has to
 * fold a heading, and every previous one that re-derived it was a defect: story
 * 5.3 found the first, story 5.6 Task 1 the second, story 5.6b's residue the
 * third.
 */

import { normaliseHeading } from '../extraction/headings'
import type { Heading } from '../extraction/headings'
import type { DocumentKind } from '../extraction/record'
import type { DraftMapping } from './draft'

/**
 * A mapping, and what identifies which uploads it is for.
 *
 * **No `associationId` field, deliberately.** The association is 5.1's tenancy
 * and this project derives it *in SQL from an authenticated anchor*, never from
 * a parameter — `document-repository-postgres.ts` says why: *"`association_id` is
 * read from the uploader rather than passed in, so a caller cannot supply the
 * wrong one."* `payment-repository-postgres.ts` takes it from the parent
 * document for the same reason.
 *
 * A first draft of this type carried `associationId: string`, which is exactly
 * the parameter that convention exists to refuse. The association is still part
 * of the identity — a mapping found across associations would import one board's
 * file under another board's column meanings — but it is established by
 * `savedBy`, not asserted by the caller.
 */
export interface SavedMapping {
  /** The board member whose association this mapping belongs to. */
  readonly savedBy: string
  readonly kind: DocumentKind
  /** `shapeKey` of the heading row this was built against. */
  readonly shape: string
  readonly mapping: DraftMapping
}

/**
 * What makes two uploads "the same shape".
 *
 * The kind, then every heading folded, in file order, encoded with
 * `JSON.stringify`.
 *
 * **Encoded rather than joined by a delimiter.** `normaliseHeading` lowercases
 * and trims but keeps punctuation, so any printable separator could appear
 * inside a heading and let two different shapes collide. The obvious escape is a
 * control byte, and the first draft of this line used one — which is the byte
 * class `docs/no-control-characters.test.ts` was widened to source to catch, and
 * it caught this within a minute of the file being written. JSON escaping is
 * unambiguous and printable, so the question does not arise.
 *
 * **Order is part of the key**, deliberately. See the module comment: a mapping
 * is positions, and a reordered export reused under it reads every column wrong.
 */
export function shapeKey(kind: DocumentKind, headings: readonly Heading[]): string {
  return JSON.stringify([kind, ...headings.map((heading) => normaliseHeading(heading.text))])
}
