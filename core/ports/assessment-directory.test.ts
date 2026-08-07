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

const declaredMembers = (text: string): readonly string[] => {
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

  // Returns the member *lines*, not parsed names.
  //
  // Five rounds of review found five member forms an earlier, name-matching
  // version silently dropped — a named property, a generic method, a call
  // signature, an index signature, and finally optional (`record?()`) and quoted
  // (`"write"()`) members. Each one was a way to add a write capability that the
  // exhaustive assertion below would report as absent, which is the same defect
  // wearing a new syntax each time.
  //
  // So this stops recognising syntax. Every non-empty line inside the interface
  // is a member line, whatever it looks like. There is no form left for a sixth
  // round to find, because nothing is being matched — a member either changes
  // this list or it does not exist.
  //
  // The trade is that harmless reformatting also fails the assertion. On a port
  // that is the right trade: it should not change quietly.
  return withoutComments
    .slice(open + 1, close)
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line.length > 0)
}

describe('the AssessmentDirectory port', () => {
  it('declares exactly the one member this story needs', () => {
    // The whole body, not a parsed list of names. Anything added — in any
    // syntax at all — changes this and fails.
    expect(declaredMembers(source)).toEqual([
      'forUnitAndYear(unitNumber: string, year: number): Promise<UnitAssessment | null>',
    ])
  })

  it.each([
    ['a named method', '  record(unitNumber: string): Promise<void>'],
    ['a function-typed property', '  readonly record: (unitNumber: string) => Promise<void>'],
    ['a generic method', '  record<T>(payload: T): Promise<void>'],
    ['a call signature', '  (unitNumber: string): Promise<void>'],
    ['an index signature', '  [key: string]: unknown'],
    ['an optional method', '  record?(unitNumber: string): Promise<void>'],
    ['a quoted member name', '  "record"(unitNumber: string): Promise<void>'],
  ])('sees a write capability declared as %s', (_label, member) => {
    // Five rounds of review found five of these forms escaping a name-matching
    // helper, each one a way to add a write method that the assertion above
    // would report as absent. They are listed here so the list itself is the
    // record of what was missed — and they all pass now for the same reason:
    // nothing is matched, so nothing can be missed.
    const sample = [
      'export interface AssessmentDirectory {',
      '  forUnitAndYear(unitNumber: string, year: number): Promise<void>',
      member,
      '}',
    ].join('\n')

    expect(declaredMembers(sample)).toHaveLength(2)
    expect(declaredMembers(sample)[1]).toBe(member.trim())
  })

  it('reads the interface body rather than stopping at the first brace', () => {
    // The control for the brace matcher, with an unmatched brace inside a
    // string literal type — the case that made story 2.1's version of this pass
    // with the string-awareness removed.
    const sample = [
      'export interface AssessmentDirectory {',
      "  closing(sep: '}'): Promise<void>",
      '  second(): Promise<void>',
      '}',
    ].join('\n')

    expect(declaredMembers(sample)).toHaveLength(2)
    expect(declaredMembers('nothing here')).toEqual([])
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
