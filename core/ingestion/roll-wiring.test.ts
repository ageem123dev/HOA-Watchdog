/**
 * That the upload action actually passes a roll repository, and that the
 * provider path deliberately does not.
 *
 * `recordRoll` treats a missing `rolls` as "do nothing", which is how callers
 * written before this story keep working. That default is a real gap rather than
 * a neutral one: a roll ingested without it is read and stored and creates no
 * unit, so every deposit uploaded afterwards is held — and **nothing fails**.
 * That is the shape stories 2.4 and 2.7 both exist to correct, so the thing
 * worth pinning is the connection itself.
 *
 * Read out of the call site's source, as `payment-wiring.test.ts` is and for the
 * same reason: the question is narrower than anything a route handler needs to
 * run, and it is whether the wiring exists at all.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')

/** The argument object of a call, brace-matched from the call site. */
function dependenciesOf(source: string, path: string, call: string): string {
  const at = source.indexOf(call)
  expect(at, `${path} no longer calls ${call}`).toBeGreaterThan(-1)

  const open = source.indexOf('{', at)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    const character = source[i]
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  throw new Error(`${path}: could not find the end of the dependency object`)
}

describe('the upload action, which is the path a roll takes', () => {
  const path = 'app/upload/actions.ts'
  const source = read(path)

  it('passes a roll repository to ingest', () => {
    expect(dependenciesOf(source, path, 'ingest(')).toMatch(/\brolls\s*:/)
  })

  it('passes the real adapter, not undefined', () => {
    // The mutation this exists for: `rolls: undefined` satisfies a test that
    // only looks for the property name, and behaves exactly like no wiring at
    // all. Story 2.5 met that shape and its test checks the constructor call.
    expect(dependenciesOf(source, path, 'ingest(')).toMatch(/\brolls\s*:\s*createRollRepository\(/)
  })

  it('imports that adapter, so the call resolves to something', () => {
    expect(source).toMatch(
      /import\s*\{\s*createRollRepository\s*\}\s*from\s*'@\/adapters\/db\/roll-repository-postgres'/,
    )
  })
})

describe('ingestion writes the roll before it settles the document', () => {
  const source = read('core/ingestion/ingest.ts')

  it('calls recordRoll', () => {
    expect(source).toMatch(/await\s+recordRoll\(/)
  })

  it('calls it before the extraction replace that settles the document', () => {
    // Ordering asserted by position here and by consequence in
    // `payment-ordering.test.ts` for the sibling call. A settled document is
    // never re-read, so a roll missing after `replace` is silent and permanent,
    // while one missing before it is healed by the next pass.
    const roll = source.indexOf('await recordRoll(')
    const settle = source.indexOf('await deps.extractions.replace(')

    expect(roll).toBeGreaterThan(-1)
    expect(settle).toBeGreaterThan(-1)
    expect(roll).toBeLessThan(settle)
  })

  it('writes the roll before the payments', () => {
    // A roll is what makes a payment attributable. Within one document the two
    // are exclusive, but a batch carrying both is processed in the order given.
    const roll = source.indexOf('await recordRoll(')
    const payments = source.indexOf('await recordPayments(')

    expect(payments).toBeGreaterThan(-1)
    expect(roll).toBeLessThan(payments)
  })
})

describe('the provider path is deliberately not wired', () => {
  it('does not record a roll from a scanned document', () => {
    // Asserted rather than left to drift. `core/ports/extractor.ts` rests a
    // safety claim on `ExtractionRecord[]` having no free-form field, and a roll
    // row carries a person's name — widening the provider's result to hold one
    // is an AD-8 change and wants a decision record, not a quiet edit.
    //
    // If this ever becomes wrong, it should be wrong loudly: a failing test
    // beside the reason, rather than a scanned roll silently creating units.
    expect(read('core/ingestion/extract-document.ts')).not.toMatch(/recordRoll/)
  })

  it('still records payments from a scanned deposit, which is wired', () => {
    // The control. Without it, the assertion above is satisfied by an
    // `extract-document.ts` that wires nothing at all.
    expect(read('core/ingestion/extract-document.ts')).toMatch(/await\s+recordPayments\(/)
  })
})
