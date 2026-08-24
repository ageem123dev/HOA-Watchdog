/**
 * An upload and a re-import ingest with the same collaborators (story 5.7).
 *
 * ## The defect this exists to make impossible
 *
 * Story 5.7 gave `ingest` a second caller. Composing its dependencies separately
 * was the obvious thing to do and would have been a silent data defect: every
 * collaborator left out is a step the re-import *skips*, and not one of them
 * throws.
 *
 * - no `payments` — a re-imported deposit produces extraction rows and no
 *   payments, so money vanishes from a ledger it was already in
 * - no `rolls` — a re-imported roll creates no units, so every deposit
 *   afterwards is held `unknown-unit`
 * - no `findings` — the re-import erases the old parse's findings and raises
 *   none of the new ones
 * - no `alerts`/`recipients` — a genuine new finding is raised and nobody told
 *
 * The upload path accumulated these one story at a time (2.5, 4.2, 4.8, the roll
 * repository). A second call site starting from `{store, repository, extractions}`
 * would look complete and be four stories behind — and `alert-wiring.test.ts`
 * exists because that exact omission already happened once.
 *
 * ## Structural, because the behavioural version cannot see it
 *
 * A test that ingested through both paths and compared results would pass while
 * every collaborator was absent from both: the shared *omission* is invisible to
 * a comparison of two things that share it. So this asserts the composition is
 * literally one function, and that both callers reach it.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { specifiersIn } from '@/core/ports/module-specifiers'
import { neutralise } from '@/core/ports/declared-members'

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const SHARED = read('./ingestion-dependencies.ts')
const UPLOAD = read('./upload/actions.ts')
const REIMPORT = read('./onboarding/mapping/reimport-actions.ts')

const code = (source: string) => neutralise(source).commentsBlanked

/**
 * Collaborators whose absence is silent. Every one is a story's worth of
 * behaviour that simply does not happen, with nothing raised.
 */
const SILENT_IF_ABSENT = [
  'units',
  'payments',
  'rolls',
  'invoices',
  'dues',
  'findings',
  'findingReader',
  'alerts',
  'recipients',
  'vendors',
  'quarantine',
  'mappings',
]

describe('the composition is one thing', () => {
  it.each(SILENT_IF_ABSENT)('supplies %s', (collaborator) => {
    expect(code(SHARED)).toMatch(new RegExp(`\\b${collaborator}:`))
  })

  it.each([
    ['the upload path', () => UPLOAD],
    ['the mapping change', () => REIMPORT],
  ])('%s reaches ingest only through it', (_label, source) => {
    /**
     * The load-bearing assertion. A caller that imported the adapters directly
     * could assemble its own set, and the shared module would sit there looking
     * authoritative while one path quietly diverged.
     */
    const imports = specifiersIn(source())

    expect(imports.some((specifier) => specifier.includes('ingestion-dependencies'))).toBe(true)

    // And *calls* it. An import alone passes while the caller keeps a stale
    // import and assembles its own set beside it - which is the exact drift this
    // file exists to prevent. Raised by CodeRabbit.
    expect(code(source())).toMatch(/ingestionDependencies\(/)

    // Adapter imports are what a hand-rolled set is made of. Neither caller has
    // any: `reimport-actions.ts`'s three are the mapping store, the change log
    // and the candidates — none of which `ingest` takes.
    const assembled = imports.filter((specifier) =>
      /(payment|roll|invoice|dues|finding|unit-directory|vendor|quarantine)-/.test(specifier),
    )

    expect(assembled).toEqual([])
  })

  it('does not carry the unit census (story 5.8)', () => {
    /**
     * The census decides whether a *first* deposit upload may proceed. Putting
     * it in the shared composition would hand it to `ingest`, and therefore to
     * the mapping-change re-import, which is not a first upload and must not be
     * refused for being one. It belongs to the upload action alone.
     */
    expect(code(SHARED)).not.toMatch(/unit-census|hasUnits/)
  })

  it('is not passing because the blanker emptied the files', () => {
    // Most assertions above are satisfiable by an empty string or an empty list.
    expect(code(SHARED)).toContain('export function ingestionDependencies')
    expect(specifiersIn(UPLOAD).length).toBeGreaterThan(3)
    expect(specifiersIn(REIMPORT).length).toBeGreaterThan(3)
  })
})

describe('the shared module is the only place these are built', () => {
  it.each([
    ['the upload path', () => UPLOAD],
    ['the mapping change', () => REIMPORT],
  ])('%s builds no ingest dependency object of its own', (_label, source) => {
    // `store:` and `extractions:` next to each other is the signature of a
    // hand-assembled `IngestDependencies`. Cheap, and it catches the shape
    // rather than the imports — a caller could build one from re-exports.
    const body = code(source())

    expect(body).not.toMatch(/extractions:\s*\w/)
  })
})
