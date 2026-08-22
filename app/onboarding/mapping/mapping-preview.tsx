'use client'

import type { DraftMapping } from '@/core/mapping/draft'
import { previewMapping } from '@/core/mapping/preview'
import { mappedTargets } from '@/core/mapping/apply'
import type { TargetField } from '@/core/mapping/targets'
import { TARGET_LABELS } from './target-labels'

/**
 * What this mapping would produce — the last cheap moment before anything writes.
 *
 * ## The counts are not decoration
 *
 * UX-DR24 forbids reassurance without a count of what was checked, and this
 * screen is a *sample* of a sample: it reads at most twenty rows of a file that
 * may hold hundreds. "Your mapping looks right" would be a claim about twenty
 * rows wearing the clothes of a claim about the file. "Read 20 of 143 rows" is
 * something a treasurer can weigh.
 *
 * ## A refusal is a refusal, not a status
 *
 * `readRows` refuses the whole document if any row is bad, so there is no
 * "mostly fine" to render. The refused branch says the file would be refused,
 * names every offending row, and shows no parsed values beside them.
 */

/** `ExtractionRecord`'s field for each target — the vocabulary differs on purpose. */
const RECORD_FIELD: Readonly<
  Partial<
    Record<
      TargetField,
      'issuedOn' | 'vendorName' | 'totalAmount' | 'documentNumber' | 'unitReference'
    >
  >
> = {
  date: 'issuedOn',
  description: 'vendorName',
  amount: 'totalAmount',
  reference: 'documentNumber',
  unit: 'unitReference',
}

/**
 * `cycle` and `year` live on the **roll row**, not the extraction record.
 *
 * They were left out of the table at first, and Argus caught it on the branch
 * review: they are precisely the two columns that make a roll a roll, so a
 * treasurer previewing one could see everything except the cadence they bill on
 * and the year it is for. `readRows` populates `records` *and* `rollRows` for a
 * roll — one of each per data row, in step — so the two are read side by side.
 */
const ROLL_FIELD: Readonly<Partial<Record<TargetField, 'billingCycle' | 'assessmentYear'>>> = {
  cycle: 'billingCycle',
  year: 'assessmentYear',
}

export interface MappingPreviewProps {
  readonly draft: DraftMapping
  readonly rows: readonly (readonly string[])[]
  readonly totalDataRows: number
}

export function MappingPreview({ draft, rows, totalDataRows }: MappingPreviewProps) {
  // Derived during render, so the preview can never describe a mapping the
  // treasurer has already changed.
  const preview = previewMapping(rows, draft, totalDataRows)

  if (preview.status === 'incomplete') {
    return (
      <section aria-labelledby="preview-title" style={styles.panel}>
        <h2 id="preview-title" style={styles.heading}>
          What this would produce
        </h2>
        <p style={styles.body}>
          Nothing yet — {preview.missing.map((target) => TARGET_LABELS[target]).join(', ')} still
          {preview.missing.length === 1 ? ' needs' : ' need'} a column.
        </p>
      </section>
    )
  }

  const { read } = preview.counts
  // **The file cannot hold fewer rows than were read from it.** `totalDataRows`
  // arrives as an independent number, and a caller that passed rows without it
  // produced "Read all 2 of 0 rows." Clamping here keeps the two counts from
  // contradicting each other whatever the caller does. Raised by CodeRabbit.
  const total = Math.max(preview.counts.total, read)
  /**
   * The sentence UX-DR24 exists for.
   *
   * Never "looks right" on its own: this reads at most twenty rows of a file
   * that may hold hundreds, so any claim has to carry what it was judged on.
   */
  const readOf =
    total > read ? `Read the first ${read} of ${total} rows.` : `Read all ${read} of ${total} rows.`

  if (preview.status === 'would-refuse') {
    return (
      <section aria-labelledby="preview-title" style={styles.panel}>
        <h2 id="preview-title" style={styles.heading}>
          What this would produce
        </h2>
        {/*
          A refusal, not a status. One bad row fails the whole document, so
          there is no "mostly fine" here — and no parsed values are rendered
          beside it, or the treasurer concludes the bulk of their data imported.
        */}
        <p role="alert" style={styles.body}>
          This file would be refused. {readOf}
        </p>
        <ul style={styles.list}>
          {preview.problems.map((problem, index) => (
            <li key={`${problem.reason}-${'row' in problem ? problem.row : index}`}>
              {'row' in problem ? `Row ${problem.row}: ` : ''}
              {REFUSAL_TEXT[problem.reason] ?? problem.reason}
            </li>
          ))}
        </ul>
      </section>
    )
  }

  const targets = mappedTargets(draft).filter(
    (target) => RECORD_FIELD[target] !== undefined || ROLL_FIELD[target] !== undefined,
  )

  return (
    <section aria-labelledby="preview-title" style={styles.panel}>
      <h2 id="preview-title" style={styles.heading}>
        What this would produce
      </h2>
      <p style={styles.body}>
        {readOf} All {read} would import.
      </p>
      <table style={styles.table}>
        <caption style={styles.caption}>Your rows, as the importer would read them</caption>
        <thead>
          <tr>
            {targets.map((target) => (
              <th key={target} scope="col" style={styles.cell}>
                {TARGET_LABELS[target]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.records.map((record, index) => {
            // Same index, because `readRows` pushes one of each per data row and
            // returns `ok: false` the moment a row is defective.
            const rollRow = preview.rollRows[index]

            return (
              <tr key={index}>
                {targets.map((target) => {
                  const recordField = RECORD_FIELD[target]
                  const rollField = ROLL_FIELD[target]

                  return (
                    <td key={target} style={styles.cell}>
                      {recordField !== undefined
                        ? (record[recordField] ?? '')
                        : rollField === undefined || rollRow === undefined
                          ? ''
                          : String(rollRow[rollField])}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

/** A sentence per refusal reason, so the screen never shows a bare enum. */
const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  'invalid-row': 'this row could not be read with the columns as mapped.',
  'duplicate-unit': 'this unit and year already appear on an earlier row.',
  'missing-headers': 'a column the importer needs has no mapping.',
  'duplicate-headers': 'two columns map to the same field.',
  'no-rows': 'the sample has no rows to read.',
  'unknown-kind': 'this kind of import is not one the importer publishes.',
  'kind-is-not-a-column': 'the file carries a `type` column, which is no longer read.',
  'unreadable-file': 'the sample could not be read.',
}

const styles = {
  panel: { display: 'flex', flexDirection: 'column', gap: 'var(--space-inline)' },
  heading: { fontSize: 'var(--type-scale-label)', margin: 0 },
  body: { margin: 0 },
  list: { margin: 0, paddingInlineStart: 'var(--space-block)' },
  table: { borderCollapse: 'collapse', width: '100%' },
  caption: { textAlign: 'left', color: 'var(--color-ink-muted)' },
  // No fixed height: rows flex for user text spacing (WCAG 1.4.12).
  cell: { textAlign: 'left', padding: '0.25rem 0.5rem', verticalAlign: 'top' },
} satisfies Record<string, React.CSSProperties>
