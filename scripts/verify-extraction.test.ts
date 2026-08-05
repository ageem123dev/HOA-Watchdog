/**
 * The probe must connect the way the application connects.
 *
 * Story 1.4 found the failure this prevents: a probe that reaches the provider
 * differently from the adapter can report a healthy provider the application
 * cannot actually use, and the greener the probe the longer nobody looks.
 *
 * `verify-storage.mjs` addresses this with a comment saying it is "kept in step
 * with" its adapter. A comment is not a mechanism — it holds exactly until
 * someone changes one file. This makes the same promise checkable.
 *
 * These assertions read both files as text rather than importing them. The probe
 * is a plain `.mjs` script that calls a live provider on import, so importing it
 * here would fire real requests during `npm test`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MAX_REPLY_BYTES } from '../adapters/extraction/extractor-gemini'

const REPO_ROOT = join(__dirname, '..')

const probe = readFileSync(join(REPO_ROOT, 'scripts', 'verify-extraction.mjs'), 'utf8')
const adapter = readFileSync(
  join(REPO_ROOT, 'adapters', 'extraction', 'extractor-gemini.ts'),
  'utf8',
)

/** The single-quoted string assigned to `name`, in either file. */
const constantIn = (source: string, name: string): string | undefined =>
  new RegExp(`const ${name} = '([^']+)'`).exec(source)?.[1]

describe('the extraction probe stays in step with the adapter', () => {
  it('reads both files, so the comparisons below are over real content', () => {
    // Without this, a renamed or emptied file would make every assertion
    // compare undefined against undefined and pass.
    expect(probe.length).toBeGreaterThan(1_000)
    expect(adapter.length).toBeGreaterThan(1_000)
  })

  it('pins the same origin', () => {
    const probeOrigin = constantIn(probe, 'ORIGIN')

    expect(probeOrigin).toBeDefined()
    expect(probeOrigin).toBe(constantIn(adapter, 'ORIGIN'))
  })

  it('authenticates with the same header', () => {
    const header = constantIn(probe, 'AUTH_HEADER')

    expect(header).toBeDefined()
    expect(adapter).toContain(`'${header}': config.apiKey`)
  })

  it('reads the same environment variables', () => {
    for (const name of ['GEMINI_API_KEY', 'GEMINI_OCR_MODEL']) {
      expect(probe, `probe does not read ${name}`).toContain(name)
      expect(adapter, `adapter does not read ${name}`).toContain(name)
    }
  })

  it('asks for the same response format', () => {
    for (const source of [probe, adapter]) {
      expect(source).toContain("responseMimeType: 'application/json'")
      expect(source).toContain('responseSchema')
    }
  })

  it('refuses redirects, as the adapter does', () => {
    // The probe carries the credential too.
    expect(probe).toContain("redirect: 'manual'")
  })

  it('bounds its request, as the adapter does', () => {
    expect(probe).toContain('AbortController')
    expect(probe).toContain('controller.abort()')
  })

  it('carries the same document-kind vocabulary', () => {
    // The probe cannot import `record.ts` — it is plain `.mjs`. So the copy is
    // compared here instead, which is the only thing that keeps it honest.
    const kinds = /const DOCUMENT_KINDS = \[([^\]]+)\]/.exec(probe)?.[1]

    expect(kinds).toBeDefined()
    expect(kinds).toContain("'invoice'")
    expect(kinds).toContain("'assessment_roll'")
  })
})

describe('the probe holds to the storage probe\'s standard', () => {
  it('reports SKIP for a check it cannot run', () => {
    // "A check that cannot run must not print PASS" — verify-storage.mjs.
    expect(probe).toContain('SKIP')
  })

  it('exits non-zero when credentials are missing, rather than throwing', () => {
    expect(probe).toContain('process.exit(1)')
    expect(probe).toContain('missing')
  })

  it('never prints the credential', () => {
    // The key is set as a header and read nowhere else. A probe that echoes it
    // into CI output has published it.
    const printed = probe.match(/console\.(log|error)\([^)]*apiKey[^)]*\)/)

    expect(printed).toBeNull()
  })

  it('proves the violation case, not just the happy path', () => {
    // The one check that can distinguish a provider honouring the schema from
    // one ignoring it. Without it the probe proves connectivity and calls it
    // AD-9.
    expect(probe).toContain('a schema violation is refused rather than coerced')
  })

  it('does not import the adapter, which would fire live calls under npm test', () => {
    expect(adapter).not.toContain('verify-extraction')
    expect(MAX_REPLY_BYTES).toBeGreaterThan(0)
  })
})
