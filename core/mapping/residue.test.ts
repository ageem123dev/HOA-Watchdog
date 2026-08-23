/**
 * What deterministic matching could not answer (story 5.6b, Task 1 — AC1).
 *
 * ## Derived, never recomputed
 *
 * The residue is read off `suggestColumns`'s own answer rather than worked out
 * again. A second implementation of "what matched" would agree on the day it was
 * written and drift the day the alias table changes — and the symptom is a model
 * asked about a column that is already paired, which `assign` then refuses and
 * the treasurer experiences as nothing happening.
 *
 * That is the defect shape this codebase is most prone to: `targetsForKind`
 * versus a hand list, `TARGET_LABELS` twice, the import scanner in four copies,
 * and the five document kinds written out three times in story 5.6. The test
 * `moves with the matcher` below is the one that holds it.
 *
 * ## Why this exists at all
 *
 * AC1: the model is asked only about the residue, and a file the deterministic
 * matcher fully resolves produces no model call. An empty residue is that
 * signal, so "empty" has to mean exactly the right thing.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { neutralise } from '../ports/declared-members'

import { DOCUMENT_KINDS, type DocumentKind } from '../extraction/record'
import type { Heading } from '../extraction/headings'
import { residueOf } from './residue'
import { MAX_HEADING_LENGTH, MAX_SUGGESTIBLE_HEADINGS, suggestColumns } from './suggest'
import { targetsForKind, UnknownDocumentKindError } from './targets'

const headingsOf = (...texts: readonly string[]): readonly Heading[] =>
  texts.map((text, index) => ({
    position: index + 1,
    text,
    normalised: text.trim().toLowerCase(),
  }))

/** A deposit whose three required columns a person would recognise on sight. */
const FULLY_MATCHED = headingsOf('Txn Date', 'Descr', 'Amt')

describe('what is left over', () => {
  it('is empty for a file the matcher fully resolved', () => {
    // The AC1 signal. If this is ever non-empty for a matched file, every such
    // file costs a model call it did not need.
    const residue = residueOf(FULLY_MATCHED, 'deposit')

    expect(residue.unfilled).toEqual([])
    expect(residue.headings).toEqual([])
  })

  it('names the required targets no heading filled', () => {
    const residue = residueOf(headingsOf('Txn Date', 'Mystery', 'Whatsit'), 'deposit')

    expect([...residue.unfilled].sort()).toEqual(['amount', 'description'])
  })

  it('names the headings no target claimed', () => {
    const residue = residueOf(headingsOf('Txn Date', 'Mystery', 'Whatsit'), 'deposit')

    expect(residue.headings.map((h) => h.text)).toEqual(['Mystery', 'Whatsit'])
    // Positions travel, because a suggestion is a position and the model's
    // answer has to be checkable against what it was offered.
    expect(residue.headings.map((h) => h.position)).toEqual([2, 3])
  })

  it('never reports a heading that was matched', () => {
    // 1b: asking the model about a column already paired produces a suggestion
    // `assign` refuses, which the treasurer sees as nothing happening.
    const residue = residueOf(headingsOf('Txn Date', 'Descr', 'Amt', 'Mystery'), 'deposit')

    expect(residue.headings.map((h) => h.text)).toEqual(['Mystery'])
  })

  it('counts only required targets as unfilled', () => {
    /**
     * 1c. `unit` and `reference` are optional on a deposit and absent here. If
     * optional targets counted, the residue would never empty for an ordinary
     * three-column export — every file would cost a model call, and the model
     * would be pushed to guess columns nobody needs.
     */
    const residue = residueOf(FULLY_MATCHED, 'deposit')
    const { optional } = targetsForKind('deposit')

    expect(optional.length).toBeGreaterThan(0)
    expect(residue.unfilled).toEqual([])
  })
})

