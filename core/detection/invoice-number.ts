import { NAME_FOLD_WHITESPACE } from '../vendor/name'

/**
 * When two invoice numbers are the same invoice number.
 *
 * FR-6 asks for "fuzzy duplicates (similar invoice number, identical amount)",
 * and *similar* has an obvious reading that is wrong. An edit distance of one
 * matches `INV-1001` against `INV-1002` — two invoice numbers a vendor billing
 * twice in a month produces naturally, and certainly two different invoices.
 * The finding would say the association paid twice when it did not, on a page
 * whose whole value is that a board member can believe it.
 *
 * So the rule is **normalised-exact**: two numbers match when they are the same
 * number written differently, and never when they are merely close. That is the
 * decision `core/vendor/name.ts` reached for vendor identity, for a reason that
 * transfers exactly:
 *
 * > "A wrong automatic near-match does not fail loudly; it writes a false
 * > vendor identity into the history and reports success."
 *
 * ## What folds
 *
 * ASCII case, the separators `NAME_FOLD_WHITESPACE` already names, ASCII
 * punctuation, and leading zeros within each run of digits. Nothing else.
 *
 * **Characters outside ASCII are kept, not dropped.** Dropping what this rule
 * cannot classify would fold `ÁBC-1001` onto `ABC-1001` and manufacture a
 * match; keeping it can only miss one. A detector's false positives cost a
 * board member's trust, and SM-2's *100%* is promised on the exact rule — same
 * vendor, same amount, same date — not on this one. Missing is the direction to
 * fail in.
 *
 * ## What deliberately does not fold
 *
 * A leading non-numeric prefix. `0001001` does not match `INV-1001`, because
 * the rule that folds them together cannot tell `INV` from `CR` — and `CR-1001`
 * is the credit note for `INV-1001`. Those two documents are genuinely about
 * the same money, so pairing them produces a duplicate finding that reads
 * entirely plausible and is wrong.
 */

/**
 * The name of the rule, exported so that loosening it is a deliberate edit.
 *
 * `AUTO_RESOLVE_RULE` in `core/vendor/name.ts` is the precedent. A widener
 * reaching for `levenshtein` has to change this line and the test that pins it,
 * rather than quietly changing a comparison.
 */
export const INVOICE_MATCH_RULE = 'normalised-exact'

const SEPARATORS = new Set<string>(NAME_FOLD_WHITESPACE)

const ZERO = '0'.codePointAt(0)!
const NINE = '9'.codePointAt(0)!
const UPPER_A = 'A'.codePointAt(0)!
const UPPER_Z = 'Z'.codePointAt(0)!
const LOWER_A = 'a'.codePointAt(0)!
const LOWER_Z = 'z'.codePointAt(0)!
const ASCII_MAX = 127

function isDigit(character: string): boolean {
  // `codePointAt(0)!` rather than `?? 0`: every caller iterates `for (const
  // character of raw)`, which yields one non-empty code point per step, so the
  // fallback was unreachable — and the same file already asserts non-null for
  // the same value. Two styles for one fact, one of them untestable. Raised by
  // CodeRabbit.
  const code = character.codePointAt(0)!

  return code >= ZERO && code <= NINE
}

function isKept(character: string): boolean {
  const code = character.codePointAt(0)!

  // Everything above ASCII is kept unchanged — see the header. Within ASCII,
  // only letters and digits survive, so punctuation of every kind is dropped
  // without a list of which marks a vendor might use.
  if (code > ASCII_MAX) return !SEPARATORS.has(character)

  return (
    (code >= ZERO && code <= NINE) ||
    (code >= UPPER_A && code <= UPPER_Z) ||
    (code >= LOWER_A && code <= LOWER_Z)
  )
}

/**
 * The comparison key for an invoice number, or `''` when there is none.
 *
 * Takes null and undefined because `extraction.document_number` is nullable and
 * null is the ordinary case — it is what the extractor writes when it could not
 * read one. Leaving the caller to decide what null means is how the check ends
 * up skipped at one of two call sites.
 *
 * Not reversible and not for display: the number as the document wrote it is
 * what a board member is shown.
 */
export function normaliseInvoiceNumber(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return ''

  const kept: string[] = []

  // One pass, no regular expression, following `normaliseVendorName`. Folding
  // `A`-`Z` by code point rather than calling `toLowerCase` is not a
  // micro-optimisation: `'İ'.toLowerCase()` is **two** code points, so a
  // wholesale lowercase can make a key longer than the string it came from.
  for (const character of raw) {
    if (!isKept(character)) continue

    const code = character.codePointAt(0)!
    kept.push(code >= UPPER_A && code <= UPPER_Z ? character.toLowerCase() : character)
  }

  return stripLeadingZeros(kept)
}

/**
 * Leading zeros within each run of digits, so `INV-0001001` is `INV-1001`.
 *
 * Per run rather than once at the front: the zeros that matter are the ones
 * after a prefix, and an invoice number can carry more than one number in it.
 *
 * A run that is all zeros keeps one. Stripping `000` to nothing would make an
 * invoice numbered zero indistinguishable from an invoice with no number at
 * all, and this function's empty string is load-bearing — it is what stops
 * every unreadable invoice from matching every other.
 */
function stripLeadingZeros(characters: readonly string[]): string {
  const out: string[] = []
  let index = 0

  while (index < characters.length) {
    const character = characters[index]!

    if (!isDigit(character)) {
      out.push(character)
      index += 1
      continue
    }

    let end = index
    while (end < characters.length && isDigit(characters[end]!)) end += 1

    let start = index
    while (start < end - 1 && characters[start] === '0') start += 1

    for (let at = start; at < end; at += 1) out.push(characters[at]!)
    index = end
  }

  return out.join('')
}

/**
 * Whether two invoice numbers are the same number.
 *
 * **An absent number matches nothing, including another absent one.** Every
 * invoice whose number the extractor could not read folds to `''`, so a caller
 * comparing keys directly would pair them all with each other and raise a
 * duplicate for every unreadable pair. The guard lives here rather than at the
 * call site because there is more than one call site.
 */
export function sameInvoiceNumber(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const key = normaliseInvoiceNumber(left)

  return key !== '' && key === normaliseInvoiceNumber(right)
}
