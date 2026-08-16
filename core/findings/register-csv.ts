import { csvFile } from '../csv/cell'
import type { FindingDetail } from '../ports/finding-reader'
import { toRegisterView } from './register-view'

/**
 * The register as a CSV an auditor opens (AC5).
 *
 * ## It is the page, in a file
 *
 * Every value here comes from `toRegisterView` — the same function the surface
 * renders from — so the export cannot describe a finding differently from the
 * screen it was downloaded from. That is not tidiness: an auditor comparing the
 * board packet against the register is the entire scenario this story exists
 * for, and two wordings of one finding is exactly what they would report.
 *
 * ## The escaping is not here
 *
 * `core/csv/cell.ts` neutralises formulas and does the quoting, and it was paid
 * for twice in review on the access log. A second implementation would be a
 * second answer to "is this cell dangerous", and only one of them would stay
 * right.
 */

/**
 * The columns, in order — and the header row.
 *
 * Named for what a board member calls them rather than for the fields they came
 * from: this file is opened by somebody who has never read the schema. `id` is
 * the exception and it earns its place, because a row in a board packet that
 * cannot be traced back to the register is a citation nobody can check.
 */
export const REGISTER_COLUMNS = [
  'id',
  'finding',
  'severity',
  'evidence',
  'amount',
  'period',
  'noticed',
  'reviewed',
  'reviewedBy',
] as const

export function registerCsv(findings: readonly FindingDetail[]): string {
  // Through the view, so the file and the page cannot drift. `total` is the
  // length here because this is everything being written, not a page of it.
  const view = toRegisterView({ findings, total: findings.length })

  const rows = view.kind === 'entries' ? view.entries : []

  // **Indexed once, rather than searched per column.** The first version called
  // `findings.find` three times for every row, which at the port's ceiling of
  // 200 rows is 120,000 comparisons — microseconds, and nowhere near the denial
  // of service it was reported as, but needless work in a loop that already had
  // the answer. Raised by Argus.
  const byId = new Map(findings.map((finding) => [finding.id, finding]))

  return csvFile([
    REGISTER_COLUMNS,
    ...rows.map((entry) => {
      const source = byId.get(entry.row.id)

      return [
        entry.row.id,
        entry.row.title,
        entry.row.severityLabel,
        // Empty rather than a manufactured sentence, matching the surface: a
        // finding whose evidence supports no honest line gets none here either.
        entry.row.evidenceLine ?? '',
        // **Never `$0.00`.** A figure in a board packet is one somebody can act
        // on, and inventing it from a record that holds none is the defect the
        // dashboard row was built against.
        entry.row.amount ?? '',
        periodOf(source),
        entry.row.raisedOn,
        // `?? ''` rather than a strict null check: a port omitting the field
        // satisfies neither the type nor `=== null`, and the export is the
        // wrong place to discover that by writing "undefined" into a board
        // packet.
        source?.reviewed?.on ?? '',
        // Empty rather than invented. `board_member.display_name` is nullable.
        source?.reviewed?.by ?? '',
      ]
    }),
  ])
}

/** A day in milliseconds, for stepping back from a half-open range's end. */
const ONE_DAY_MS = 86_400_000

/**
 * The window the finding concerns, stated inclusively.
 *
 * The same conversion the detail page makes, and for the same reason: the
 * database stores `[from, until)`, and printed as stored it reads as though the
 * last day were included — so a board member checking their own records against
 * a row of the board packet would be looking at the wrong month.
 *
 * `== null` catches an absent period *and* a null one. The type forbids both,
 * and an export that crashed on one would take the whole board packet with it
 * rather than losing a cell. Raised by Argus.
 */
function periodOf(finding: FindingDetail | undefined): string {
  const period = finding?.period

  if (period == null) return ''

  const until = Date.parse(`${period.until}T00:00:00Z`)

  // A range whose end cannot be read leaves the cell empty rather than writing
  // "Invalid Date" into a document an auditor reads.
  if (Number.isNaN(until)) return ''

  const last = new Date(until - ONE_DAY_MS).toISOString().slice(0, 10)

  return last === period.from ? period.from : `${period.from} to ${last}`
}
