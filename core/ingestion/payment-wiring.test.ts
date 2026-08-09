/**
 * That the production call sites actually pass the payment collaborators.
 *
 * `recordPayments` treats a missing `units` or `payments` as "do nothing", which
 * is how the callers written before story 2.5 keep working. That default is a
 * real gap rather than a neutral one: a deposit ingested without them is read,
 * stored, and recorded against nobody, and **nothing fails**. It is precisely
 * the shape of story 2.4 — every part correct, nothing connected — so the thing
 * worth pinning is the connection itself.
 *
 * Read out of the call sites' source. A route handler needs a session, a
 * database and an object store before it will run a line of this, and the
 * question here is narrower than any of that: does the wiring exist at all.
 * `unit-directory-connection.test.ts` reads source for the same reason.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')

/** The two call sites, and the dependency object each builds. */
const CALL_SITES = [
  {
    what: 'the upload action, which is the path a deposit CSV takes',
    path: 'app/upload/actions.ts',
    call: 'ingest(',
  },
  {
    what: 'the extract route, which is the path a scanned deposit takes',
    path: 'app/api/documents/[id]/extract/route.ts',
    call: 'extractDocument(',
  },
] as const

describe.each(CALL_SITES)('$what', ({ path, call }) => {
  const source = read(path)

  /** The argument object of the ingestion call, brace-matched from the call. */
  const dependencies = (): string => {
    const at = source.indexOf(call)
    expect(at, `${path} no longer calls ${call}`).toBeGreaterThan(-1)

    const open = source.indexOf('{', at)
    let depth = 0
    for (let i = open; i < source.length; i += 1) {
      const ch = source[i]
      if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) return source.slice(open, i + 1)
      }
    }
    throw new Error(`${path}: could not find the end of the dependency object`)
  }

  it('asks the directory which unit a reference names', () => {
    expect(dependencies()).toContain('units:')
  })

  it('supplies somewhere for the payments to be written', () => {
    expect(dependencies()).toContain('payments:')
  })

  it('builds both from the real adapters rather than leaving them undefined', () => {
    // `units: undefined` would satisfy the two assertions above and record
    // nothing — the same false-clean this file exists to refuse.
    expect(dependencies()).toContain('units: createUnitDirectory()')
    expect(dependencies()).toContain('payments: createPaymentRepository()')
  })
})

describe('the wiring test itself', () => {
  it('is reading a dependency object rather than the whole file', () => {
    // The control for the instrument. If the brace matching ran away to the end
    // of the file, every assertion above would pass on any file that mentions
    // `units:` anywhere at all, including in a comment.
    const source = read('app/upload/actions.ts')
    const at = source.indexOf('ingest(')
    const open = source.indexOf('{', at)

    let depth = 0
    let end = -1
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1
      else if (source[i] === '}') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }

    expect(end).toBeGreaterThan(open)
    expect(end).toBeLessThan(source.length - 1)
  })
})
