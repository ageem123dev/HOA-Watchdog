/**
 * Unit identity, folded the way the database folds it.
 *
 * `unit_normalised_number()` in migration 011 backs a stored generated column
 * and the unique index built on it, so it — and nothing else — decides which
 * spellings are one unit. This is that rule in TypeScript, for the one job that
 * has to anticipate it: refusing a roll before the database refuses it less
 * helpfully.
 *
 * **Deliberately not `fold()` from `core/payment/resolve-line.ts`**, and the
 * difference is not cosmetic. That one collapses JavaScript's `\s`, which
 * matches U+3000 (ideographic space) among others; migration 011's character set
 * does not. So `fold` merges `4　B` and `4 B` into one key while Postgres
 * stores two distinct units — and using it to detect duplicates in a roll
 * **refused a document the database would have accepted**. Raised by review.
 *
 * The two coexist on purpose. `fold` is used where over-merging is the safe
 * direction: `record-payments.ts` drops *both* sides of a collision, so the
 * lines are held for a human rather than attributed to a guess. Here
 * over-merging turns a valid roll away, so the rule has to be the database's
 * rule exactly.
 *
 * A second statement of a shape is only safe when something fails on
 * disagreement — migration 007's note. `normalised-number.test.ts` reads
 * migration 011 and compares the character sets, which is what earns this file
 * the right to exist.
 */

/**
 * The characters migration 011 treats as whitespace, and only those.
 *
 * A space, then `chr(9)`, `chr(10)`, `chr(13)`, `chr(11)`, `chr(12)`,
 * `chr(160)` and `chr(8239)` — tab, newline, carriage return, vertical tab,
 * form feed, no-break space and narrow no-break space.
 *
 * **U+3000 is absent, and that absence is the whole point of this file.**
 */
export const UNIT_WHITESPACE = Object.freeze([
  '\u0020',
  '\u0009',
  '\u000a',
  '\u000d',
  '\u000b',
  '\u000c',
  '\u00a0',
  '\u202f',
] as const)

const CLASS = `[${UNIT_WHITESPACE.join('')}]`
const ENDS = new RegExp(`^${CLASS}+|${CLASS}+$`, 'g')
const RUNS = new RegExp(`${CLASS}+`, 'g')

/**
 * The comparison key for a unit number, matching `unit_normalised_number()`.
 *
 * Ends trimmed, internal runs collapsed to one space, case folded — in that
 * order, because the migration does `lower(regexp_replace(btrim(...)))` and
 * collapsing before trimming would leave a single leading space behind.
 *
 * Leading zeroes are deliberately **not** folded, which migration 011 records as
 * an explicit decision: zero-padding is a real convention in some associations,
 * so `04B` and `4B` stay two units, and deciding otherwise is a data decision
 * rather than a schema one.
 */
export function normaliseUnitNumber(raw: string): string {
  return raw.replace(ENDS, '').replace(RUNS, ' ').toLowerCase()
}
