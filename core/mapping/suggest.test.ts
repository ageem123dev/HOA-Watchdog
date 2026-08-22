/**
 * Suggesting a column for each target the importer needs (story 5.6, Task 2).
 *
 * ## Two kinds of test here, and the second kind is not optional
 *
 * The behavioural half is ordinary: headings in, suggestions out. The other half
 * is **structural** — AC4 and AC6 are claims about what this module *cannot do*,
 * and no behavioural test can prove the absence of a credential the code never
 * reaches for. A suggester that opened a database would pass every assertion
 * about suggestions. So the boundary tests read the module's own imports, the
 * shape story 5.3 used for the shared folding and 5.5 used for "nothing is
 * stored".
 *
 * ## The cross-check is the one that keeps this honest
 *
 * Every suggestion is fed to `assign`. A suggester that can name a pairing the
 * draft refuses is a second set of rules about what a kind may be mapped to, and
 * the treasurer experiences that as a suggestion that silently does nothing.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { DOCUMENT_KINDS, type DocumentKind } from '../extraction/record'
import type { Heading } from '../extraction/headings'
import { neutralise } from '../ports/declared-members'
import { specifiersIn } from '../ports/module-specifiers'
import { assign, emptyDraft } from './draft'
import {
  MAX_HEADING_LENGTH,
  MAX_SUGGESTIBLE_HEADINGS,
  suggestColumns,
  type Suggestion,
} from './suggest'
import { targetsForKind, type TargetField } from './targets'

/** Headings as `readHeadings` produces them: 1-based, in file order. */
const headingsOf = (...texts: readonly string[]): readonly Heading[] =>
  texts.map((text, index) => ({
    position: index + 1,
    text,
    normalised: text.trim().toLowerCase(),
  }))

const positionFor = (suggestions: readonly Suggestion[], target: TargetField): number | null => {
  const found = suggestions.find((suggestion) => suggestion.target === target)
  // `undefined` and `null` mean different things here — "never mentioned" versus
  // "mentioned, no suggestion" — and AC2 is exactly that distinction, so a
  // missing entry must not quietly read as a null one.
  expect(found, `no suggestion entry for ${target}`).toBeDefined()
  return found?.position ?? null
}

// Derived, never listed again: a literal here would keep every 'for each kind'
// assertion below silently blind to a kind added to the domain. Raised by
// CodeRabbit, which found the same literal in three places.
const KINDS = DOCUMENT_KINDS

describe('a suggestion for each column the importer needs', () => {
  it('matches the headings a real export uses', () => {
    const suggestions = suggestColumns(headingsOf('Txn Date', 'Descr', 'Amt'), 'deposit')

    expect(positionFor(suggestions, 'date')).toBe(1)
    expect(positionFor(suggestions, 'description')).toBe(2)
    expect(positionFor(suggestions, 'amount')).toBe(3)
  })

  it('suggests nothing for a target no heading names, rather than omitting it', () => {
    // The whole of AC2. A treasurer looking at a required column with no
    // suggestion needs to see that it was considered and nothing was found —
    // not the same blank as a column the suggester never looked at.
    const suggestions = suggestColumns(headingsOf('Txn Date', 'Balance'), 'deposit')

    expect(positionFor(suggestions, 'date')).toBe(1)
    expect(positionFor(suggestions, 'description')).toBeNull()
    expect(positionFor(suggestions, 'amount')).toBeNull()
  })

  it.each(KINDS)('names every required target of a %s, matched or not', (kind: DocumentKind) => {
    const { required } = targetsForKind(kind)
    // Non-empty first: the loop below over an empty list would report success.
    expect(required.length).toBeGreaterThan(0)

    const suggestions = suggestColumns(headingsOf('Nothing', 'Recognisable'), kind)
    const named = suggestions.map((suggestion) => suggestion.target)

    for (const target of required) expect(named).toContain(target)
  })

  it('suggests an optional column when a heading names one', () => {
    const suggestions = suggestColumns(headingsOf('Date', 'Memo', 'Amount', 'Check No'), 'deposit')

    expect(positionFor(suggestions, 'reference')).toBe(4)
  })

  it('offers no target the kind does not publish', () => {
    // `Billing Cycle` matches `cycle`, which only a roll has. Suggested on a
    // deposit, `assign` refuses it and the treasurer sees nothing happen.
    const suggestions = suggestColumns(
      headingsOf('Date', 'Description', 'Amount', 'Billing Cycle'),
      'deposit',
    )
    const offered = new Set([
      ...targetsForKind('deposit').required,
      ...targetsForKind('deposit').optional,
    ])

    expect(suggestions.map((s) => s.target).filter((t) => !offered.has(t))).toEqual([])
  })
})

