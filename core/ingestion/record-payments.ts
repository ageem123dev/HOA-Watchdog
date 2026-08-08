/**
 * A read deposit becomes payments, in one place, because ingestion finishes in
 * two.
 *
 * A scan finishes in `extract-document.ts` on a later request; a spreadsheet
 * finishes in `ingest.ts` at upload time. Story 2.5's AC1 is about a deposit
 * being *ingested*, not about which parser read it — so a rule living in only
 * one of them would make "upload the deposits as CSV" a way to receive money
 * recorded against nobody. CSV is the format the pilot actually uses, which
 * makes that the likelier half to be missed rather than the safer one.
 *
 * Written as one module rather than two copies for the reason
 * `hold-unknown-vendors.ts` gives beside it: a rule with two implementations is
 * a rule that will disagree with itself, and the disagreement is silent.
 */

import type { ExtractionRecord } from '../extraction/record'
import { fold, resolveLine, type DepositLine, type ResolvedLine } from '../payment/resolve-line'
import type { PaymentRepository } from '../ports/payment-repository'
import type { UnitDirectory } from '../ports/unit-directory'

/** The collaborators both call sites inject. */
export interface PaymentRecordingDependencies {
  /** Asked which unit a reference names. Never asked to create one. */
  readonly units?: UnitDirectory
  /** Where an attributed line and a held one are written together. */
  readonly payments?: PaymentRepository
}

/**
 * The unit ids these references name, keyed by the **folded** reference.
 *
 * The re-keying that lets the database and core disagree about folding without
 * anything going wrong. `unitIdsFor` answers for the raw string, and
 * `resolveLine` looks up `fold(raw)` — so this is the one place the two meet,
 * and it is a check rather than an assignment.
 *
 * Two raw references can fold to one key here and still name different units in
 * the database, because JavaScript's `\s` matches U+3000 and migration 011's
 * character set does not. Assigning would attribute both lines to whichever
 * arrived second: real money against the wrong unit, which is the single
 * outcome this story exists to prevent. **Both are dropped instead**, so both
 * lines are held and a human decides. A held line costs a treasurer a question.
 */
function byFoldedReference(found: ReadonlyMap<string, string>): Map<string, string> {
  const folded = new Map<string, string>()
  const ambiguous = new Set<string>()

  for (const [reference, unitId] of found) {
    const key = fold(reference)
    const already = folded.get(key)

    if (already !== undefined && already !== unitId) {
      ambiguous.add(key)
      continue
    }

    folded.set(key, unitId)
  }

  for (const key of ambiguous) folded.delete(key)

  return folded
}

/**
 * Whether any deposit line carries a reference the tables cannot store.
 *
 * `text` cannot hold a NUL. Passing one as a parameter raises 22021, which
 * aborts the transaction — so a single such line would take every payment in
 * the document with it, and `extraction.unit_reference` would refuse it too.
 * Migration 017's defect shape for the fourth time in this epic.
 *
 * `unitIdsFor` already refuses to *send* one; nothing stopped it being
 * *stored*, and the read-path guard is what made the write-path gap look
 * covered. `validate` does not close it either: `checkText` refuses null, wrong
 * types, blank and too-long, and says nothing about control characters.
 *
 * Reported rather than repaired, matching `unstorableName` beside it: both call
 * sites turn this into `unreadable`, which is honest — the document arrived
 * carrying something nothing here can record. Stripping the NUL instead would
 * store a reference the document does not contain, and might match a unit the
 * payer never named.
 */
export function unstorableUnitReference(records: readonly ExtractionRecord[]): boolean {
  return records.some(
    (record) => record.unitReference !== null && record.unitReference.includes('\u0000'),
  )
}

/**
 * A record as `resolveLine` needs it.
 *
 * Null becomes empty rather than being filtered out, because `resolveLine`
 * already turns each absence into the hold reason that names it —
 * `missing-reference`, `missing-amount`, `missing-date`. Dropping the line here
 * instead would lose a payment that reached the bank, and a payment the system
 * silently forgot is worse than one waiting for a human.
 */
function asDepositLine(record: ExtractionRecord): DepositLine {
  return {
    unitReference: record.unitReference ?? '',
    paidOn: record.issuedOn ?? '',
    amount: record.totalAmount ?? '',
  }
}

/**
 * Store what a deposit paid, and hold what it could not attribute.
 *
 * Call this **before** the records are stored, for the reason
 * `holdUnknownVendors` is called before them: `replace` settles the document, so
 * payments missing after a settled extraction is silent and permanent, while an
 * extraction still unsettled is retried and heals. `PaymentRepository.replace`
 * is set-replacement (AD-13), so the retry writes the same set rather than a
 * second copy.
 *
 * **Only deposits.** An invoice must write nothing to either table, and "nothing"
 * means no call at all rather than an empty set: `replace` refuses `[]` by
 * design, and reaching it would turn every invoice upload into a failure.
 *
 * With no directory or no repository injected this does nothing, which is how
 * callers written before this story keep working. That is a real gap rather than
 * a neutral default — a caller in that state reads a deposit and records no
 * money — so both production call sites supply them and a test asserts each does.
 */
export async function recordPayments(
  documentId: string,
  records: readonly ExtractionRecord[],
  deps: PaymentRecordingDependencies,
): Promise<void> {
  const { units, payments } = deps
  if (units === undefined || payments === undefined) return

  const deposits = records.filter((record) => record.documentKind === 'deposit')
  if (deposits.length === 0) return

  // Distinct, and one question for the whole document. Duplicates are ordinary:
  // a unit paying twice in a month is two lines naming one unit.
  const references = [
    ...new Set(
      deposits
        .map((record) => record.unitReference)
        .filter((reference): reference is string => reference !== null),
    ),
  ]

  const found = references.length === 0 ? new Map<string, string>() : await units.unitIdsFor(references)
  const lookup = byFoldedReference(found)

  const lines: ResolvedLine[] = deposits.map((record) =>
    // `?? null` rather than passing `Map.get` directly: `resolveLine` requires
    // `string | null` and checks with `typeof`, which is what stopped story
    // 1.6d's defect where a plain object answered `constructor` for a lookup.
    resolveLine(asDepositLine(record), (key) => lookup.get(key) ?? null),
  )

  await payments.replace(documentId, lines)
}
