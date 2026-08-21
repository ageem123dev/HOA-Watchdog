/**
 * AD-10 — the dual-LLM boundary, enforced rather than described.
 *
 * "Different credential, different deploy unit." The *vendor* clause was
 * withdrawn on 2026-08-10, when reasoning moved to `gemini-3.6-flash` and both
 * sides became Google. That was an architecture amendment, made in the spine
 * before it was made here.
 *
 * This file has the same standing as `nfr2-guard.test.ts`: narrowing it is an
 * architecture change that needs a new AD. It is not a cleanup and it is not a
 * flaky test to quarantine. If it fails, the two model providers have moved
 * closer together and the correct response is to move them apart.
 *
 * ## Why every clause is tested twice
 *
 * The reasoning side does not exist yet. Epic 2 builds it. So a guard written
 * today can pass by describing an empty world, and keep passing right up to the
 * commit that merges the two sides — which is the one commit it was written to
 * catch. Every clause is therefore checked in both directions: the real
 * manifest must pass, and a **planted** violation of that same clause must fail.
 * A guard exercised only against a clean tree cannot tell "nothing wrong" from
 * "nothing checked". `core/ports/boundary.test.ts` established that technique
 * here.
 *
 * ## What this sees, and what it does not
 *
 * It reads the tracked deploy manifest and the repository's own source. It
 * cannot see the actual runtime topology of a hosting account — nothing in this
 * repository deploys anything today. Its value is narrower and still real: for
 * epic 2 to put both models in one unit, it has to edit a tracked file, in a
 * commit someone reviews, and this test fails until it does.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  boundaryViolations,
  modulesReadingBothSides,
  type DeployManifest,
} from './dual-llm-boundary'

const REPO_ROOT = join(__dirname, '..', '..')
const MANIFEST_PATH = join(REPO_ROOT, 'deploy-units.json')

const SCANNED_DIRECTORIES = ['core', 'adapters', 'app', 'scripts']
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js']

function loadManifest(): DeployManifest {
  // Not wrapped in a try. A missing or unparsable manifest must fail this
  // suite, never skip it — an unreadable input is exactly how a guard starts
  // passing for the wrong reason.
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as DeployManifest
}

function sourceFiles(): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = []

  /**
   * `withFileTypes`, so the directory read answers "file or directory?" instead
   * of a `statSync` per entry. This walk took ~920ms against vitest's default 5s
   * timeout, and under parallel workers all doing synchronous I/O it began
   * timing out intermittently — a suite that fails one run in eight teaches
   * everyone to re-run rather than read the failure. Halving the syscalls is the
   * fix; raising the timeout would only have made the symptom rarer.
   */
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue

      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }

      // This file names both credentials by necessity; it is the boundary's
      // own check, not a module that reaches across it.
      if (full === __filename) continue
      if (!SCANNED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue

      found.push({ path: relative(REPO_ROOT, full), text: readFileSync(full, 'utf8') })
    }
  }

  for (const directory of SCANNED_DIRECTORIES) {
    const full = join(REPO_ROOT, directory)
    try {
      if (statSync(full).isDirectory()) walk(full)
    } catch {
      // A directory that does not exist yet is not a violation. `scripts/`
      // arrives with Task 4.
    }
  }

  return found
}

const manifest = loadManifest()

/** A deep copy, so a planted violation cannot leak into another test. */
const planted = (mutate: (draft: DeployManifest) => DeployManifest): DeployManifest =>
  mutate(JSON.parse(JSON.stringify(manifest)) as DeployManifest)

