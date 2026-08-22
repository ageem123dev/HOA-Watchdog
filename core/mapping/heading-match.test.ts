/**
 * Matching a heading to the importer's column (story 5.6, AC1).
 *
 * **The headings here are the shapes epics.md names** — `Txn Date`, `Descr`,
 * `Amt`, `Unit #`, `Memo` — not spellings invented to suit the implementation.
 * A matcher tested only against headings someone chose after writing it proves
 * that it matches itself.
 *
 * The cross-check is the one that keeps the table honest: for every
 * `TargetField` the importer publishes, matching its own canonical name returns
 * that target. A table that drifted from the importer's vocabulary fails it
 * without anyone maintaining a second list.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { normaliseHeading } from '../extraction/headings'
import { HEADING_ALIASES, matchKey, targetForHeading } from './heading-match'
import { targetsForKind, type TargetField } from './targets'

/** Every target the importer publishes, across all kinds. */
const ALL_TARGETS: readonly TargetField[] = [
  ...new Set(
    (['deposit', 'assessment_roll', 'invoice', 'statement', 'other'] as const).flatMap((kind) => {
      const { required, optional } = targetsForKind(kind)
      return [...required, ...optional]
    }),
  ),
]

describe('the fixture is the vocabulary the importer actually has', () => {
  it('covers every target across every kind', () => {
    // Non-empty first: every "for each target" assertion below is a loop, and a
    // loop over nothing reports success.
    expect(ALL_TARGETS.length).toBeGreaterThan(0)
    expect(ALL_TARGETS).toContain('date')
    expect(ALL_TARGETS).toContain('cycle')
  })
})

describe('the cross-check: a target names itself', () => {
  it.each(ALL_TARGETS)('matches the canonical name of %s to itself', (target) => {
    // If the alias table drifts from `targetsForKind`, this fails — no second
    // list to maintain, and no way for the two to disagree quietly.
    expect(targetForHeading(target)).toBe(target)
  })
})

describe('the abbreviations real exports use', () => {
  it.each([
    ['Txn Date', 'date'],
    ['Transaction Date', 'date'],
    ['Posted', 'date'],
    ['Descr', 'description'],
    ['Description', 'description'],
    ['Memo', 'description'],
    ['Payee', 'description'],
    ['Amt', 'amount'],
    ['Amount', 'amount'],
    ['Unit #', 'unit'],
    ['Unit No', 'unit'],
    ['Ref', 'reference'],
    ['Reference', 'reference'],
  ] as const)('matches %s to %s', (heading, target) => {
    expect(targetForHeading(heading)).toBe(target)
  })
})

describe('case, space and punctuation do not defeat a match', () => {
  it.each(['  AMOUNT  ', 'Amount:', 'amount.', 'A M O U N T', '"Amount"', 'Amount ', 'aMoUnT'])(
    'matches %s to amount',
    (heading) => {
      expect(targetForHeading(heading)).toBe('amount')
    },
  )

  it('agrees with the shared folding wherever the two overlap', () => {
    // Observed parity: on a heading with no punctuation, matching and the
    // importer's own folding must produce the same string. This is the
    // behavioural half.
    for (const heading of ['  Amount  ', 'AMOUNT', 'amount', 'Unit']) {
      expect(matchKey(heading)).toBe(normaliseHeading(heading))
    }
  })

  it('uses the shared folding rather than a copy of it', () => {
    /**
     * The structural half, and it is needed because parity cannot see this one.
     * Stripping non-alphanumerics subsumes `trim()`, so a fork written as
     * `heading.toLowerCase().replace(...)` behaves *identically today* — the
     * mutation survives every behavioural assertion. What it loses is the
     * guarantee: change `normaliseHeading` and the wizard silently stops
     * agreeing with `readRows` about what a heading is.
     *
     * Story 5.3 landed on exactly this pair — "neither alone is sufficient:
     * parity cannot see a copy that agrees on the forms it names, and structure
     * cannot see behaviour."
     */
    const source = readFileSync(
      fileURLToPath(new URL('./heading-match.ts', import.meta.url)),
      'utf8',
    )
    // The body of `matchKey`, not the whole file: the doc comment above it
    // explains what `normaliseHeading` does and necessarily quotes the folding,
    // so a file-wide scan matches prose rather than code. The first version of
    // this check did exactly that and failed on its own comment.
    const body = source.slice(
      source.indexOf('export function matchKey'),
      source.indexOf('}', source.indexOf('export function matchKey')),
    )

    expect(body).toContain('normaliseHeading(')
    expect(body).not.toContain('toLowerCase')
    expect(source).toContain("import { normaliseHeading } from '../extraction/headings'")
  })
})

