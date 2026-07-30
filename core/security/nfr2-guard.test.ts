/**
 * NFR-2 — No external write tokens.
 *
 * "No API key with write permissions for a banking platform, payment processor,
 * or external accounting system may exist in the environment variables, secret
 * store, or CI configuration of any deploy unit. The air-gap is enforced by the
 * absence of the credential, not by a scope setting."
 *
 * AD-2 makes that absence structural rather than customary, and names its
 * enforcement explicitly: "The *absence* of write credentials (AD-2) is asserted
 * by a CI check, not left to convention." This file is that check. It runs in the
 * standard suite, so every push proves the property rather than assuming it.
 *
 * Removing or narrowing this test is an architecture change that needs a new AD.
 * It is not a cleanup, and it is not a flaky test to be quarantined. If it fails,
 * a credential for an external financial rail has entered the project and the
 * correct response is to remove the credential — never to widen the exemption.
 *
 * What this check can and cannot see: it reads the environment of the process
 * running it and the repository's own tracked configuration. It cannot read a
 * secret that lives only in a hosting dashboard and is never injected into a
 * build. CI is where deploy-unit secrets are injected to build and test, so the
 * check has real reach there — but the limit is real and is stated rather than
 * papered over.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { entriesFromEnv, entriesFromText, type ConfigEntry } from './config-entries'
import { describeViolations, findForbiddenCredentials } from './forbidden-credentials'

/**
 * Config files worth reading in full. Deliberately a narrow list rather than a
 * repository walk: a walk would descend into vendored tooling and into this
 * module's own test fixtures, and would report those instead of real findings.
 */
const CONFIG_PATHSPECS = [
  '.env*',
  '*.env.example',
  '.github/workflows/*.yml',
  '.github/workflows/*.yaml',
  'vercel.json',
]

function trackedConfigFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '-z', '--', ...CONFIG_PATHSPECS], {
    encoding: 'utf8',
  })
  return output.split('\0').filter((path) => path.length > 0)
}

function collectConfigEntries(): ConfigEntry[] {
  const entries = entriesFromEnv('process.env', process.env)

  for (const path of trackedConfigFiles()) {
    entries.push(...entriesFromText(path, readFileSync(path, 'utf8')))
  }

  return entries
}

describe('NFR-2: no external write credentials in this deploy unit', () => {
  it('holds no credential for a banking platform, payment processor, or external accounting system', () => {
    const violations = findForbiddenCredentials(collectConfigEntries())

    expect(
      violations,
      violations.length === 0
        ? ''
        : `NFR-2 violation — remove the credential, do not weaken this check:\n${describeViolations(violations)}`,
    ).toEqual([])
  })

  it('actually inspected something, so a silent collection failure cannot pass as compliance', () => {
    expect(collectConfigEntries().length).toBeGreaterThan(0)
  })
})
