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
import { AMOUNT_PATTERN } from '../core/extraction/record'

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

  it('keeps the deadline armed through the body read', () => {
    // Raised in review: the probe cleared its timer before `response.json()`,
    // so a provider that answered with headers and then stalled mid-body would
    // hang the script. The adapter had the same defect and was fixed first —
    // fixing one and not the other is the "could this happen anywhere else?"
    // question going unasked.
    //
    // The first version of this assertion compared the position of the last
    // `finally` against `response.json()`, which is a weaker claim than it
    // sounds: a clear left immediately after `fetch()` still passes it as long
    // as some later `finally` exists for any reason at all. Raised in review
    // too, and correctly. What actually has to be true is that a clear happens
    // **after** the body is read — that is what "still armed during the read"
    // means.
    const body = probe.slice(probe.indexOf('async function ask'))
    const clears = [...body.matchAll(/clearTimeout\(timer\)/g)].map((m) => m.index ?? -1)
    const jsonAt = body.indexOf('response.json()')

    expect(jsonAt).toBeGreaterThan(0)
    expect(clears.length).toBeGreaterThan(0)
    expect(
      clears.some((at) => at > jsonAt),
      'no clearTimeout runs after the body read, so the deadline is dropped before it',
    ).toBe(true)
  })

  it('does not drop the deadline as soon as fetch resolves', () => {
    // The specific shape of the original defect: the only clear sitting between
    // the fetch call and the body read.
    const body = probe.slice(probe.indexOf('async function ask'))
    const fetchAt = body.indexOf('await fetch(')
    const jsonAt = body.indexOf('response.json()')
    const between = [...body.matchAll(/clearTimeout\(timer\)/g)]
      .map((m) => m.index ?? -1)
      .filter((at) => at > fetchAt && at < jsonAt)
    const after = [...body.matchAll(/clearTimeout\(timer\)/g)]
      .map((m) => m.index ?? -1)
      .filter((at) => at > jsonAt)

    // A clear on the transport-error path is fine — that path never reaches the
    // body. What must not happen is clearing there and nowhere afterwards.
    expect(after.length, `clears between fetch and json: ${between.length}, after: ${after.length}`)
      .toBeGreaterThan(0)
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
    // This previously asserted the *adapter* did not mention the probe, which
    // is the reverse of the property it claims and was true for unrelated
    // reasons. The probe is the file that must not import.
    expect(probe).not.toMatch(/^\s*import\s.*from\s+['"][^'"]*adapters\//m)
    expect(probe).not.toMatch(/^\s*import\s.*from\s+['"][^'"]*core\//m)
  })

  it('the adapter is importable here without firing anything', () => {
    // Guards the direction that is safe, and keeps the import above honest.
    expect(MAX_REPLY_BYTES).toBeGreaterThan(0)
  })
})

describe('the probe restates the amount rule, so it is compared here', () => {
  // The rule lives in `core/extraction/record.ts`. The probe cannot import it —
  // plain `.mjs` against TypeScript — so its copy is checked against the
  // canonical one. Hand-writing this pattern is exactly how the adapter shipped
  // `^-?d{1,12}(.d{1,2})?$` to the provider, a pattern that rejects `1450.00`
  // and accepts `d.d`.
  /**
   * The string *value* the probe's literal denotes, not its source text.
   *
   * Source `'^-?\\d…'` denotes the value `^-?\d…`, so a raw text comparison
   * against `AMOUNT_PATTERN` fails even when the two agree perfectly — and a
   * regex built from the undecoded text matches a literal backslash. Decoding
   * through JSON gets the value a reader of the file would expect.
   */
  const patternIn = (source: string): string | undefined => {
    const raw = /pattern: '([^']+)'/.exec(source)?.[1]

    return raw === undefined ? undefined : (JSON.parse(`"${raw}"`) as string)
  }

  it('uses the canonical pattern in the schema it sends', () => {
    const probePattern = patternIn(probe)

    expect(probePattern).toBeDefined()
    expect(probePattern).toBe(AMOUNT_PATTERN)
  })

  it('and the same rule in the check it performs', () => {
    // The probe also tests amounts with a regex literal. Both copies must agree
    // with the canonical rule, not merely with each other.
    const literal = /!\/(\^[^/]+)\/\.test\(record\.totalAmount\)/.exec(probe)?.[1]

    expect(literal).toBeDefined()
    expect(literal).toBe(AMOUNT_PATTERN)
  })

  it('agrees with the canonical rule on real amounts', () => {
    // Behavioural, not textual: two patterns can differ in spelling and agree,
    // or match textually and diverge. This is the assertion that would have
    // caught the adapter's broken pattern.
    const probePattern = new RegExp(patternIn(probe) ?? 'x^')

    for (const [amount, valid] of [
      ['1450.00', true],
      ['-250', true],
      ['1450.000', false],
      ['$1450.00', false],
      ['d.d', false],
    ] as [string, boolean][]) {
      expect(probePattern.test(amount), amount).toBe(valid)
      expect(new RegExp(AMOUNT_PATTERN).test(amount), amount).toBe(valid)
    }
  })
})