describe('a suggestion the draft would accept', () => {
  it.each(KINDS)('produces only pairings assign accepts, for a %s', (kind: DocumentKind) => {
    const headings = headingsOf(
      'Txn Date',
      'Descr',
      'Amt',
      'Unit #',
      'Billing Cycle',
      'Assessment Year',
      'Check No',
      'Balance',
    )
    const suggestions = suggestColumns(headings, kind)
    const proposed = suggestions.filter((s) => s.position !== null)

    // Non-empty first: "every proposal is accepted" is vacuously true of a
    // suggester that proposes nothing, which is the failure this guards.
    expect(proposed.length).toBeGreaterThan(0)

    let draft = emptyDraft(kind, headings.length)
    for (const suggestion of proposed) {
      const result = assign(draft, suggestion.target, suggestion.position as number)
      expect(result.ok, `assign refused ${suggestion.target}@${suggestion.position}`).toBe(true)
      if (result.ok) draft = result.draft
    }
  })

  it('claims a column once, when two headings name the same target', () => {
    // `Amt` and `Amount` in one file is ordinary. Suggest both and `assign`
    // refuses the second as `source-already-paired`.
    const suggestions = suggestColumns(headingsOf('Date', 'Amt', 'Amount'), 'deposit')

    expect(positionFor(suggestions, 'amount')).toBe(2)
    expect(suggestions.filter((s) => s.target === 'amount')).toHaveLength(1)
  })

  it('leaves the second of two identical headings unsuggested', () => {
    /**
     * The first version of this asserted that the suggested positions were
     * distinct - which is true of *any* implementation given headings with
     * distinct positions, so it survived deleting the guard it was written for.
     * A distinctness assertion over an input that cannot collide is the vacuity
     * this project keeps finding.
     *
     * What is actually observable: column 2 is claimed by nothing.
     */
    const suggestions = suggestColumns(headingsOf('Date', 'Date', 'Amount'), 'deposit')

    expect(positionFor(suggestions, 'date')).toBe(1)
    expect(suggestions.filter((s) => s.position === 2)).toEqual([])
    // And column 3 is still reached. Without this the test passes for a
    // suggester that stopped reading after the first heading, which is not the
    // behaviour it is named for. Raised by `ocr`.
    expect(positionFor(suggestions, 'amount')).toBe(3)
  })

  it('takes the first heading in file order when several match', () => {
    // Not "whichever the implementation happened to reach": the treasurer reads
    // their file left to right, and a suggestion pointing at column 7 when
    // column 2 says the same thing looks arbitrary.
    const suggestions = suggestColumns(headingsOf('Total', 'Amt', 'Amount'), 'deposit')

    expect(positionFor(suggestions, 'amount')).toBe(1)
  })
})

describe('the bounds, which exist before anything crosses them', () => {
  it('caps how many headings it will consider', () => {
    const texts = [
      ...Array.from({ length: MAX_SUGGESTIBLE_HEADINGS }, (_, i) => `Filler ${i}`),
      'Amount',
    ]
    const suggestions = suggestColumns(headingsOf(...texts), 'deposit')

    // The `Amount` sits one past the cap. Unbounded, story 5.6b hands a model a
    // list with no ceiling on it; bounded, this is where that stops.
    expect(positionFor(suggestions, 'amount')).toBeNull()
  })

  it('considers the last heading within the cap', () => {
    // The other side of the boundary. Without this, a cap of zero passes the
    // test above.
    const texts = [
      ...Array.from({ length: MAX_SUGGESTIBLE_HEADINGS - 1 }, (_, i) => `Filler ${i}`),
      'Amount',
    ]
    const suggestions = suggestColumns(headingsOf(...texts), 'deposit')

    expect(positionFor(suggestions, 'amount')).toBe(MAX_SUGGESTIBLE_HEADINGS)
  })

  it('ignores a heading longer than the cap', () => {
    const overlong = 'Amount'.padEnd(MAX_HEADING_LENGTH + 1, '_')
    const suggestions = suggestColumns(headingsOf(overlong), 'deposit')

    expect(positionFor(suggestions, 'amount')).toBeNull()
  })

  it('considers a heading exactly at the cap', () => {
    // Measured in the unit the cap claims. Story 5.5's byte bound counted UTF-16
    // code units and a 256 KB payload weighed 688 KB; this one counts the
    // characters it says it counts, and the test names both sides of the edge.
    const exact = 'Amount'.padEnd(MAX_HEADING_LENGTH, '_')

    expect(exact).toHaveLength(MAX_HEADING_LENGTH)
    // Padding makes it unmatchable, so assert the cap by a heading that *is*
    // matchable at exactly the limit: trailing punctuation is stripped by
    // `matchKey`, so pad with a character it ignores.
    const padded = 'Amount'.padEnd(MAX_HEADING_LENGTH, '.')
    const suggestions = suggestColumns(headingsOf(padded), 'deposit')

    expect(padded).toHaveLength(MAX_HEADING_LENGTH)
    expect(positionFor(suggestions, 'amount')).toBe(1)
  })

  it('publishes both caps as named constants', () => {
    // AC5 names them, because a magic number in a slice is a bound nobody can
    // find when 5.6b needs to know what it is.
    expect(MAX_SUGGESTIBLE_HEADINGS).toBeGreaterThan(0)
    expect(MAX_HEADING_LENGTH).toBeGreaterThan(0)
  })

  it('survives a heading list far past the cap without reading it all', () => {
    const many = Array.from({ length: MAX_SUGGESTIBLE_HEADINGS * 10 }, () => 'Balance')

    expect(() => suggestColumns(headingsOf(...many, 'Amount'), 'deposit')).not.toThrow()
  })
})

