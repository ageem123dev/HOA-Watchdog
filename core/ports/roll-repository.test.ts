/**
 * Where the capability to create a unit lives, and where it must not.
 *
 * AC5 of story 2.7. Epic 2 built three ports that touch units and deliberately
 * gave none of them a write: a deposit naming a unit nobody recorded has to
 * produce a question for a human rather than a new unit, and that holds because
 * the deposit path cannot reach a writer at all.
 *
 * This story adds the one writer there is. The assertion worth making is not
 * that it exists — the adapter would fail without it — but that adding it did
 * not quietly widen either of the others.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ConflictingTenureError } from './roll-repository'

const HERE = dirname(fileURLToPath(import.meta.url))

const sourceOf = (file: string): string => readFileSync(join(HERE, file), 'utf8')

/**
 * Method and function-property names declared by an interface.
 *
 * `[:(]` rather than `(`, so a capability declared as a function-typed property
 * — `readonly record: (x) => Promise<void>` — is visible too. The narrower
 * `/^\s*(\w+)\s*\(/gm` matched method shorthand only, which made an exhaustive
 * read-only assertion satisfiable by writing the write differently. Found on
 * story 2.2 and recorded as an open action item against `unit-directory.test.ts`;
 * this file uses the corrected form rather than copying the defect forward.
 */
function declaredMembers(source: string, interfaceName: string): string[] {
  const body = new RegExp(`export interface ${interfaceName}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source)
  expect(body, `no interface ${interfaceName} found`).not.toBeNull()

  return [...body![1]!.matchAll(/^\s*(?:readonly\s+)?(\w+)\s*[:(]/gm)].map((match) => match[1]!)
}

describe('the roll repository is the only port that may create a unit', () => {
  it('declares exactly one capability', () => {
    // Exhaustive on purpose. A second method here is a second way into the
    // tables, and the argument for the read-only ports beside it rests on there
    // being exactly one writer to point at.
    expect(declaredMembers(sourceOf('roll-repository.ts'), 'RollRepository')).toEqual(['apply'])
  })

  it('finds members declared as function-typed properties, not only as methods', () => {
    // The control for the matcher above. Without it, an exhaustive assertion
    // could pass by seeing nothing at all — which is the defect this shape was
    // written to avoid.
    const planted = `export interface Planted {\n  readonly write: (x: string) => Promise<void>\n  read(): Promise<void>\n}`

    expect(declaredMembers(planted, 'Planted')).toEqual(['write', 'read'])
  })

  it.each([
    ['unit-directory.ts', 'UnitDirectory'],
    ['assessment-directory.ts', 'AssessmentDirectory'],
  ])('leaves %s able only to read', (file, interfaceName) => {
    // Not a restatement of those files' own tests: this asserts that *this
    // story* did not widen them. Both docblocks argue the absence is the design.
    const members = declaredMembers(sourceOf(file), interfaceName)

    expect(members.length).toBeGreaterThan(0)
    for (const member of members) {
      expect(member).not.toMatch(/^(record|create|insert|write|save|upsert|apply|replace|delete)/i)
    }
  })
})

describe('a tenure two documents disagree about', () => {
  it('names the unit and the date, because a treasurer has to act on it', () => {
    // Asserting the message, not the type. `toThrow(SomeType)` cannot tell a
    // contract from a crash, which this project has had to unlearn repeatedly.
    const error = new ConflictingTenureError('4B', '2026-07-01')

    expect(error.message).toContain('4B')
    expect(error.message).toContain('2026-07-01')
    expect(error.name).toBe('ConflictingTenureError')
  })

  it('says something different when the roll contradicts itself', () => {
    // Two conflicts, two remedies: remove the other document, or correct the
    // duplicate rows in this one. A treasurer told only "there is a conflict"
    // has to go and work out which situation they are in. The discriminator was
    // added without a test for its branch — raised by review.
    const internal = new ConflictingTenureError('4B', '2026-07-01', 'this-roll')
    const external = new ConflictingTenureError('4B', '2026-07-01', 'another-document')

    expect(internal.message).toContain('4B')
    expect(internal.message).toContain('2026-07-01')
    expect(internal.message).not.toEqual(external.message)
    expect(internal.message).toMatch(/this roll/i)
  })

  it('defaults to the cross-document wording', () => {
    expect(new ConflictingTenureError('4B', '2026-07-01').message).toMatch(/another document/i)
  })

  it('is an Error, so an unhandled one still reports as one', () => {
    expect(new ConflictingTenureError('4B', '2026-07-01')).toBeInstanceOf(Error)
  })
})
