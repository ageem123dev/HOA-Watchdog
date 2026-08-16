import type { FindingRecord } from '../ports/finding-reader'
import {
  MATCH_REASON,
  counted,
  entries,
  fields,
  known,
  percentAbove,
  text,
  whole,
  words,
} from './evidence'
import { formatAmount } from './money'

/**
 * One finding, turned into the row a board member reads.
 *
 * ## Why the copy lives in `core/` and not in the component
 *
 * The same argument `core/quarantine/queue-view.ts` makes, with one addition
 * this story supplies: three surfaces will describe the same finding. The
 * dashboard row is here, the detail page is story 4.6, and the alert email is
 * 4.8 — and 4.8 sends its text to people who will read it beside the page.
 * Wording decided per surface is wording that disagrees with itself in a board
 * packet.
 *
 * It also makes UX-DR23 assertable. "Never imply certainty the system lacks" is
 * a property of a sentence, and a sentence assembled inside JSX can only be
 * checked by rendering it.
 *
 * ## Nothing here throws
 *
 * `evidence` arrives as `unknown` because it is `jsonb` written by whichever
 * version of a detector ran. Every read below narrows before it touches
 * anything, and a field that is missing or the wrong shape degrades the row
 * rather than failing it. A dashboard that dies on one malformed finding hides
 * every other finding on it — the failure is not the blank row, it is the
 * nineteen that never appeared.
 */

export type Severity = 'needs-review' | 'worth-checking'

export interface FindingRow {
  readonly id: string
  readonly severity: Severity
  /** UX-DR2: the tick is never the sole carrier of meaning, so this is never empty. */
  readonly severityLabel: string
  readonly title: string
  /** What was compared. `null` when the evidence supports no honest sentence. */
  readonly evidenceLine: string | null
  /** Formatted, or `null` when the record supports no single figure. */
  readonly amount: string | null
  /** The day it was noticed. EXPERIENCE.md requires every finding to show it. */
  readonly raisedOn: string
}

export const POSSIBLE_DUPLICATE_INVOICE = 'possible_duplicate_invoice'
export const INVOICE_ABOVE_VENDOR_AVERAGE = 'invoice_above_vendor_average'
export const UNIT_DUES_SHORTFALL = 'unit_dues_shortfall'

/**
 * How loudly each finding speaks.
 *
 * `finding` has no severity column and should not have one — it would be a
 * detector's opinion stored as fact, and changing the opinion would mean
 * rewriting history. So it is derived, in one place, and the reasoning is
 * recorded because it is a judgement rather than a derivation:
 *
 * - A **possible duplicate** is the one finding where money is about to leave
 *   twice. The epic is called *be told before you pay*.
 * - An **invoice above average** is frequently legitimate. UX-DR23's whole
 *   point is that this is a comparison, not an accusation.
 * - A **dues shortfall** is money owed *in*, with no payment run pending — and
 *   it names a person. The surface should not shout about a member by name on
 *   evidence that a deposit may simply be unuploaded.
 */
const SEVERITY: Readonly<Record<string, Severity>> = {
  [POSSIBLE_DUPLICATE_INVOICE]: 'needs-review',
  [INVOICE_ABOVE_VENDOR_AVERAGE]: 'worth-checking',
  [UNIT_DUES_SHORTFALL]: 'worth-checking',
}

const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  'needs-review': 'Needs review',
  'worth-checking': 'Worth checking',
}

/**
 * What an unrecognised finding type is treated as.
 *
 * Not `needs-review`. A type this code cannot name is one it cannot describe
 * either, and escalating it would put an urgent tick beside a sentence that
 * says nothing — reassurance in reverse. It is shown, counted, and quiet.
 */
const UNKNOWN_SEVERITY: Severity = 'worth-checking'

/**
 * The one value they all agree on, or `null`.
 *
 * Used for the row's amount and for the vendor it names, and it is the same
 * rule both times: a row has one money column and makes one claim, so where the
 * evidence holds several answers it holds none this row can state. Picking the
 * first would attribute one invoice's figure to a finding covering three;
 * summing would state a total no record holds.
 */
function agreed(values: readonly (string | null)[]): string | null {
  const [first] = values
  if (first === undefined || first === null) return null
  return values.every((value) => value === first) ? first : null
}

/** `vendor_paid_before_approval` to `Vendor paid before approval`. */
function humanised(findingType: string): string {
  const spelled = words(findingType)
  if (spelled === '') return 'Finding'
  return spelled.charAt(0).toUpperCase() + spelled.slice(1)
}

function named(base: string, vendorName: string | null): string {
  return vendorName === null ? base : `${base} — ${vendorName}`
}

interface Reading {
  readonly title: string
  readonly evidenceLine: string | null
  readonly amount: string | null
}