describe('the boundary AD-4 and AD-8 rest on', () => {
  const SOURCE = readFileSync(fileURLToPath(new URL('./suggest.ts', import.meta.url)), 'utf8')

  /**
   * The module's code with its prose removed.
   *
   * **Scanning a whole file for a word finds the comments explaining why the
   * word matters.** This module's own doc comment says the control "governs what
   * is *stored*" and names "a store, a client" as what it must not reach — and
   * the first version of the scan below failed on exactly that. Task 1 hit the
   * same shape twice, and the design-token guard once flagged the word "green"
   * in prose. So: blank the comments, then look at what is left.
   *
   * `neutralise` is `declared-members.ts`'s, which keeps string literals while
   * blanking comments and has its own tests for the way a naive `//` strip eats
   * the closing quote of `'https://example.com'`.
   */
  const CODE = neutralise(SOURCE).commentsBlanked

  /**
   * Every specifier this module loads.
   *
   * **`specifiersIn`, not a private regex.** The first version here matched only
   * `from '…'` — the pattern `boundary.test.ts` records as missing a side-effect
   * import, a dynamic `import()`, a `require()` and a formatter-wrapped list.
   * Three copies of the hardened one already existed in this repo and had
   * drifted apart; a fourth would be this project's most-repeated defect in the
   * place it costs most, since this is the AD-8 control.
   */
  const IMPORTS = specifiersIn(SOURCE)

  it('reads its imports at all', () => {
    // The assertions below are filters over this list, and a filter over an
    // empty list passes. This project has shipped that exact vacuity twice.
    expect(IMPORTS.length).toBeGreaterThan(0)
  })

  it('imports nothing but the domain vocabulary it matches against', () => {
    /**
     * **AC4, and it is the AD-8 control.** Human confirmation governs what is
     * *stored*; it does not govern what the runtime is *able to do* on the way
     * there. A suggester that can reach a store or a client is one an injected
     * heading could aim, whatever the treasurer later confirms.
     *
     * An allow-list, not a deny-list: a deny-list is a guess about what the next
     * dangerous import will be called.
     */
    const allowed = [
      '../extraction/headings',
      '../extraction/record',
      './heading-match',
      './targets',
    ]

    expect(IMPORTS.filter((specifier) => !allowed.includes(specifier))).toEqual([])
  })

  it('reaches no store, client, credential or network', () => {
    // Belt and braces over the allow-list above: this one fails on a *relative*
    // path that starts pointing somewhere new, and names what it is looking for
    // so the failure explains itself.
    for (const forbidden of ['store', 'repositor', 'client', 'prisma', 'fetch(', 'process.env']) {
      expect(CODE.toLowerCase(), `"${forbidden}" appears in the code`).not.toContain(forbidden)
    }

    // The stripper itself must not be what makes this pass. If it ate the code,
    // every scan here reports clean on nothing at all.
    expect(CODE).toContain('export function suggestColumns')
  })

  it('does not log or retain the headings it is given', () => {
    // **AC6.** These are the association's own column names out of its own file.
    // A structural check because "it was not written anywhere" has no observable
    // form — you cannot assert the absence of a log line from outside.
    expect(CODE).not.toContain('console')
  })

  it('keeps nothing between calls', () => {
    // The behavioural complement to the check above: module-level state would
    // make the second call see the first one's headings.
    const first = suggestColumns(headingsOf('Date', 'Description', 'Amount'), 'deposit')
    const second = suggestColumns(headingsOf('Balance'), 'deposit')

    expect(positionFor(first, 'amount')).toBe(3)
    expect(positionFor(second, 'amount')).toBeNull()
    expect(positionFor(second, 'date')).toBeNull()
  })
})

describe('what a real file actually contains', () => {
  it('suggests nothing for a blank heading', () => {
    // `readHeadings` reports blanks by position rather than refusing the file,
    // so they arrive here.
    const suggestions = suggestColumns(headingsOf('Date', '', 'Amount'), 'deposit')

    expect(positionFor(suggestions, 'description')).toBeNull()
    expect(suggestions.filter((s) => s.position === 2)).toEqual([])
  })

  it('suggests nothing at all for a file it recognises nothing in', () => {
    const suggestions = suggestColumns(headingsOf('Col1', 'Col2', 'Col3'), 'deposit')

    expect(suggestions.filter((s) => s.position !== null)).toEqual([])
    // And still says so for every required target, rather than returning [].
    expect(suggestions.length).toBeGreaterThan(0)
  })

  it('suggests nothing for no headings at all', () => {
    const suggestions = suggestColumns([], 'deposit')

    expect(suggestions.filter((s) => s.position !== null)).toEqual([])
    expect(positionFor(suggestions, 'amount')).toBeNull()
  })

  it('refuses a kind the importer does not have', () => {
    // `targetsForKind` throws rather than defaulting, and this must not soften
    // that into a plausible-looking empty suggestion list.
    expect(() => suggestColumns(headingsOf('Date'), 'ledger' as DocumentKind)).toThrow()
  })
})
