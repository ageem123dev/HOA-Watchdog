/**
 * The quarantine rule, in one place, because extraction finishes in two.
 *
 * A scan finishes in `extract-document.ts` on a later request; a spreadsheet
 * finishes in `ingest.ts` at upload time. Epic story 1.6's AC1 is about
 * extraction *completing*, not about which parser did it — so a rule that lived
 * in only one of them would make "upload the invoices as CSV" a way to put
 * vendors into the system with nobody asked about them.
 *
 * Written as one module rather than two copies for the same reason this epic
 * keeps giving: a rule with two implementations is a rule that will disagree
 * with itself, and the disagreement is silent.
 */

import { VENDOR_NAME_MAX_LENGTH } from '../extraction/record'
import type { ExtractionRecord } from '../extraction/record'
import type { Quarantine } from '../ports/quarantine'
import type { VendorDirectory } from '../ports/vendor-directory'
import { normaliseVendorName } from '../vendor/name'

/** The collaborators both call sites inject. */
export interface VendorResolutionDependencies {
  readonly vendors?: VendorDirectory
  readonly quarantine?: Quarantine
}

/**
 * A name `quarantine_item` and `extraction` would both refuse.
 *
 * Three checks, one per clause of `quarantine_item_name_length`, each reusing a
 * definition that already exists rather than restating it:
 *
 *   a NUL                `text` refuses it outright
 *   over 200             the bound `extraction.vendor_name` already enforces
 *   blank once trimmed   normalising it to nothing means it is nothing
 *
 * Length counts **code points**, because `char_length` counts those and
 * JavaScript's `.length` counts UTF-16 units — 200 astral characters are 400 by
 * the wrong measure, and guarding on it would refuse a name the table would
 * store happily.
 *
 * Widened after review. The first version checked only the NUL, reasoning that
 * `validate()` already bounds length and blankness so a conforming extractor
 * cannot produce the rest. That reasoning is correct and is the wrong place to
 * rest: AD-8 says extracted values are untrusted data, this is the boundary they
 * cross, and "the caller will not send that" is the assumption a boundary exists
 * to stop depending on.
 */
export function isStorableName(value: string): boolean {
  if (value.includes('\u0000')) return false
  if ([...value].length > VENDOR_NAME_MAX_LENGTH) return false

  // Normalising trims with the same separator set the constraint uses, so an
  // empty result is exactly `char_length(btrim(...)) = 0`.
  return normaliseVendorName(value) !== ''
}

/**
 * Whether any name in the set would be refused by the columns that store it.
 *
 * Checked across **every** record, before anything is deduplicated. Dedup keys
 * on the normalised name and folds NBSP, so `'Acme'` plus three hundred NBSPs
 * collapses onto a plain `'Acme'` and vanishes from a deduplicated list — but
 * not from the records `replace` stores, where migration 006 trims only space,
 * tab and newline and that name measures 304. Raised in review, against the fix
 * for this same guard.
 */
export function unstorableName(records: readonly ExtractionRecord[]): boolean {
  return records.some((record) => record.vendorName !== null && !isStorableName(record.vendorName))
}

/**
 * The distinct vendor names a reading produced, in the order first seen.
 *
 * Distinct by the *normalised* form, so one vendor spelled two ways on one
 * document is one question rather than two. The spelling kept is the first,
 * which matches `on conflict do nothing` in the adapter: the treasurer sees the
 * first spelling either way.
 *
 * A null is not a name. A statement genuinely has no vendor and migration 006
 * allows it; treating that as unresolved would quarantine every bank statement
 * the pilot ingests.
 */
export function distinctVendorNames(records: readonly ExtractionRecord[]): string[] {
  const seen = new Set<string>()
  const names: string[] = []

  for (const record of records) {
    if (record.vendorName === null) continue

    const key = normaliseVendorName(record.vendorName)
    if (seen.has(key)) continue

    seen.add(key)
    names.push(record.vendorName)
  }

  return names
}

/**
 * Ask about each distinct vendor, and hold the ones nobody knows.
 *
 * Call this **before** the records are stored. `replace` settles a document, so
 * records stored with the hold still missing is silent and permanent, while a
 * hold with no records leaves the document retryable and heals on the next pass.
 *
 * With no directory or no quarantine injected this does nothing, which is how
 * callers written before story 1.6b keep working. That is a real gap rather
 * than a neutral default — a caller in that state stores unknown vendors with
 * nobody asked — so both production call sites supply them and a test asserts
 * each does.
 */
export async function holdUnknownVendors(
  documentId: string,
  records: readonly ExtractionRecord[],
  deps: VendorResolutionDependencies,
): Promise<void> {
  const { vendors, quarantine } = deps
  if (vendors === undefined || quarantine === undefined) return

  for (const name of distinctVendorNames(records)) {
    const resolution = await vendors.resolve(name)

    // AD-8: unknown vendors reach a human and are never created here.
    if (resolution.outcome === 'unresolved') {
      await quarantine.hold(documentId, name)
    }
  }
}