function readDuplicate(evidence: Readonly<Record<string, unknown>>): Reading {
  const pairs = entries(evidence['pairs'])
  const vendorName = agreed(pairs.map((pair) => text(pair['vendorName'])))
  const title = named('Possible duplicate invoice', vendorName)

  // **The figure and the sentence fail independently.** An empty `pairs` leaves
  // nothing to price, so there is no amount. A missing `invoicesChecked` leaves
  // nothing to put the count over, so there is no sentence — but the pairs
  // still carry a figure the record supports, and withholding it would hide
  // real money from the board. AC5 forbids inventing an amount the record does
  // not support; this is the opposite error, and it was raised by CodeRabbit.
  const amount = agreed(pairs.map((pair) => formatAmount(pair['amount'])))

  const checked = whole(evidence['invoicesChecked'])
  if (pairs.length === 0 || checked === null) {
    // UX-DR24 cuts both ways: a count that was not stored may not be
    // manufactured, and "0 of 0" is a reassurance about a comparison that did
    // not happen.
    return { title, evidenceLine: null, amount }
  }

  const reasons = [
    ...new Set(
      pairs.flatMap((pair) => {
        const reason = text(pair['reason'])
        const phrase = reason === null ? undefined : known(MATCH_REASON, reason)
        return phrase === undefined ? [] : [phrase]
      }),
    ),
  ]

  const verb = pairs.length === 1 ? 'matches' : 'match'
  const on = reasons.length === 0 ? '' : ` on ${reasons.join(', and on ')}`

  return {
    title,
    evidenceLine: `${pairs.length} of ${counted(checked, 'invoice')} on this upload ${verb} an earlier one${on}.`,
    amount,
  }
}

function readSpike(evidence: Readonly<Record<string, unknown>>): Reading {
  const spikes = entries(evidence['spikes'])
  const windowMonths = whole(evidence['windowMonths'])
  const vendorName = agreed(spikes.map((spike) => text(spike['vendorName'])))
  const amount = agreed(spikes.map((spike) => formatAmount(spike['amount'])))

  const [only] = spikes
  if (spikes.length === 1 && only !== undefined) {
    const percent = percentAbove(only['percentOverAverage'])
    const average = formatAmount(only['average'])
    const averaged = whole(only['invoicesAveraged'])
    const line =
      percent === null || average === null || averaged === null || windowMonths === null
        ? null
        : `${percent}% above a ${windowMonths}-month average of ${average} across ${counted(averaged, 'invoice')}.`

    return { title: named('Invoice above average', vendorName), evidenceLine: line, amount }
  }

  // Several comparisons, and the detailed sentence describes one. The
  // percentages stay in the evidence for the detail surface to lay out.
  const checked = whole(evidence['invoicesChecked'])
  const line =
    spikes.length === 0 || checked === null || windowMonths === null
      ? null
      : `${spikes.length} of ${counted(checked, 'invoice')} are above a ${windowMonths}-month average for their vendor.`

  return { title: named('Invoices above average', vendorName), evidenceLine: line, amount }
}

function readShortfall(evidence: Readonly<Record<string, unknown>>): Reading {
  const unitNumber = text(evidence['unitNumber'])
  const nothingRecorded = evidence['kind'] === 'not-recorded'
  const base = nothingRecorded ? 'No dues recorded' : 'Dues below the schedule'
  const title = unitNumber === null ? base : `${base} — unit ${unitNumber}`

  const expected = formatAmount(evidence['expected'])
  const received = formatAmount(evidence['received'])
  const instalments = whole(evidence['instalmentsDue'])
  const evaluatedOn = text(evidence['evaluatedOn'])

  // `nothing recorded`, never `unpaid`. The commonest cause of no payment
  // against a unit is a deposit nobody has uploaded yet, and this is the one
  // finding that names a person.
  const arrival = nothingRecorded ? 'nothing recorded' : received === null ? null : `${received} received`

  const evidenceLine =
    expected === null || instalments === null || evaluatedOn === null || arrival === null
      ? null
      : `${expected} expected by ${evaluatedOn} across ${counted(instalments, 'instalment')}; ${arrival}.`

  return { title, evidenceLine, amount: formatAmount(evidence['shortfall']) }
}

function read(findingType: string, evidence: unknown): Reading {
  // Named `stored` rather than `known`, which is the module-level lookup
  // helper: a local of that name would shadow it, and nothing here could then
  // call it. Raised by CodeRabbit against the earlier name.
  const stored = fields(evidence)

  switch (findingType) {
    case POSSIBLE_DUPLICATE_INVOICE:
      return readDuplicate(stored)
    case INVOICE_ABOVE_VENDOR_AVERAGE:
      return readSpike(stored)
    case UNIT_DUES_SHORTFALL:
      return readShortfall(stored)
    default:
      // AC3. A type from a later story is shown with its name made legible and
      // no sentence invented for it. Dropping it would be the worst thing this
      // surface could do: from the board's side, a finding that never appears
      // is indistinguishable from one that was never raised.
      return { title: humanised(findingType), evidenceLine: null, amount: null }
  }
}

export function toFindingRow(finding: FindingRecord): FindingRow {
  const severity = known(SEVERITY, finding.findingType) ?? UNKNOWN_SEVERITY
  const reading = read(finding.findingType, finding.evidence)

  return {
    id: finding.id,
    severity,
    severityLabel: SEVERITY_LABEL[severity],
    title: reading.title,
    evidenceLine: reading.evidenceLine,
    amount: reading.amount,
    raisedOn: finding.raisedOn,
  }
}
