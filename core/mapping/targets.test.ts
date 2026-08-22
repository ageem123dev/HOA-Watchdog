/**
 * The targets a kind actually has (story 5.4, AC1).
 *
 * The examples below are cheap and would all pass against a hand-written list
 * that happened to be right today. The block that carries the weight is
 * *"agrees with the importer"* — it builds a file out of the returned lists and
 * hands it to `readRows`. Two implementations that disagree cannot both pass,
 * whatever either source file says.
 *
 * That shape is story 5.3's lesson, arrived at the expensive way: a structural
 * check written to prove two modules shared a folding was satisfied by an import
 * the module never used.
 */

import { describe, expect, it } from 'vitest'

import { DOCUMENT_KINDS, KINDS_WITH_UNIT_REFERENCE, type DocumentKind } from '../extraction/record'
import { readRows } from '../extraction/tabular'
import { ROLL_REQUIRED_HEADERS } from '../extraction/roll'
import { targetsForKind, UnknownDocumentKindError, type TargetField } from './targets'

/**
 * A cell that satisfies `validate` for each target, so the only reason a row can
 * fail is a column the mapping got wrong.
 */
const CELL: Record<TargetField, string> = {
  date: '2026-03-01',
  description: 'Willow Creek Landscaping',
  amount: '1240.00',
  reference: 'DEP-9912',
  unit: '12B',
  cycle: 'monthly',
  year: '2026',
}

const fileFrom = (targets: readonly TargetField[]): readonly (readonly string[])[] => [
  [...targets],
  targets.map((target) => CELL[target]),
]

describe('the targets a kind actually has', () => {
  describe('agrees with the importer', () => {
    it.each([...DOCUMENT_KINDS])(
      'a file of exactly the required targets is one readRows accepts (%s)',
      (kind) => {
        const result = readRows(fileFrom(targetsForKind(kind).required), kind)

        // Named rather than a bare `toBe(true)`: a refusal should say which
        // column the two disagree about, not merely that they do.
        expect(result.ok ? [] : result.problems).toEqual([])
        expect(result.ok).toBe(true)
      },
    )

    it.each([...DOCUMENT_KINDS])(
      'dropping any one required target makes readRows refuse (%s)',
      (kind) => {
        const { required } = targetsForKind(kind)

        // Zero-one-many: this also asserts `required` is non-empty, because a
        // loop over nothing reports success. Story 5.3 shipped exactly that
        // and it passed against an empty list.
        expect(required.length).toBeGreaterThan(0)

        for (const dropped of required) {
          const withoutIt = required.filter((target) => target !== dropped)

          const refused = readRows(fileFrom(withoutIt), kind)

          expect(refused.ok).toBe(false)
          // *Which* header, not merely that it refused: a `readRows` that turned
          // the file away for some unrelated reason would satisfy `ok === false`
          // and tell us nothing about the target list. Raised by CodeRabbit.
          expect(
            refused.ok ? [] : refused.problems.flatMap((p) => ('expected' in p ? p.expected : [])),
          ).toContain(dropped)
        }
      },
    )

    it.each([...DOCUMENT_KINDS])(
      'a file of every target, required and optional, is still one readRows accepts (%s)',
      (kind) => {
        const { required, optional } = targetsForKind(kind)

        expect(readRows(fileFrom([...required, ...optional]), kind).ok).toBe(true)
      },
    )
  })

  describe('a target nothing reads is never offered', () => {
    it.each([...DOCUMENT_KINDS])('never offers the retired `type` column (%s)', (kind) => {
      const { required, optional } = targetsForKind(kind)

      // `readRows` refuses a file carrying it outright (`kind-is-not-a-column`),
      // so offering it as a target would let a treasurer break the whole upload
      // from inside the wizard.
      expect([...required, ...optional]).not.toContain('type')
    })

    it.each([...DOCUMENT_KINDS])(
      'offers `unit` exactly when the importer reads one (%s)',
      (kind) => {
        const { required, optional } = targetsForKind(kind)
        const offered = [...required, ...optional].includes('unit')

        // `readRows` reads the `unit` column only for these kinds, and
        // `validate` refuses a unit reference on any other. Offered elsewhere,
        // the pairing looks done and does nothing.
        expect(offered).toBe((KINDS_WITH_UNIT_REFERENCE as readonly string[]).includes(kind))
      },
    )

    it.each([...DOCUMENT_KINDS])(
      'offers the roll-only columns to the roll and to nothing else (%s)',
      (kind) => {
        const { required, optional } = targetsForKind(kind)
        const offered = [...required, ...optional]

        for (const rollOnly of ['cycle', 'year'] as const) {
          expect(offered.includes(rollOnly)).toBe(kind === 'assessment_roll')
        }
      },
    )
  })

  describe('required and optional are what they say', () => {
    it('makes the roll columns required of a roll, not optional', () => {
      const { required, optional } = targetsForKind('assessment_roll')

      // The inversion that matters: as optional, the mapping reports complete
      // and `readRows` then refuses the file for missing headers — a treasurer
      // told they were finished and then told they were not.
      for (const rollHeader of ROLL_REQUIRED_HEADERS) {
        expect(required).toContain(rollHeader)
        expect(optional).not.toContain(rollHeader)
      }
    })

    it('leaves `unit` optional for a deposit, where a line naming none is held rather than refused', () => {
      const { required, optional } = targetsForKind('deposit')

      expect(optional).toContain('unit')
      expect(required).not.toContain('unit')
    })

    it.each([...DOCUMENT_KINDS])('lists no target twice (%s)', (kind) => {
      const { required, optional } = targetsForKind(kind)
      const offered = [...required, ...optional]

      // Disjoint and internally unique: a target in both lists is shown twice
      // and counted twice in "what remains".
      expect(new Set(offered).size).toBe(offered.length)
    })
  })

  describe('an unrecognised kind', () => {
    it('is refused rather than answered with a default list', () => {
      // A default would make a typo produce a plausible-looking wizard over a
      // kind the importer will refuse.
      expect(() => targetsForKind('bank_feed' as DocumentKind)).toThrow(UnknownDocumentKindError)
    })
  })
})
