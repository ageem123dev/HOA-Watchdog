/**
 * Whether a deposit line becomes a payment or waits for a human.
 *
 * AC2 of story 2.4, and the whole of it: **nothing is attributed to a unit on a
 * guess**. The reference is folded exactly as migration 011 folds a unit number,
 * and either that fold names a unit or it does not.
 *
 * The decision is deliberately dull, and keeping it dull is the point. Every
 * helpful-looking variant — nearest match, "there is only one candidate so it
 * must be that one", prefix matching, ignoring a leading zero — is a way of
 * attributing money to the wrong person, and an arrears finding against the
 * wrong person is the failure this product exists to prevent. A held line costs
 * a treasurer a question; a misattributed one costs somebody their good standing
 * with the board.
 *
 * Pure. The directory lookup is a parameter, so this is testable without a
 * database and cannot consult one by accident.
 */

import { toMinorUnits } from '../assessment/minor-units'

/** One line read off a deposit document, before anything has been decided. */
export interface DepositLine {
  readonly unitReference: string
  /** `YYYY-MM-DD`, as every date in this system crosses. */
  readonly paidOn: string
  /** A decimal string, as every amount in this system crosses. */
  readonly amount: string
}

export type ResolvedLine =
  | {
      readonly kind: 'attributed'
      readonly unitId: string
      readonly paidOn: string
      readonly amount: string
    }
  | {
      readonly kind: 'held'
      readonly unitReference: string
      readonly paidOn: string
      readonly amount: string
      readonly reason: HoldReason
    }

/**
 * Why a line could not become a payment.
 *
 * Stated here and in migration 017's `held_payment_reason_known` constraint,
 * with a test reading the migration to prove the two agree. Migration 007's note
 * gives the reason a second statement is allowed at all: it is only safe when
 * something fails on disagreement.
 */
export const HOLD_REASONS = Object.freeze([
  'unknown-unit',
  'missing-reference',
  'missing-amount',
  'missing-date',
  'unsupported-amount',
] as const)

export type HoldReason = (typeof HOLD_REASONS)[number]

/**
 * The same folding migration 011 applies to `unit.unit_number`.
 *
 * Case folded, ends trimmed, internal runs of whitespace collapsed to one space.
 * Leading zeroes are deliberately **not** folded — migration 011 records that as
 * an explicit decision, because zero-padding is a real convention in some
 * associations and deciding it means nothing is a data decision rather than a
 * schema one. Folding them here would quietly overturn it.
 */
const WHITESPACE = /[\s  ]+/g

export function fold(reference: string): string {
  return reference.replace(WHITESPACE, ' ').trim().toLowerCase()
}

export function resolveLine(
  line: DepositLine,
  lookup: (foldedReference: string) => string | null,
): ResolvedLine {
  const held = (reason: HoldReason): ResolvedLine => ({
    kind: 'held',
    unitReference: line.unitReference,
    paidOn: line.paidOn,
    amount: line.amount,
    reason,
  })

  const folded = fold(line.unitReference)

  // Held, not dropped. A payment the system silently forgot is worse than one
  // waiting for a human: the money reached the bank either way, and only one of
  // those states is visible to a treasurer.
  if (folded.length === 0) return held('missing-reference')
  if (line.amount.length === 0) return held('missing-amount')
  if (line.paidOn.length === 0) return held('missing-date')

  // Held, not attributed. `payment.amount` refuses zero and negatives because a
  // reversal is out of scope -- but a check constraint refuses them by aborting
  // the transaction, which loses every payment in the document and leaves it
  // retried forever. A line the system cannot use has to become a question, not
  // an exception. Same shape as the defect migration 017 fixed.
  let minorUnits: number
  try {
    minorUnits = toMinorUnits(line.amount)
  } catch {
    return held('unsupported-amount')
  }
  if (minorUnits <= 0) return held('unsupported-amount')

  const unitId = lookup(folded)

  // `typeof` rather than a truthiness check or `?? null`. A directory
  // implemented as a plain object answers `constructor` and `__proto__` with
  // inherited members — a function and an object — and neither is null. Story
  // 1.6d shipped exactly that: `suggestions[key] ?? []` returned
  // Object.prototype members for a vendor name that folded to `constructor`.
  // `typeof` only. An earlier version also refused an empty string, and nothing
  // could make that branch fire: a directory returning '' for a known reference
  // is not a case any caller produces, and no test could force it without
  // inventing one. A guard nothing can reach is a guard this project deletes --
  // raised by review, and the twelfth of its kind this epic.
  if (typeof unitId !== 'string') return held('unknown-unit')

  return { kind: 'attributed', unitId, paidOn: line.paidOn, amount: line.amount }
}
