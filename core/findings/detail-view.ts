import type { FindingDetail } from '../ports/finding-reader'
import { MATCH_REASON, decimal, entries, fields, known, text, whole, words } from './evidence'
import {
  INVOICE_ABOVE_VENDOR_AVERAGE,
  POSSIBLE_DUPLICATE_INVOICE,
  UNIT_DUES_SHORTFALL,
  toFindingRow,
  type Severity,
} from './finding-view'
import { formatAmount } from './money'
import { reviewMessage, type ReviewMessage } from './review'

/**
 * One finding, laid out at the length a page has room for (AC2).
 *
 * ## The header is taken from the row, not rewritten
 *
 * `toFindingRow` decides the title, the severity and the sentence, and this
 * function calls it rather than re-deriving any of them. That is the point of
 * the arrangement: three surfaces describe the same finding — the dashboard row,
 * this page, and story 4.8's email — and two of them disagreeing is a board
 * packet that contradicts itself. Reuse makes the disagreement unrepresentable
 * rather than merely discouraged.
 *
 * The row's sentence is carried **verbatim** as `summary`. AC2 asks for more
 * than a restatement of the row, and the tables below are that "more"; a second
 * *phrasing* of the same sentence would be the drift, not the addition.
 *
 * ## What the page adds
 *
 * `figures` are what the detector recorded about the check as a whole — how many
 * invoices it looked at, the threshold it applied, the window it averaged over.
 * `comparisons` is the table of what was actually compared, one row per stored
 * pair or spike, each carrying its own figures. The row could hold neither: it
 * has one sentence because it is one of twenty.
 *
 * ## Nothing throws, and nothing is invented
 *
 * `evidence` is `jsonb` written by whichever version of a detector ran, so every
 * read narrows (`core/findings/evidence.ts`). A field that is absent costs its
 * own cell and no other — losing a spike's average must not also lose its
 * percentage, because AC2 asks for each comparison's own figures and a row
 * showing none of them is a row that says a comparison happened and declines to
 * say what it found.
 *
 * The counterpart rule is that an absent value is never filled in. `$0.00`
 * received, "0 invoices checked" and "unit undefined" are each a statement the
 * record does not support, and the first of them is one a board member could act
 * on.
 */

export interface Figure {
  readonly label: string
  readonly value: string
  /** Set in tabular figures and right-aligned by the surface (UX-DR5). */
  readonly numeric: boolean
}

export interface Column {
  readonly label: string
  readonly numeric: boolean
}

/**
 * What was compared, as a table.
 *
 * `rows` are positional against `columns`, and a cell is `null` where the record
 * holds no value for it — rendered as nothing at all, never as a dash or a zero.
 * The alternative shape, a record per row keyed by column name, would let a row
 * silently carry a key no column names.
 */
export interface ComparisonTable {
  readonly caption: string
  readonly columns: readonly Column[]
  readonly rows: readonly (readonly (string | null)[])[]
}

export interface FindingDetailView {
  readonly id: string
  readonly severity: Severity
  readonly severityLabel: string
  readonly title: string
  /** The dashboard row's sentence, verbatim. `null` when the evidence supports none. */
  readonly summary: string | null
  readonly amount: string | null
  readonly raisedOn: string
  /** What the check as a whole recorded. Empty when it recorded nothing legible. */
  readonly figures: readonly Figure[]
  /** One row per stored comparison, or `null` when there is no table to draw. */
  readonly comparisons: ComparisonTable | null
  /**
   * Who reviewed it and when, or `null` while it is still unreviewed (AC6).
   *
   * **The same `ReviewMessage` the refusal produces, and that is the point.** A
   * board member who arrives from an old email link and one who presses the
   * control a moment too late have learned the same fact, and telling them in
   * two different sentences is the drift this story exists to prevent. Its
   * presence is also what the page branches on: a reviewed finding offers no
   * action, because the register has already answered.
   */
  readonly reviewed: ReviewMessage | null
}

/**
 * A percentage, or `null` when the record does not hold a figure.
 *
 * The validation is `decimal`'s and is shared with the dashboard row, which
 * appends the same `%` to the same stored field. The mark is added here rather
 * than stored with the value so that neither surface can print it twice.
 */
function percentage(value: unknown): string | null {
  const stored = decimal(value)
  return stored === null ? null : `${stored}%`
}

