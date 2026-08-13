/**
 * How an evidence blob is read, in one place.
 *
 * `evidence` is `jsonb` written by whichever version of a detector ran, and it
 * reaches the ports as `unknown` on purpose. Every surface that describes a
 * finding therefore has to narrow before it touches anything — the dashboard
 * row, the detail page, and story 4.8's email.
 *
 * **These live here rather than privately in `finding-view.ts` because a second
 * copy is a second answer.** Two surfaces disagreeing about whether `""` counts
 * as a vendor name, or whether an array is an object, is exactly the drift
 * `finding-view.ts`'s header argues against for the *wording* — and the reads
 * underneath the wording are where that drift would actually start.
 *
 * Nothing here throws. A field that is missing or the wrong shape degrades the
 * surface that reads it rather than failing it: a detail page that dies on one
 * malformed finding shows a board member nothing at all, which is worse than
 * showing them the parts that survived.
 */

/**
 * A table lookup that cannot reach `Object.prototype`.
 *
 * **The keys are untrusted strings**, and a plain `table[key]` reads inherited
 * properties as though they were entries. `finding_type` comes from the
 * database, whose `finding_type_is_verb_noun` check is `^[a-z][a-z0-9_]*$` —
 * which `constructor` satisfies in full. A match reason comes out of `jsonb` and
 * is whatever a detector stored.
 *
 * The consequences were not theoretical on the dashboard row: a severity lookup
 * returned the `Object` function, so the `??` fallback beside it never fired and
 * the row rendered with no label and no tick. Raised by Argus on story 4.5.
 */
export function known<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined
}

/**
 * The value as a record of fields, or an empty one.
 *
 * Arrays are objects to `typeof`, and an array reaching a field read means the
 * evidence is not the shape anything expects. Treating it as an empty record
 * degrades every read at once, rather than at each call site.
 */
export function fields(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {}
}

/** A non-blank string, or `null`. A blank vendor name is an absent one. */
export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * A decimal figure as a detector stored it, trimmed, or `null`.
 *
 * **A non-blank string is not a number, and the difference reaches the page.**
 * `percentOverAverage` is a display-only decimal string arriving through
 * `jsonb`, so it can hold anything; interpolated without this check, a stored
 * `"abc"` renders as `abc% above a 6-month average of $980.00` — a
 * figure-shaped thing in the one sentence a board member is asked to trust. A
 * value carrying its own `$` fails here too, because the surface adds the mark
 * and would otherwise print it twice.
 *
 * Raised by Argus on story 4.6: the detail view guarded this and the dashboard
 * row, describing the same finding, did not.
 *
 * Deliberately not `formatAmount`, which is for money and adds a currency mark.
 * This returns the figure as stored, for a caller that supplies its own unit.
 */
export function decimal(value: unknown): string | null {
  const stored = text(value)
  if (stored === null) return null

  const trimmed = stored.trim()
  return /^-?\d+(?:\.\d+)?$/.test(trimmed) ? trimmed : null
}

/**
 * What a duplicate pair was matched on, in words.
 *
 * **One table, read by two surfaces that phrase it differently.** The dashboard
 * row joins these into a sentence with a grammatical slot (`… match an earlier
 * one on amount and date`), so a slug it does not recognise is dropped rather
 * than made to fit; the detail page puts it in a table cell, which has no such
 * slot, and makes it legible instead. Those are different readings of the same
 * fact, and both are deliberate — but they must not become different *facts*,
 * which is what two copies of this map would eventually be. Raised by Argus.
 */
export const MATCH_REASON: Readonly<Record<string, string>> = {
  'same-amount-and-date': 'amount and date',
  'same-amount-and-number': 'amount and invoice number',
}

/** A count: a non-negative integer, or `null`. */
export function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/** The object entries of an array field, with anything that is not one dropped. */
export function entries(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is Readonly<Record<string, unknown>> =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  )
}

/**
 * `same-amount-and-date` to `same amount and date`.
 *
 * Separators become spaces and nothing else changes. A slug this code does not
 * recognise is still a fact the detector recorded, and making it legible states
 * it without inventing a meaning for it — the alternative is dropping it, and a
 * board member cannot tell a dropped field from one that was never stored.
 */
export function words(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').trim()
}

/**
 * `1 instalment`, `3 instalments`.
 *
 * A hard-coded plural in a template reads fine on every example an author
 * happens to try and produces "1 instalments" the first time an association has
 * a single-instalment schedule. This is copy a board member reads beside a
 * figure they are being asked to act on, and the surface's credibility is most
 * of what it has. Raised by Argus on story 4.6's whole-story pass.
 *
 * English regular plurals only, which is all this product's nouns need —
 * instalments, invoices, months, documents. A noun needing anything else passes
 * its own plural.
 */
export function counted(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
