/**
 * One vendor, one identity.
 *
 * A vendor's name arrives from a parser reading somebody's scan, so the same
 * vendor turns up as `Evergreen Landscaping`, `evergreen  landscaping`, and
 * `Evergreen<NBSP>Landscaping`. If those become three rows, each holds a third
 * of the history, and a duplicate invoice sits in a comparison that never
 * happens — which is the anomaly the product exists to catch, missed silently.
 *
 * The database computes this same value in a generated column, and
 * `migrations/vendor.test.ts` runs both over a shared corpus. They must agree
 * exactly: if the application folds a character the database does not, it
 * believes it matched a vendor the unique index never saw, and one vendor
 * quietly becomes two.
 *
 * That is why neither `String.prototype.trim` nor `\s` appears below. Both
 * treat NBSP as whitespace; Postgres does not. The separator set is written
 * out instead, and the fold is ASCII-only — `lower()` and `toLowerCase()`
 * disagree on `U+0130` and on final sigma, and a locale-dependent fold that
 * silently merges two vendors is worse than one that declines to.
 */

/**
 * The characters treated as separators, in both engines.
 *
 * Deliberately not "whitespace": that word means different things to Postgres
 * and to JavaScript, and the difference is invisible. NBSP and narrow NBSP are
 * here because a PDF extractor emits them and a treasurer cannot see them.
 * Zero-width space is **not** here — neither engine calls it whitespace, and
 * inventing a disagreement is as bad as inheriting one.
 */
export const NAME_FOLD_WHITESPACE: readonly string[] = Object.freeze([
  ' ',
  '\t',
  '\n',
  '\r',
  '\u000b',
  '\u000c',
  '\u00a0',
  '\u202f',
])

/**
 * What makes two names the same vendor automatically.
 *
 * Normalised-exact, and nothing looser. Similarity ranking exists — the
 * database has `pg_trgm` and the quarantine queue uses it to order "did you
 * mean" candidates — but it informs a human and resolves nothing on its own.
 * A wrong automatic near-match does not fail loudly; it writes a false vendor
 * identity into the history and reports success.
 *
 * Widening this is a deliberate edit with a failing test behind it.
 */
export const AUTO_RESOLVE_RULE = 'normalised-exact'

const SEPARATORS = new Set(NAME_FOLD_WHITESPACE)

/**
 * The comparison key for a vendor name: separators folded, ends trimmed, ASCII
 * case dropped. Not reversible, and not meant to be displayed — `display_name`
 * is what a human reads.
 */
export function normaliseVendorName(raw: string): string {
  const folded: string[] = []
  let separatorPending = false

  // One pass, no regular expression. Trimming and collapsing fall out of the
  // same rule: a separator is only ever emitted *between* two kept characters,
  // so leading and trailing runs never reach the output at all.
  for (const character of raw) {
    if (SEPARATORS.has(character)) {
      separatorPending = folded.length > 0
      continue
    }

    if (separatorPending) {
      folded.push(' ')
      separatorPending = false
    }

    folded.push(character >= 'A' && character <= 'Z' ? character.toLowerCase() : character)
  }

  return folded.join('')
}
