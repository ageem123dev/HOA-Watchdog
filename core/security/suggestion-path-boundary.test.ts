/**
 * The column-suggestion path holds no tool access and no data credential.
 *
 * epics.md names this as epic 5's one real architectural risk, and names the
 * controls: *"The suggestion path carries **no tool access and no data
 * credential**; input is bounded and output schema-validated; headers are not
 * retained; deterministic matching runs first so the model sees only what could
 * not be resolved; and the manual path works when the model does not."*
 *
 * **Human confirmation is not the control.** The same passage is explicit that
 * the first draft got this wrong: confirming a mapping governs what is *stored*,
 * while prompt injection is about what the runtime *does* on the way there. So
 * the control is what these modules are *able* to reach — which is what this
 * file reads.
 *
 * ## What "no data credential" can honestly mean here
 *
 * Not process isolation. `deploy-units.json` puts `GEMINI_API_KEY` in the same
 * `web` unit as both database URLs and the R2 keys, because extraction runs
 * inside the Node gateway. A test claiming the suggester cannot *reach* a
 * database because of where it runs would be claiming something this topology
 * does not provide.
 *
 * What is enforceable, and what is asserted, is the module boundary: what these
 * files import and which environment variables they read.
 *
 * ## The lesson inherited from `no-model-in-alerts.test.ts`
 *
 * **The coverage list is asserted**, because every check below is generated from
 * it. Dropping an entry removes its cases rather than failing anything, so the
 * guard can silently shrink to nothing — found there by a sensitivity pass that
 * turned 19 passing tests into 17.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { specifiersIn } from '../ports/module-specifiers'
import { readsEnvironmentVariable } from './dual-llm-boundary'

const REPO_ROOT = process.cwd()

/**
 * Every module between a treasurer's sample and the model.
 *
 * Listed rather than globbed, for `no-model-in-alerts.test.ts`'s reason: a glob
 * silently stops covering the path the moment a file moves, and adding to this
 * list should be a conscious act — since adding a module here is exactly when
 * somebody might be reaching for a credential.
 */
const SUGGESTION_PATH = [
  'core/mapping/heading-match.ts',
  'core/mapping/suggest.ts',
  'core/mapping/residue.ts',
  'core/mapping/suggest-with-model.ts',
  'core/mapping/prefill.ts',
  'adapters/extraction/suggester-gemini.ts',
] as const

/** The one module on the path that may hold a model credential. */
const THE_ADAPTER = 'adapters/extraction/suggester-gemini.ts'

/**
 * Credentials that would mean this path can reach the association's records, or
 * the wrong side of AD-10.
 */
const FORBIDDEN_CREDENTIALS = [
  'WATCHDOG_WRITER_DATABASE_URL',
  'WATCHDOG_READER_DATABASE_URL',
  'AUTH_SECRET',
  'ACTOR_ASSERTION_KEY',
  'AGENT_SERVICE_TOKEN',
  'GATEWAY_SERVICE_TOKEN',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  // AD-10: raw extracted text must never reach the reasoning side.
  'REASONING_API_KEY',
  'REASONING_MODEL',
] as const

/** Directories nothing on this path may import from. */
const FORBIDDEN_IMPORTS = [
  'adapters/db',
  'adapters/agent',
  'adapters/storage',
  'adapters/auth',
  'catalog',
  'core/answer',
] as const

/**
 * Whether a specifier reaches somewhere this path may not.
 *
 * Named so the sweep and the planted-violation cases use **one** rule. Two
 * copies would let the planted cases pass against a rule the sweep does not
 * actually apply, which is the shape of a guard that proves nothing.
 */
const forbidden = (specifier: string): boolean =>
  FORBIDDEN_IMPORTS.some(
    (directory) =>
      specifier.includes(`/${directory}/`) ||
      specifier.startsWith(`@/${directory}`) ||
      specifier.startsWith(`${directory}/`),
  )

