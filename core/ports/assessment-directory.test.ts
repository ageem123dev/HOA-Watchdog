/**
 * What the `AssessmentDirectory` port is allowed to express.
 *
 * Types and prose, so there is no behaviour to run. What can be checked is the
 * shape of the declaration, which is where the design decision lives: this port
 * reads and cannot write, and the absence is the point.
 *
 * The brace matcher is `unit-directory.test.ts`'s, string-aware for the reason
 * recorded there — an unmatched brace inside a string literal type desyncs the
 * depth counter and silently truncates the method list.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'assessment-directory.ts'),
  'utf8',
)

const declaredMethods = (text: string): readonly string[] => {
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const start = withoutComments.indexOf('interface AssessmentDirectory')
  if (start === -1) return []

  const open = withoutComments.indexOf('{', start)
  if (open === -1) return []

  let depth = 0
  let close = -1
  for (let i = open; i < withoutComments.length; i += 1) {
    const ch = withoutComments[i]

    if (ch === "'" || ch === '"' || ch === '`') {
      i += 1
      while (i < withoutComments.length && withoutComments[i] !== ch) {
        if (withoutComments[i] === '\\') i += 1
        i += 1
      }
      continue
    }

    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  if (close === -1) return []

  // Both declaration forms. `record(x): Promise<void>` and
  // `readonly record: (x) => Promise<void>` are the same capability, and matching
  // only the first would let a write method be added in the second form without
  // the exhaustive list below noticing.
  //
  // A data property would be reported too. That is deliberate: on a port, any
  // member is a capability, and a surprise one should fail loudly here rather
  // than be silently excluded by the shape of the regex.
  return [
    ...withoutComments.slice(open + 1, close).matchAll(/^\s*(?:readonly\s+)?(\w+)\s*[:(<]/gm),
  ].map((m) => m[1]!)
}

describe('the AssessmentDirectory port', () => {
  it('declares exactly the one question this story answers', () => {
    // Listed exhaustively rather than checked for presence: `toContain` would
    // pass for a port that also declared `record` or `replace`.
    expect([...declaredMethods(source)].sort()).toEqual(['forUnitAndYear'])
  })

  it('reads the interface body rather than stopping at the first brace', () => {
    // The control for the helper, with an unmatched brace in a string literal
    // type — the case that made story 2.1's first version of this test pass with
    // the string-awareness removed.
    const sample = [
      'export interface AssessmentDirectory {',
      "  closing(sep: '}'): Promise<void>",
      '  second(): Promise<void>',
      '}',
    ].join('\n')

    expect([...declaredMethods(sample)].sort()).toEqual(['closing', 'second'])
    expect(declaredMethods('nothing here')).toEqual([])
  })

  it('sees a capability declared as a function-typed property, not only as a method', () => {
    // The hole this helper had, and the reason it matters more than style.
    // TypeScript lets the same capability be written two ways:
    //
    //   record(unitNumber: string): Promise<void>            // method shorthand
    //   readonly record: (unitNumber: string) => Promise<void>  // property
    //
    // The first version of the regex matched only the first form. A write method
    // added in the second form would have been **invisible** to the exhaustive
    // list above, which would have gone on reporting a read-only port — the
    // guard passing whether or not the thing it guards against was present.
    // Raised by review; verified against a planted declaration before fixing.
    const sample = [
      'export interface AssessmentDirectory {',
      '  forUnitAndYear(unitNumber: string, year: number): Promise<void>',
      '  readonly record: (unitNumber: string) => Promise<void>',
      '}',
    ].join('\n')

    expect([...declaredMethods(sample)].sort()).toEqual(['forUnitAndYear', 'record'])
  })

  it('sees a capability declared with generic type parameters', () => {
    // The third way to write one, and the third round of this same hole. After
    // the property form was fixed, review pointed out that `record<T>(…)` still
    // slipped through, because the name is followed by `<` rather than `:` or
    // `(`. Same consequence: a write capability the read-only assertion cannot
    // see. Fixed by one character in the character class, with this to prove it.
    const sample = [
      'export interface AssessmentDirectory {',
      '  forUnitAndYear(unitNumber: string, year: number): Promise<void>',
      '  record<T>(payload: T): Promise<void>',
      '}',
    ].join('\n')

    expect([...declaredMethods(sample)].sort()).toEqual(['forUnitAndYear', 'record'])
  })

  it('carries the amount as a decimal string, never a number', () => {
    // AC3 at the boundary. A `number` cannot hold 0.10 exactly, and it erases
    // the difference between 1200 and 1200.00 — which is the whole reason
    // `extraction.total_amount` crosses as a string too.
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

    expect(withoutComments).toMatch(/annualAmount\s*:\s*string/)
    expect(withoutComments).not.toMatch(/annualAmount\s*:\s*number/)
  })

  it('types the cycle as the shared vocabulary rather than as a bare string', () => {
    // A `string` here would let a caller construct a cycle the database rejects,
    // and the three-value union is the only thing making story 2.3's switch
    // exhaustive.
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

    expect(withoutComments).toMatch(/billingCycle\s*:\s*BillingCycle/)
  })
})