describe('AD-10: the dual-LLM boundary', () => {
  describe('the guard can actually fail (C1, C2)', () => {
    it('reads a manifest that exists and parses', () => {
      expect(manifest.units.length).toBeGreaterThan(0)
    })

    it('scans a non-empty set of source files', () => {
      // Without this, `modulesReadingBothSides` could be scanning nothing and
      // reporting a clean boundary.
      expect(sourceFiles().length).toBeGreaterThan(20)
    })

    it('reports a violation when a side declares no credential, rather than finding no conflict', () => {
      // The failure this whole file is shaped around: the reasoning side does
      // not exist yet, so an emptied side must be loud rather than silent.
      const empty = planted((draft) => ({
        ...draft,
        sides: { ...draft.sides, reasoning: { ...draft.sides.reasoning, credentials: [] } },
      }))

      expect(boundaryViolations(empty).map((v) => v.kind)).toContain('vacuous')
    })

    it('reports a violation when there are no deploy units at all', () => {
      expect(boundaryViolations(planted((draft) => ({ ...draft, units: [] }))).map((v) => v.kind)).toContain(
        'vacuous',
      )
    })
  })

  describe('the declared topology holds', () => {
    it('has no violations', () => {
      expect(boundaryViolations(manifest)).toEqual([])
    })

    it('declares both sides, which is what makes the clauses below meaningful', () => {
      expect(manifest.sides.extraction.credentials.length).toBeGreaterThan(0)
      expect(manifest.sides.reasoning.credentials.length).toBeGreaterThan(0)
    })
  })

  describe('different deploy unit (C3)', () => {
    it('fails when one unit carries both responsibilities', () => {
      const violation = planted((draft) => ({
        ...draft,
        units: draft.units.map((unit, index) =>
          index === 0
            ? {
                ...unit,
                responsibilities: [...unit.responsibilities, draft.sides.reasoning.responsibility],
              }
            : unit,
        ),
      }))

      expect(boundaryViolations(violation).map((v) => v.kind)).toContain('shared-unit')
    })

    it('names the offending unit, so the failure is actionable', () => {
      const violation = planted((draft) => ({
        ...draft,
        units: draft.units.map((unit, index) =>
          index === 0
            ? {
                ...unit,
                responsibilities: [...unit.responsibilities, draft.sides.reasoning.responsibility],
              }
            : unit,
        ),
      }))

      expect(boundaryViolations(violation)[0]?.detail).toContain(manifest.units[0]!.name)
    })
  })

  describe('different credential (C4)', () => {
    it('fails when one unit holds credentials for both sides', () => {
      // Survives someone relabelling responsibilities without moving the keys.
      const violation = planted((draft) => ({
        ...draft,
        units: draft.units.map((unit, index) =>
          index === 0
            ? { ...unit, credentials: [...unit.credentials, ...draft.sides.reasoning.credentials] }
            : unit,
        ),
      }))

      expect(boundaryViolations(violation).map((v) => v.kind)).toContain('shared-credential')
    })

    it('fails when the same credential name is declared on both sides', () => {
      const violation = planted((draft) => ({
        ...draft,
        sides: {
          ...draft.sides,
          reasoning: { ...draft.sides.reasoning, credentials: [...draft.sides.extraction.credentials] },
        },
      }))

      expect(boundaryViolations(violation).map((v) => v.kind)).toContain('shared-credential')
    })
  })

  describe('a declared, usable origin (C5)', () => {
    it('fails on an origin that cannot be parsed, rather than passing it', () => {
      const violation = planted((draft) => ({
        ...draft,
        sides: { ...draft.sides, reasoning: { ...draft.sides.reasoning, origin: 'not-a-url' } },
      }))

      expect(boundaryViolations(violation).map((v) => v.kind)).toContain('undeclared-origin')
    })

    it('fails on a plaintext origin, which the API key would travel over', () => {
      const violation = planted((draft) => ({
        ...draft,
        sides: {
          ...draft.sides,
          extraction: { ...draft.sides.extraction, origin: 'http://generativelanguage.googleapis.com' },
        },
      }))

      expect(boundaryViolations(violation).map((v) => v.kind)).toContain('undeclared-origin')
    })

    it('the two sides share a host deliberately, and that is not a violation', () => {
      // The clause this file used to enforce, inverted. Reasoning moved to
      // `gemini-3.6-flash` on 2026-08-10 and extraction is `gemini-3.1-flash-lite`,
      // so one host is the intended topology. Pinned rather than left implicit: a
      // reader of a green suite would otherwise have to infer that the same-host
      // manifest passes on purpose rather than because nothing looks.
      expect(new URL(manifest.sides.extraction.origin).host).toBe(
        new URL(manifest.sides.reasoning.origin).host,
      )
      expect(boundaryViolations(manifest)).toEqual([])
    })

    it('the real credentials are genuinely different names', () => {
      // What the withdrawn vendor clause used to cover is now carried entirely by
      // credential separation, so it is asserted against the real manifest rather
      // than only against planted violations.
      const shared = manifest.sides.extraction.credentials.filter((name) =>
        manifest.sides.reasoning.credentials.includes(name),
      )

      expect(shared).toEqual([])
    })
  })

  describe('no module reads both sides (C6)', () => {
    /**
     * A generous timeout, and not to mask anything. This walks 192 files across
     * `core`, `adapters`, `app` and `scripts` with synchronous reads, which is
     * ~770ms alone and timed out at vitest's 5s default when story 3.4's full
     * suite ran it against a loaded machine. The assertion is unchanged; a
     * whole-repository scan competing with every other worker simply needs more
     * than five seconds of headroom, and an intermittently red gate is one
     * people learn to re-run rather than read.
     */
    it('finds none in the repository', { timeout: 30_000 }, () => {
      expect(modulesReadingBothSides(sourceFiles(), manifest)).toEqual([])
    })

    it('finds a planted one, so the scan is doing something', () => {
      const planted = [
        {
          path: 'app/bad-idea.ts',
          text: `const a = process.env.${manifest.sides.extraction.credentials[0]}
                 const b = process.env.${manifest.sides.reasoning.credentials[0]}`,
        },
      ]

      expect(modulesReadingBothSides(planted, manifest)).toHaveLength(1)
    })

    it('does not flag a file that merely names both, such as a test fixture', () => {
      // Found for real: `forbidden-credentials.test.ts` lists both names in its
      // fixture of credentials NFR-2 must permit, and reads neither. A detector
      // that flags legitimate mentions is the one that gets deleted by the
      // first developer it inconveniences.
      const fixture = [
        {
          path: 'core/security/forbidden-credentials.test.ts',
          text: `const PERMITTED_NAMES = ['${manifest.sides.extraction.credentials[0]}', '${manifest.sides.reasoning.credentials[0]}']`,
        },
      ]

      expect(modulesReadingBothSides(fixture, manifest)).toEqual([])
    })

    it.each([
      ['destructured', 'const { NAME_A } = process.env; const { NAME_B } = process.env'],
      ['destructured and renamed', 'const { NAME_A: a } = process.env, { NAME_B: b } = process.env'],
      ['destructured together with others', 'const { PORT, NAME_A, NAME_B } = process.env'],
    ])('flags a %s read', (_label, template) => {
      // `const { GEMINI_API_KEY } = process.env` never touches `env.NAME`, so the
      // first version of the scan could not see it at all.
      const text = template
        .replace(/NAME_A/g, manifest.sides.extraction.credentials[0]!)
        .replace(/NAME_B/g, manifest.sides.reasoning.credentials[0]!)

      expect(modulesReadingBothSides([{ path: 'app/x.ts', text }], manifest)).toHaveLength(1)
    })

    it('does not flag a destructure naming only one side', () => {
      const text = `const { PORT, ${manifest.sides.extraction.credentials[0]} } = process.env`

      expect(modulesReadingBothSides([{ path: 'app/x.ts', text }], manifest)).toEqual([])
    })

    it('still flags bracket-notation reads, so the narrowing is not an escape hatch', () => {
      const sneaky = [
        {
          path: 'app/sneaky.ts',
          text: `process.env['${manifest.sides.extraction.credentials[0]}'] + process.env["${manifest.sides.reasoning.credentials[0]}"]`,
        },
      ]

      expect(modulesReadingBothSides(sneaky, manifest)).toHaveLength(1)
    })

    it('does not flag a module reading only one side', () => {
      // A guard that flags everything is as useless as one that flags nothing,
      // and gets deleted faster.
      const innocent = [
        { path: 'adapters/extraction/x.ts', text: `process.env.${manifest.sides.extraction.credentials[0]}` },
      ]

      expect(modulesReadingBothSides(innocent, manifest)).toEqual([])
    })
  })
})
