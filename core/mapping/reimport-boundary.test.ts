/**
 * The re-import is not a second writer (story 5.7, AC4 — structural half).
 *
 * ## Why a structural test, when the behavioural one already passes
 *
 * `reimport.test.ts` proves that records reach `extractions.replace`. It cannot
 * prove that *nothing else* writes derived rows: a `reimport` that called
 * `ingest` **and** also inserted its own extraction rows would pass every
 * assertion in that file, because every assertion there is about what did
 * happen, not about what could not.
 *
 * AD-13 is stated as a prohibition — *"a second write path for the same entity
 * is a violation"* — and the story calls a re-import "the textbook temptation to
 * write one". A prohibition needs a test shaped like a prohibition.
 *
 * The doc comment at the top of `reimport.ts` claims this module writes nothing.
 * This is what makes that claim cost something. Prose does not hold: this
 * project has four instances of a rule stated in a comment and contradicted by
 * the code beneath it, and on 5.6b a guard's *own comment* satisfied the search
 * it was guarding.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { specifiersIn } from '../ports/module-specifiers'
import { neutralise } from '../ports/declared-members'

const SOURCE = readFileSync(fileURLToPath(new URL('./reimport.ts', import.meta.url)), 'utf8')
const imports = specifiersIn(SOURCE)
const code = neutralise(SOURCE).commentsBlanked

/**
 * Modules that create or replace derived rows. `reimport` may reach none of
 * them: its one write is `ingest`, which owns them already.
 */
const WRITERS = [
  'extraction-repository',
  'payment-repository',
  'roll-repository',
  'finding',
  'notify-findings',
  'run-detection',
]

describe('the re-import reaches no writer of its own', () => {
  it.each(WRITERS)('does not import anything matching %s', (writer) => {
    expect(imports.filter((specifier) => specifier.includes(writer))).toEqual([])
  })

  it('imports ingest for its types only, and receives the function instead', () => {
    /**
     * The distinction matters. A direct `import { ingest }` would work and would
     * be worse: the tests could then no longer pass the real function in and
     * prove it is the one being called, and this module would reach into the
     * ingestion path rather than being handed it.
     */
    expect(code).toContain("import type { IngestDependencies")
    expect(code).not.toMatch(/^import \{[^}]*\bingest\b/m)
  })

  it('names no table and issues no SQL', () => {
    // The blunt version of the same rule, and the one that catches a writer
    // arriving by a route the import list cannot see — a raw query through an
    // injected pool, say.
    expect(code).not.toMatch(/\binsert\s+into\b/i)
    expect(code).not.toMatch(/\bupdate\s+\w+\s+set\b/i)
    /**
     * The call form that actually exists. This was `/\bextraction\b\s*\(/i`,
     * which matches nothing any code here would write - the writer is reached
     * as `deps.extractions.replace(...)`. The assertion therefore passed
     * against every possible file, including one writing derived rows on every
     * line: a guard that guards nothing, inside the file whose entire job is
     * guarding. Raised by CodeRabbit, and the twelfth of this shape here.
     */
    expect(code).not.toMatch(/extractions\s*[.?]/)
    expect(code).not.toMatch(/\breplace\s*\(/)
  })

  it('touches the store only to read', () => {
    // `store.put` here would mean the re-import was re-uploading bytes it just
    // downloaded — a second copy of a document that is already held, and a
    // second content hash to reconcile.
    expect(code).toContain('deps.store.get(')
    expect(code).not.toContain('store.put')
  })

  it('never reaches the unit census (story 5.8)', () => {
    /**
     * Story 5.8 refuses a deposit upload until an assessment roll has created
     * units. That rule is about a *first* upload, and the re-import is not one:
     * by the time anyone re-maps a column, units exist.
     *
     * The danger is not today's code. It is that `ingest` looks like the safer
     * home for the guard, and moving it there hands it to this path too - a
     * mapping change failing for a reason about first-time setup, with a message
     * nobody could act on.
     *
     * The positive control is in `app/upload/actions.test.ts`, where the census
     * *is* reached. An absence asserted with a matcher that matches nothing
     * passes forever.
     */
    expect(imports.filter((specifier) => specifier.includes('unit-census'))).toEqual([])
    expect(code).not.toMatch(/hasUnits/)
  })

  it('is not passing because the blanker emptied the file', () => {
    // Every assertion above is an absence. If `neutralise` or `specifiersIn`
    // ever returned nothing, all of them would pass and this file would be a
    // guard that guards nothing — the defect it exists to catch, in itself.
    expect(code).toContain('export async function reimport')
    expect(imports.length).toBeGreaterThan(3)
  })
})
