import { normaliseHeading } from '../extraction/headings'
import { DOCUMENT_KINDS } from '../extraction/record'
import { targetsForKind, type TargetField } from './targets'

/**
 * Matching a heading to the importer's column, the way a person would.
 *
 * ## Built on `normaliseHeading`, never beside it
 *
 * `normaliseHeading` is `trim().toLowerCase()`, and `readRows` imports the same
 * one so the wizard and the importer cannot classify a heading differently —
 * story 5.3 spent a review round on a duplicated copy of exactly that folding.
 * Matching needs *more* than it (punctuation, abbreviations), so it wraps it
 * rather than re-implementing the parts it already does.
 *
 * ## Deterministic, and that is the point
 *
 * epics.md: *"Most real headers differ by case, punctuation and abbreviation —
 * `Txn Date`, `Descr`, `Amt`, `Unit #`. A deterministic normaliser plus a small
 * alias table will match the large majority at no cost, with no prompt, no
 * credential and no failure mode. The model earns its place on the residue."*
 *
 * This is that normaliser. Story 5.6b adds the model, behind the port in
 * `suggest.ts`, and asks it only about what this could not resolve.
 *
 * **Not to be confused with epic 4's guarantee.**
 * `core/security/no-model-in-alerts.test.ts` proves no model sits in the
 * *alerting* path (FR-6/7/8), and that stays true. A setup-time suggestion a
 * human confirms is a different thing in a different path, and saying so here
 * is cheaper than leaving a reader to wonder whether the deterministic claim
 * quietly weakened.
 */

/**
 * The comparison key: the shared folding, then punctuation and spacing removed.
 *
 * `Unit #`, `unit#`, `Unit  #` and `UNIT #` are one column to a person, and the
 * importer never sees this key — it is only ever used to look up an alias.
 */
export function matchKey(heading: string): string {
  // The shared folding first, then everything a person ignores.
  //
  // Deliberately *calls* the shared one rather than re-deriving it: `readRows`
  // imports the same function, and two foldings that agree today are the
  // defect story 5.3 fixed. A test reads this body to hold it to that.
  return normaliseHeading(heading).replace(/[^a-z0-9]/g, '')
}

/**
 * The abbreviations real exports use, keyed by `matchKey`.
 *
 * Data, not code: adding a spelling is adding a line here. Every value must be
 * a published `TargetField`, and a test asserts it — an alias for a column the
 * importer does not have is a suggestion `assign` would refuse, which the
 * treasurer would experience as nothing happening.
 */
export const HEADING_ALIASES: Readonly<Record<string, TargetField>> = {
  // date
  txndate: 'date',
  transactiondate: 'date',
  postdate: 'date',
  posted: 'date',
  postingdate: 'date',
  effectivedate: 'date',
  // description
  descr: 'description',
  desc: 'description',
  memo: 'description',
  payee: 'description',
  vendor: 'description',
  name: 'description',
  details: 'description',
  // amount
  amt: 'amount',
  total: 'amount',
  value: 'amount',
  annualamount: 'amount',
  annual: 'amount',
  // reference
  ref: 'reference',
  refno: 'reference',
  referenceno: 'reference',
  checkno: 'reference',
  chequeno: 'reference',
  // unit
  unitno: 'unit',
  unitnumber: 'unit',
  apt: 'unit',
  apartment: 'unit',
  lot: 'unit',
  // cycle
  billingcycle: 'cycle',
  cadence: 'cycle',
  frequency: 'cycle',
  // year
  assessmentyear: 'year',
  yr: 'year',
}

/** The target a heading names, or `null` if the importer has no column for it. */
export function targetForHeading(heading: string): TargetField | null {
  const key = matchKey(heading)

  // **`Object.hasOwn`, not a bare lookup.** A plain object literal inherits
  // from `Object.prototype`, so a column headed `constructor` or `toString`
  // resolved to a *function* where this signature promises `TargetField |
  // null`. Header text is user-supplied from a user-supplied file, which is
  // precisely the input class AD-8 is about. Raised by Argus.
  if (Object.hasOwn(HEADING_ALIASES, key)) return HEADING_ALIASES[key] as TargetField

  // The importer's own vocabulary, so a target added to the contract is matched
  // by its own name without anyone touching the table above. `type` is not in
  // it — story 5.2 retired that column and `readRows` refuses a file carrying
  // one, so suggesting it would break the upload from inside the wizard.
  return CANONICAL.get(key) ?? null
}

/**
 * Every target the importer publishes, folded.
 *
 * Derived from `targetsForKind` rather than listed again: two lists is how a
 * wizard comes to suggest a column the parser will not read, which is the
 * defect `record.ts` names one seam over.
 */
const CANONICAL: ReadonlyMap<string, TargetField> = new Map(
  // **`DOCUMENT_KINDS`, not the five kinds written out again.** A literal list
  // here is the same defect one seam over from the one this file's own comment
  // warns about: add a sixth kind and its targets are silently not canonical, so
  // `targetForHeading` answers `null` for a column that kind genuinely
  // publishes. Raised by CodeRabbit — and by nothing before it, across two Argus
  // rounds and an `ocr` round over this file.
  DOCUMENT_KINDS.flatMap((kind) => {
    const { required, optional } = targetsForKind(kind)
    return [...required, ...optional]
  })
    // A `Map` rather than a `Set` of folded keys, so the *target* comes back
    // rather than the folded string. With a `Set` this needed `key as
    // TargetField`, which silently becomes a lie the day a target is added
    // whose name is not already its own `matchKey` — `unit_reference` would
    // resolve to `unitreference`. Raised by Argus. The cross-check test would
    // catch it; not casting means there is nothing to catch.
    .map((target) => [matchKey(target), target] as const),
)