/** `YYYY-MM-DD`, and a date that actually exists. */
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function dayNumber(value: string): number | null {
  const match = CALENDAR_DATE.exec(value)
  if (match === null) return null

  const [, year, month, day] = match
  const at = Date.UTC(Number(year), Number(month) - 1, Number(day))

  // `Date.UTC` rolls 2026-02-30 forward to 2026-03-02 rather than refusing it,
  // so the only way to know the date was real is to render it back and compare.
  return new Date(at).toISOString().slice(0, 10) === value ? at : null
}

const ONE_DAY_MS = 86_400_000

/**
 * The window a finding concerns, as a board member would state it.
 *
 * **Inclusive, where the database stores it half-open.** `[2026-04-01,
 * 2026-05-01)` covers April, and printed as stored it reads as though the first
 * of May were in it — a board member checking their own records against the
 * finding would be looking at the wrong month. `core/ports/finding.ts` chose the
 * half-open form because that is what Postgres canonicalises a `daterange` into;
 * this is where it stops being a storage detail.
 *
 * `null` when the range is not one that can be stated. Migration 021's
 * `finding_period_is_bounded` makes that unreachable through the ordinary path,
 * but this reads `jsonb`-adjacent values off a row, and a window nobody can
 * state is not a window to state badly.
 */
function periodLabel(period: { readonly from: string; readonly until: string }): string | null {
  const from = typeof period?.from === 'string' ? period.from : ''
  const until = typeof period?.until === 'string' ? period.until : ''

  const start = dayNumber(from)
  const end = dayNumber(until)
  if (start === null || end === null || end <= start) return null

  // The last day the window covers, which is the day before it ends.
  const last = new Date(end - ONE_DAY_MS).toISOString().slice(0, 10)

  return last === from ? from : `${from} to ${last}`
}

/** A count as a string, or `null` — never `"0"` manufactured from an absent field. */
function counted(value: unknown): string | null {
  const count = whole(value)
  return count === null ? null : String(count)
}

/**
 * What the pair was matched on, in words.
 *
 * A rule this code does not recognise is still a fact the detector recorded, so
 * the slug is made legible rather than dropped: from the board's side a dropped
 * field is indistinguishable from one that was never stored. `known` rather
 * than a plain lookup because the key comes out of `jsonb` — `constructor`
 * would otherwise put `function Object() { [native code] }` in the cell.
 */
function matchedOn(value: unknown): string | null {
  const reason = text(value)
  if (reason === null) return null
  return known(MATCH_REASON, reason) ?? words(reason)
}

/** Drops the figures whose value the record does not support. */
function figuresOf(candidates: readonly (readonly [string, string | null, boolean])[]): Figure[] {
  return candidates.flatMap(([label, value, numeric]) =>
    value === null ? [] : [{ label, value, numeric }],
  )
}

const DUPLICATE_COLUMNS: readonly Column[] = [
  { label: 'Vendor', numeric: false },
  { label: 'Invoice', numeric: false },
  { label: 'Issued', numeric: false },
  { label: 'Amount', numeric: true },
  { label: 'Matched on', numeric: false },
  { label: 'Earlier invoice', numeric: false },
  { label: 'Earlier issued', numeric: false },
]

const SPIKE_COLUMNS: readonly Column[] = [
  { label: 'Vendor', numeric: false },
  { label: 'Invoice', numeric: false },
  { label: 'Issued', numeric: false },
  { label: 'Amount', numeric: true },
  { label: 'Average', numeric: true },
  { label: 'Invoices averaged', numeric: true },
  { label: 'Above average', numeric: true },
]

interface Laid {
  readonly figures: readonly Figure[]
  readonly comparisons: ComparisonTable | null
}

const NOTHING: Laid = { figures: [], comparisons: null }

/**
 * A table, or `null` when there is nothing to compare.
 *
 * **Never an empty table.** Headers over no rows say a comparison ran and
 * matched nothing, which is the opposite of what an absent `pairs` means — and
 * on this surface the two would look identical.
 */
function table(
  caption: string,
  columns: readonly Column[],
  rows: readonly (readonly (string | null)[])[],
): ComparisonTable | null {
  return rows.length === 0 ? null : { caption, columns, rows }
}

