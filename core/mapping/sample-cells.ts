import type { TargetField } from './targets'

/**
 * One cell value per target that `validate` accepts, shared by the mapping tests.
 *
 * **Typed as `Record<TargetField, string>` on purpose, and read without a
 * fallback.** Two copies of this lived in `draft.test.ts` and `targets.test.ts`,
 * and the draft one read `CELL[target] ?? ''` — so adding a target to the
 * importer's contract would have produced an empty cell silently rather than a
 * type error. The cross-checks in both files build a real file out of these and
 * hand it to `readRows`, so a target with no valid value here is a cross-check
 * that proves nothing about that column.
 *
 * A test fixture rather than production data, but it is load-bearing for two
 * suites, which is why it is a module and not a copy. Raised by CodeRabbit.
 */
export const SAMPLE_CELLS: Record<TargetField, string> = {
  date: '2026-03-01',
  description: 'Willow Creek Landscaping',
  amount: '1240.00',
  reference: 'DEP-9912',
  unit: '12B',
  cycle: 'monthly',
  year: '2026',
}
