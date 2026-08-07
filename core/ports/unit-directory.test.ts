/**
 * What the `UnitDirectory` port is allowed to express.
 *
 * The port is types and prose, so there is no behaviour to run. What can be
 * checked is the shape of the declaration, which is where the design decision
 * actually lives: this port can read and cannot write, and the absence is the
 * point. `core/ports/quarantine-queue.ts` makes the same argument about itself.
 *
 * Asserted against the *declared method names*, not against a forbidden word
 * appearing somewhere in the file. Task 1 of this story shipped a deny-list that
 * failed on a comment explaining the very thing it forbade, and two assertions
 * that matched an index's name rather than its column. A test that greps for
 * `insert` would fail on this sentence.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'unit-directory.ts'),
  'utf8',
)

/**
 * The names declared inside `interface UnitDirectory { … }`, and nothing else.
 *
 * Comments are stripped first, and the body is taken by brace matching rather
 * than by a lazy regex to the first `}` -- a nested object type in a signature
 * would end the match early and quietly shrink what this test looks at.
 */
const declaredMethods = (sql: string): readonly string[] => {
  const withoutComments = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const start = withoutComments.indexOf('interface UnitDirectory')
  if (start === -1) return []

  const open = withoutComments.indexOf('{', start)
  if (open === -1) return []

  let depth = 0
  let close = -1
  for (let i = open; i < withoutComments.length; i += 1) {
    const ch = withoutComments[i]

    // Skip over string and template literals before counting braces. A string
    // literal type — `sep: '{' | '}'` — would otherwise desync the depth counter
    // and truncate the body, which would make the exhaustive method list below
    // silently shorter than the interface really is. Raised by review; nothing
    // in this port triggers it today.
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

  const body = withoutComments.slice(open + 1, close)
  return [...body.matchAll(/^\s*(\w+)\s*\(/gm)].map((m) => m[1]!)
}

describe('the UnitDirectory port', () => {
  it('declares exactly the two questions this story answers', () => {
    // D1. Listed exhaustively rather than checked for presence: `toContain`
    // would pass for a port that also declared `record` and `close`.
    expect([...declaredMethods(source)].sort()).toEqual(['heldBy', 'historyFor'])
  })

  it('reads the interface body rather than stopping at the first brace', () => {
    // The control for the instrument. Without it a helper that silently returned
    // [] would make the assertion above pass for a port with no methods at all,
    // and a port with a nested object type in a signature would be truncated.
    const sample = [
      '// interface UnitDirectory { decoy(): void }',
      'export interface UnitDirectory {',
      '  first(at: { on: string }): Promise<void>',
      '  second(): Promise<void>',
      '}',
    ].join('\n')

    expect([...declaredMethods(sample)].sort()).toEqual(['first', 'second'])
    expect(declaredMethods('nothing here')).toEqual([])
  })

  it('counts braces outside string literals only', () => {
    // A string literal type carrying a brace would otherwise desync the depth
    // counter, close the body early, and make the exhaustive list above
    // silently shorter than the interface really is — a guard weakened by a
    // change nobody would connect to it.
    //
    // The literal is a lone closing brace on purpose. The first version of this
    // test used `'{'` and `'}'` on separate methods, and they *balanced*: a
    // naive counter reached the real closing brace at the right depth anyway,
    // so the test passed with the string-awareness removed. Caught by the
    // sensitivity check on this very fix. One unmatched brace is what actually
    // separates the two implementations.
    const sample = [
      'export interface UnitDirectory {',
      "  closing(sep: '}'): Promise<void>",
      '  second(): Promise<void>',
      '}',
    ].join('\n')

    expect([...declaredMethods(sample)].sort()).toEqual(['closing', 'second'])
  })

  // There was a `says why it cannot write` test here, asserting the header
  // contained `/read/i` and `/2\.4|write/i`. Review called it non-sensitive and
  // it was: `/read/i` matches the word `readonly`, which every field of
  // `UnitHolding` carries, so that half passed against a port stripped of every
  // word of rationale — checked, not assumed. The other half only required the
  // string `write` to appear anywhere.
  //
  // Deleted rather than tightened. Making it sensitive would mean matching a
  // specific sentence, which is testing prose — the very thing the migration
  // tests strip comments to avoid. The read-only API is already protected by the
  // exhaustive method list above, which is a property of the code.

  it('carries dates as calendar dates, not instants', () => {
    // D2. `pg` turns a `date` into a JS `Date` at local midnight, so a
    // membership beginning 2024-07-01 reads back as 2024-06-30 for anyone west
    // of UTC. Nothing in this port may be typed `Date`.
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

    expect(withoutComments).not.toMatch(/:\s*Date\b/)
    expect(withoutComments).toMatch(/heldUntil\s*:\s*string\s*\|\s*null/)
  })
})
