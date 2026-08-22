/**
 * The shared import scanner, tested against planted inputs.
 *
 * **A scan over clean files cannot distinguish "nothing is wrong" from "nothing
 * is checked"** — `boundary.test.ts` says so, and its first version proved it by
 * missing five import forms while reporting green. So this file plants each
 * shape and asserts it is seen, rather than only asserting a clean tree is clean.
 *
 * Every case here is one a real guard in this repo depends on: the four
 * structural tests that stand in for AD-4 and AD-8 all read this function now.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { specifiersIn } from './module-specifiers'

describe('every form that loads a module', () => {
  it.each([
    ['a static import', "import { x } from '@/adapters/db'", '@/adapters/db'],
    ['a type-only import', "import type { X } from '@/adapters/db'", '@/adapters/db'],
    ['a re-export', "export { x } from '@/adapters/db'", '@/adapters/db'],
    ['a side-effect import, which has no from', "import '@/adapters/db'", '@/adapters/db'],
    ['a dynamic import', "await import('@/adapters/db')", '@/adapters/db'],
    ['a require', "const x = require('@/adapters/db')", '@/adapters/db'],
    ['double quotes', 'import { x } from "@/adapters/db"', '@/adapters/db'],
    ['a backtick specifier', 'await import(`@/adapters/db`)', '@/adapters/db'],
  ])('sees %s', (_label, source, expected) => {
    expect(specifiersIn(source)).toContain(expected)
  })

  it('sees an import list a formatter wrapped across lines', () => {
    // The shape that escaped the first single-line pattern. This matches only
    // the tail, so the wrapping above it is irrelevant.
    const source = ['import {', '  somethingWithAVeryLongName,', "} from '@/adapters/db'"].join('\n')

    expect(specifiersIn(source)).toContain('@/adapters/db')
  })
})

describe('prose is not code', () => {
  it('does not read a line comment as an import', () => {
    // `finding.test.ts` had its own prose satisfy the control written to stop a
    // vacuous pass. Raised by CodeRabbit there; this is where it is now checked.
    expect(specifiersIn("// import { x } from '@/adapters/db'")).toEqual([])
  })

  it('does not read a block comment as an import', () => {
    expect(specifiersIn("/* import { x } from '@/adapters/db' */")).toEqual([])
  })

  it('does not read a doc comment mentioning a package as an import', () => {
    const source = "/** Never `import` from 'pg' here — the database is an adapter. */"

    expect(specifiersIn(source)).toEqual([])
  })

  it('still sees the real import beside a commented-out one', () => {
    const source = ["// import { old } from '@/adapters/old'", "import { x } from './near'"].join(
      '\n',
    )

    expect(specifiersIn(source)).toEqual(['./near'])
  })
})

describe('string contents survive', () => {
  it('keeps a specifier that is the point of the scan', () => {
    // Masking strings would blank the very thing this reads.
    expect(specifiersIn("import { x } from './near'")).toEqual(['./near'])
  })

  it('does not let a URL in a string eat the rest of the line', () => {
    // A naive `//` strip treats `https://` as a comment start and swallows the
    // closing quote. `neutralise` has its own tests for this; asserted here too
    // because this scanner is the caller that would suffer.
    const source = ["const u = 'https://example.com'", "import { x } from './near'"].join('\n')

    expect(specifiersIn(source)).toEqual(['./near'])
  })
})

describe('what it will not pretend to know', () => {
  it('reports an interpolated specifier with its placeholder intact', () => {
    /**
     * Fail-closed, and the caller's job to treat as indeterminate.
     * `import(`@/catalog/${entry}`)` resolves to the catalog whenever `entry`
     * says so, and a scanner that answered "not the catalog" would be guessing.
     * Raised by Argus on the sole-data-path guard.
     */
    const found = specifiersIn('await import(`@/adapters/db/${name}`)')

    expect(found).toEqual(['@/adapters/db/${name}'])
  })

  it('finds nothing in a file that imports nothing', () => {
    expect(specifiersIn('export const x = 1\n')).toEqual([])
  })
})

describe('the scanner read over itself', () => {
  it('reports only the import this module actually has', () => {
    /**
     * **The regression test for the defect that found itself.**
     *
     * Written as a literal character class, this module's pattern contained a
     * raw backtick. `neutralise` does not know what a regex literal is, so it
     * read that backtick as opening a template literal and **silently stopped
     * blanking comments for the rest of the file** — after which the doc comment
     * below it was scanned as code, and this module reported importing
     * `@/x/${e}`, a specifier that appears nowhere but in prose.
     *
     * That is the exact failure this scanner exists to prevent, in the scanner
     * itself, and it only surfaced because moving the code out of a `.test.ts`
     * file put it under `sole-data-path.test.ts`'s sweep for the first time.
     */
    const source = readFileSync(fileURLToPath(new URL('./module-specifiers.ts', import.meta.url)), 'utf8')

    expect(specifiersIn(source)).toEqual(['./declared-members'])
  })

  it('over-reports after a quote-bearing regex literal, which is the known limitation', () => {
    /**
     * **A stated limitation, not a passing grade.** `neutralise` has no concept
     * of a regex literal, so a quote inside one desynchronises its string
     * tracking and the comments after it stop being blanked. This module dodges
     * it by building its own pattern from escapes, but any other file with a
     * regex like `/['"]/` is still read this way.
     *
     * It is asserted here rather than left undiscovered because the direction
     * matters: the scanner **fails closed**. Prose gets reported as an import,
     * so every guard built on it goes red and a human looks — the opposite of a
     * violation slipping through unseen. That is why this is an action item and
     * not a stop-the-story defect.
     *
     * Fixing it means resolving the regex-versus-division ambiguity inside
     * `neutralise`, which has its own callers and its own tests. Recorded in the
     * story's Completion Notes.
     */
    const source = [
      "const QUOTE = /['\"]/g",
      "/** Never import from '@/adapters/db' here. */",
      "import { x } from './near'",
    ].join('\n')

    // The `@/adapters/db` below lives only in a comment. Its presence here is
    // the bug; the test exists so the day `neutralise` learns about regex
    // literals, this goes red and says so.
    expect(specifiersIn(source)).toEqual(['@/adapters/db', './near'])
  })
})