describe('headings the importer has no column for', () => {
  it.each([
    'Balance',
    'Running Total',
    'Cleared',
    'Category',
    'Notes to self',
    'Unit Price',
    'Check Image',
  ])('does not invent a match for %s', (heading) => {
    // `Unit Price` is the one that matters: strip punctuation too eagerly and it
    // collides with `Unit`, and a treasurer's price column silently becomes
    // their unit column.
    expect(targetForHeading(heading)).toBeNull()
  })

  it.each(['', '   ', '\t'])('matches nothing for a blank heading (%j)', (heading) => {
    // Real files have them — that is why story 5.3 reports blanks by position.
    expect(targetForHeading(heading)).toBeNull()
  })

  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'does not resolve %s through the prototype chain',
    (heading) => {
      /**
       * `HEADING_ALIASES[key]` on a plain object literal reaches
       * `Object.prototype`, so a column literally headed `constructor` returned
       * the `Object` constructor **function** where the signature promises
       * `TargetField | null`. A real export can carry any header text at all -
       * these are user-supplied strings from a user-supplied file, which is
       * exactly the input class AD-8 is about. Raised by Argus.
       */
      const result = targetForHeading(heading)

      expect(result).toBeNull()
      expect(typeof result).not.toBe('function')
    },
  )

  it('does not match the retired `type` column', () => {
    // It stopped being a column in story 5.2, and `readRows` refuses a file
    // carrying it. Suggesting it would break the upload from inside the wizard.
    expect(targetForHeading('type')).toBeNull()
    expect(targetForHeading('Type')).toBeNull()
  })
})

describe('the alias table itself', () => {
  it('resolves only to targets the importer publishes', () => {
    const values = Object.values(HEADING_ALIASES)

    expect(values.length).toBeGreaterThan(0)
    // An alias for a column no kind has is a suggestion `assign` refuses, which
    // the treasurer experiences as nothing happening at all.
    expect(values.filter((target) => !ALL_TARGETS.includes(target))).toEqual([])
  })

  it('is keyed by matchKey, so every key is already folded', () => {
    // A key that is not its own `matchKey` can never be hit: the lookup folds
    // the heading first, so `Txn Date` as a literal key would be dead weight.
    const unreachable = Object.keys(HEADING_ALIASES).filter((key) => matchKey(key) !== key)

    expect(unreachable).toEqual([])
  })

  it('defines no key twice', () => {
    // An object literal silently keeps the last of a duplicated key, so which
    // target wins would depend on line order. Read the source rather than the
    // object, because the object cannot show the collision.
    const source = HEADING_ALIAS_SOURCE
    // `\s+`, not `\s{2}`: pinning the exact indentation makes this silently
    // match nothing the day Prettier reformats the literal. The non-empty
    // assertion below would catch that loudly rather than silently — but a check
    // that depends on indentation is a check about whitespace, not about keys.
    // Raised by `ocr`.
    const keys = [...source.matchAll(/^\s+([a-z0-9]+):/gm)].map((match) => match[1])

    expect(keys.length).toBeGreaterThan(0)
    expect(keys.length).toBe(new Set(keys).size)
  })

  it('gives no two published targets the same match key', () => {
    /**
     * The cross-check `CANONICAL` depends on and cannot make for itself. It is
     * a `Map` keyed by `matchKey(target)`, so two distinct targets folding to
     * one key would leave the later silently overwriting the earlier — and
     * `targetForHeading` would then answer with a target the treasurer never
     * named. No pair does today; `unit` and `unit_reference` would.
     *
     * Raised by `ocr`, and it is the same shape Argus raised against the
     * earlier `Set`-plus-cast version.
     */
    const keys = ALL_TARGETS.map(matchKey)

    expect(keys.length).toBeGreaterThan(0)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

/** The alias literal's own source, for the duplicate-key check above. */
const HEADING_ALIAS_SOURCE = (() => {
  const source = readFileSync(fileURLToPath(new URL('./heading-match.ts', import.meta.url)), 'utf8')
  const start = source.indexOf('HEADING_ALIASES')
  return source.slice(start, source.indexOf('}', start))
})()
