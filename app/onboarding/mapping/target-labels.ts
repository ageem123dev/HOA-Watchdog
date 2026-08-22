import type { TargetField } from '@/core/mapping/targets'

/**
 * What a treasurer calls each of the importer's columns.
 *
 * **One copy, deliberately.** The pairing surface and the preview both name
 * these fields, and they lived as two identical literals until `ocr` pointed it
 * out. Identical is not the risk; the day one of them changes is. The symptom
 * then is a treasurer told to map "Billing cycle" on one panel and shown
 * "Cycle" on the other, with nothing to say they are the same column — the same
 * defect shape story 5.3 found in a duplicated `trim().toLowerCase()`.
 *
 * `Record<TargetField, string>` rather than a partial: a target added to the
 * importer's contract with no label here is a type error, not a blank cell.
 */
export const TARGET_LABELS: Readonly<Record<TargetField, string>> = {
  date: 'Date',
  description: 'Description',
  amount: 'Amount',
  reference: 'Reference',
  unit: 'Unit',
  cycle: 'Billing cycle',
  year: 'Year',
}