describe('it moves with the matcher, rather than beside it', () => {
  it('drops a target from the residue exactly when the matcher starts filling it', () => {
    /**
     * **The test this file exists for.** `Amt` is an alias the matcher knows;
     * `Whatsit` is not. Swapping one for the other must move `amount` between
     * "filled" and "unfilled" — and the residue must agree with
     * `suggestColumns` in both directions, because it is derived from it.
     *
     * A recomputed residue passes the assertions above and fails this one the
     * day the alias table changes.
     */
    const known = residueOf(headingsOf('Txn Date', 'Descr', 'Amt'), 'deposit')
    const unknown = residueOf(headingsOf('Txn Date', 'Descr', 'Whatsit'), 'deposit')

    expect(known.unfilled).not.toContain('amount')
    expect(unknown.unfilled).toContain('amount')
    expect(unknown.headings.map((h) => h.text)).toEqual(['Whatsit'])
  })

  it('reads the matcher rather than re-deriving it', () => {
    /**
     * **The structural half, and it is needed because parity cannot see this.**
     *
     * Recomputing the residue with `targetForHeading` directly is behaviourally
     * identical *today* — verified, not assumed: that fork passes all sixteen
     * tests in this file, including the one above, because the one above
     * compares two calls of `residueOf` and is therefore true of any
     * implementation. Exactly the trap story 5.6 Task 1 fell into with a forked
     * folding, and story 5.3 before it.
     *
     * What the fork loses is the guarantee. Change the alias table and a
     * recomputed residue can disagree with the suggestion it is supposed to
     * complement — and the symptom is a model asked about a column already
     * paired, which `assign` refuses and the treasurer sees as nothing
     * happening.
     *
     * Scanned with comments blanked, because the doc comment above `residueOf`
     * necessarily discusses `targetForHeading` to explain why it is not used.
     * Story 5.6 hit that three times.
     */
    const source = readFileSync(fileURLToPath(new URL('./residue.ts', import.meta.url)), 'utf8')
    const code = neutralise(source).commentsBlanked

    expect(code).toContain('suggestColumns(')
    expect(code).not.toContain('targetForHeading')
    // The blanker must not be what makes this pass.
    expect(code).toContain('export function residueOf')
  })

  it.each(DOCUMENT_KINDS)(
    'accounts for every required target of a %s exactly once',
    (kind: DocumentKind) => {
      // The cross-check: filled or unfilled, never both, never neither.
      const headings = headingsOf('Txn Date', 'Amt', 'Mystery', 'Unit #')
      const suggestions = suggestColumns(headings, kind)
      const residue = residueOf(headings, kind)
      const { required } = targetsForKind(kind)

      expect(required.length).toBeGreaterThan(0)

      const filled = suggestions
        .filter((s) => s.position !== null && required.includes(s.target))
        .map((s) => s.target)

      for (const target of required) {
        const isFilled = filled.includes(target)
        const isUnfilled = residue.unfilled.includes(target)

        expect(isFilled !== isUnfilled, `${kind}/${target} filled=${isFilled} unfilled=${isUnfilled}`).toBe(
          true,
        )
      }
    },
  )
})

describe('the bounds the port already published', () => {
  it('ignores a heading past the count cap', () => {
    // 1d: the caps live at the port. A residue that ignored them would hand
    // story 5.6b exactly what story 5.6 bounded.
    const texts = [
      ...Array.from({ length: MAX_SUGGESTIBLE_HEADINGS }, (_, i) => `Filler ${i}`),
      'Mystery',
    ]
    const residue = residueOf(headingsOf(...texts), 'deposit')

    expect(residue.headings.map((h) => h.text)).not.toContain('Mystery')
  })

  it('ignores a heading longer than the length cap', () => {
    const overlong = 'Mystery'.padEnd(MAX_HEADING_LENGTH + 1, '_')
    const residue = residueOf(headingsOf(overlong), 'deposit')

    expect(residue.headings).toEqual([])
  })

  it('ignores a blank heading', () => {
    // `readHeadings` reports blanks rather than refusing the file, so they
    // arrive here — and there is nothing for a model to say about one.
    const residue = residueOf(headingsOf('Txn Date', '', '   '), 'deposit')

    expect(residue.headings).toEqual([])
  })

  it('imports the caps rather than restating them', () => {
    /**
     * The name claims something the value assertions cannot show: two
     * `toBeGreaterThan(0)` checks pass just as happily against numbers written
     * out again inside `residue.ts`. AC7 is "no new magic numbers", and that is
     * a fact about the source. Raised by CodeRabbit.
     */
    const source = readFileSync(fileURLToPath(new URL('./residue.ts', import.meta.url)), 'utf8')
    const code = neutralise(source).commentsBlanked

    expect(code).toContain('MAX_SUGGESTIBLE_HEADINGS')
    expect(code).toContain('MAX_HEADING_LENGTH')
    // Imported from the port, not declared here.
    expect(code).not.toContain('const MAX_SUGGESTIBLE_HEADINGS')
    expect(code).not.toContain('const MAX_HEADING_LENGTH')
    // The blanker must not be what makes this pass.
    expect(code).toContain('export function residueOf')

    expect(MAX_SUGGESTIBLE_HEADINGS).toBeGreaterThan(0)
    expect(MAX_HEADING_LENGTH).toBeGreaterThan(0)
  })
})

describe('a kind the importer does not have', () => {
  it('throws rather than reporting an empty residue', () => {
    // 1f: an empty residue reads as "nothing to ask about", which would make a
    // mistyped kind look like a fully-matched file.
    expect(() => residueOf(headingsOf('Date'), 'ledger' as DocumentKind)).toThrow(
      UnknownDocumentKindError,
    )
  })
})