/** `process.env[expression]` — a read whose name is not in the source at all. */
const COMPUTED_ENV_READ = /process\s*\.\s*env\s*\[\s*[^'"`\]]/

const sources = SUGGESTION_PATH.map((path) => ({
  path,
  text: readFileSync(join(REPO_ROOT, path), 'utf8'),
}))

describe('the guard can actually fail', () => {
  it('covers every module on the suggestion path', () => {
    // Asserted explicitly: every check below is generated from this list, so a
    // dropped entry removes cases rather than failing anything.
    expect([...SUGGESTION_PATH].sort()).toEqual([
      'adapters/extraction/suggester-gemini.ts',
      'core/mapping/heading-match.ts',
      'core/mapping/prefill.ts',
      'core/mapping/residue.ts',
      'core/mapping/suggest-with-model.ts',
      'core/mapping/suggest.ts',
    ])
  })

  it('read every one of them, non-empty', () => {
    expect(sources).toHaveLength(SUGGESTION_PATH.length)
    for (const { path, text } of sources) expect(text.length, path).toBeGreaterThan(0)
  })

  it('detects a planted credential read', () => {
    /**
     * A scanner reporting green on the thing it exists to catch is worse than
     * none — `boundary.test.ts`'s lesson, applied to this file's own detector.
     *
     * **Planted with a name that is not a real credential**, and that is not
     * fussiness. Writing `process.env.REASONING_API_KEY` here — even as test
     * data inside a string — made AD-10's own guard report *this file* as a
     * module reading both sides of the boundary, because a text scanner cannot
     * tell a planted violation from a real one. `no-model-in-alerts.test.ts`
     * avoids it by keeping credential names as bare strings and never spelling
     * `process.env.` beside one.
     */
    expect(readsEnvironmentVariable('const x = process.env.EXAMPLE_NOT_A_SECRET', 'EXAMPLE_NOT_A_SECRET')).toBe(true)
    expect(readsEnvironmentVariable('const x = 1', 'EXAMPLE_NOT_A_SECRET')).toBe(false)
  })

  it.each([
    ['a static import', "import { x } from '@/adapters/db/catalog'", '@/adapters/db/catalog'],
    ['a namespace import', "import * as db from '@/adapters/db'", '@/adapters/db'],
    ['a side-effect import', "import '@/adapters/db/init'", '@/adapters/db/init'],
    ['a dynamic import', "await import('@/adapters/db')", '@/adapters/db'],
    ['relative traversal', "import { x } from '../../adapters/db/catalog'", '../../adapters/db/catalog'],
  ])('detects a planted forbidden import: %s', (_label, source, expected) => {
    // Each of these is a shape `ocr` asked whether the sweep below would catch.
    // Asserting the answer beats arguing it — and the traversal case turned out
    // to be caught already, because `../../adapters/db/x` does contain
    // `/adapters/db/`.
    const found = specifiersIn(source)

    expect(found).toContain(expected)
    expect(found.some((s) => forbidden(s)), `${expected} not classified as forbidden`).toBe(true)
  })

  it('reads no environment variable through a computed key', () => {
    /**
     * **A targeted patch for a hole in the shared detector.**
     * `readsEnvironmentVariable` matches `process.env.NAME`, `process.env['NAME']`
     * and destructuring — but not `process.env[someVariable]`, where the name is
     * not in the source at all. That gap fails *open*, and `ocr` raised it.
     *
     * Widening the shared detector is not this story's to do: it is used by
     * AD-10's boundary guard and the alerting guard, and a change there needs its
     * own round. What is cheap and closes the hole *for this path* is refusing
     * computed access outright — no module here has any reason to want it.
     */
    for (const { path, text } of sources) {
      expect(text, `${path} reads process.env through a computed key`).not.toMatch(
        COMPUTED_ENV_READ,
      )
    }
  })

  it('detects a planted computed env read', () => {
    // The detector above, shown to fail on the thing it exists to catch.
    expect('const k = n; process.env[k]').toMatch(COMPUTED_ENV_READ)
    // A literal key is the *allowed* form, and naming a real credential here
    // would trip AD-10's guard for the reason above.
    expect("process.env['EXAMPLE_NOT_A_SECRET']").not.toMatch(COMPUTED_ENV_READ)
  })
})

describe('no data credential', () => {
  it.each(SUGGESTION_PATH)('%s reads none of them', (path) => {
    const text = sources.find((source) => source.path === path)?.text ?? ''

    expect(FORBIDDEN_CREDENTIALS.length).toBeGreaterThan(0)

    const read = FORBIDDEN_CREDENTIALS.filter((name) => readsEnvironmentVariable(text, name))

    expect(read, `${path} reads ${read.join(', ')}`).toEqual([])
  })

  it('keeps the extraction credential in exactly one module', () => {
    /**
     * 4e. The adapter needs it; nothing else on the path does. "At most one" is
     * not enough — a path where *nothing* reads it would pass that while meaning
     * the guard is watching a model call that no longer exists.
     */
    const readers = sources
      .filter((source) => readsEnvironmentVariable(source.text, 'GEMINI_API_KEY'))
      .map((source) => source.path)

    expect(readers).toEqual([THE_ADAPTER])
  })
})

describe('no tool access', () => {
  it.each(SUGGESTION_PATH)('%s imports no store, catalog or chat client', (path) => {
    const text = sources.find((source) => source.path === path)?.text ?? ''
    const specifiers = specifiersIn(text)

    // Non-empty first for the core modules; the check below is a filter, and a
    // filter over nothing passes by describing an empty world.
    expect(specifiers.length, `${path} imports nothing at all`).toBeGreaterThan(0)

    const reached = specifiers.filter(forbidden)

    expect(reached, `${path} imports ${reached.join(', ')}`).toEqual([])
  })

  it('reaches the model through exactly one door', () => {
    // The same property `sole-chat-path.test.ts` holds for the agent: one file
    // knows the address. A second route would have to name the origin.
    const namesTheOrigin = sources
      .filter((source) => source.text.includes('generativelanguage.googleapis.com'))
      .map((source) => source.path)

    expect(namesTheOrigin).toEqual([THE_ADAPTER])
  })
})

describe('core stays core', () => {
  it.each(SUGGESTION_PATH.filter((path) => path.startsWith('core/')))(
    '%s imports nothing from adapters',
    (path) => {
      // `boundary.test.ts` holds this repo-wide; asserted here too because this
      // path is the one where an adapter import would be most tempting — the
      // model lives in one.
      const text = sources.find((source) => source.path === path)?.text ?? ''
      const outward = specifiersIn(text).filter((specifier) => specifier.includes('adapters'))

      expect(outward).toEqual([])
    },
  )
})