function layDuplicate(evidence: Readonly<Record<string, unknown>>): Laid {
  const rows = entries(evidence['pairs']).map((pair) => [
    text(pair['vendorName']),
    text(pair['invoiceNumber']),
    text(pair['issuedOn']),
    formatAmount(pair['amount']),
    matchedOn(pair['reason']),
    text(pair['priorInvoiceNumber']),
    text(pair['priorIssuedOn']),
  ])

  return {
    figures: figuresOf([['Invoices checked', counted(evidence['invoicesChecked']), true]]),
    // `matchRule` is deliberately absent. `normalised-exact` names how the
    // matcher spells invoice numbers to itself, which is a fact about this
    // code rather than about the association's invoices — and UX-DR23 wants
    // what was compared, not how the comparing was implemented.
    comparisons: table('The invoices that matched an earlier one', DUPLICATE_COLUMNS, rows),
  }
}

function laySpike(evidence: Readonly<Record<string, unknown>>): Laid {
  const rows = entries(evidence['spikes']).map((spike) => [
    text(spike['vendorName']),
    text(spike['invoiceNumber']),
    text(spike['issuedOn']),
    formatAmount(spike['amount']),
    formatAmount(spike['average']),
    counted(spike['invoicesAveraged']),
    percentage(spike['percentOverAverage']),
  ])

  const months = whole(evidence['windowMonths'])
  const threshold = counted(evidence['thresholdPercent'])

  return {
    figures: figuresOf([
      ['Invoices checked', counted(evidence['invoicesChecked']), true],
      ['Threshold', threshold === null ? null : `${threshold}%`, true],
      ['Trailing window', months === null ? null : `${months} ${months === 1 ? 'month' : 'months'}`, true],
    ]),
    comparisons: table("Invoices above their vendor's average", SPIKE_COLUMNS, rows),
  }
}

function layShortfall(evidence: Readonly<Record<string, unknown>>): Laid {
  // **Never `$0.00` received.** The commonest cause of nothing arriving against
  // a unit is a deposit nobody has uploaded yet, and a zero here reads as a
  // payment that was made and came to nothing. The dashboard row already made
  // this decision in its sentence; this is the same decision in a figure.
  const received =
    evidence['kind'] === 'not-recorded' ? 'Nothing recorded' : formatAmount(evidence['received'])

  return {
    figures: figuresOf([
      ['Unit', text(evidence['unitNumber']), false],
      ['Held by', text(evidence['holderName']), false],
      ['Expected', formatAmount(evidence['expected']), true],
      ['Received', received, evidence['kind'] !== 'not-recorded'],
      ['Shortfall', formatAmount(evidence['shortfall']), true],
      ['Instalments due', counted(evidence['instalmentsDue']), true],
      ['Evaluated on', text(evidence['evaluatedOn']), false],
    ]),
    // One unit measured against its own schedule is arithmetic, not a set of
    // comparisons — the figures above *are* what was compared. A table of one
    // row would imply there could have been others.
    comparisons: null,
  }
}

function lay(findingType: string, evidence: unknown): Laid {
  const stored = fields(evidence)

  switch (findingType) {
    case POSSIBLE_DUPLICATE_INVOICE:
      return layDuplicate(stored)
    case INVOICE_ABOVE_VENDOR_AVERAGE:
      return laySpike(stored)
    case UNIT_DUES_SHORTFALL:
      return layShortfall(stored)
    default:
      // A type from a later story: shown with its name made legible by
      // `toFindingRow`, and no evidence laid out, because this code has no idea
      // what the detector stored or what any of it would mean.
      return NOTHING
  }
}

export function toFindingDetail(finding: FindingDetail): FindingDetailView {
  const row = toFindingRow(finding)
  const laid = lay(finding.findingType, finding.evidence)

  // First, and for every finding type, because every finding has a period and
  // it frames everything below it. Added here rather than inside each `lay*`
  // function so that a detector added later cannot forget it.
  const figures = [
    ...figuresOf([['Period', periodLabel(finding.period), false]]),
    ...laid.figures,
  ]

  return {
    id: row.id,
    severity: row.severity,
    severityLabel: row.severityLabel,
    title: row.title,
    summary: row.evidenceLine,
    amount: row.amount,
    raisedOn: row.raisedOn,
    figures,
    comparisons: laid.comparisons,
    reviewed:
      finding.reviewed === null
        ? null
        : reviewMessage({
            outcome: 'already-reviewed',
            by: finding.reviewed.by,
            on: finding.reviewed.on,
          }),
  }
}
