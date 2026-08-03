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
 * ## What this check sees, and what it does not
 *
 * It reads four surfaces:
 *
 *  1. the environment of the process running it;
 *  2. every `.env*` file on disk beneath the repository root — **including
 *     untracked and git-ignored ones**, because `.env` is git-ignored by design
 *     and is still loaded into the environment by `next build` and `next dev`,
 *     which makes it the most likely way a credential ever reaches a deploy unit;
 *  3. tracked CI and example config, parsed both for assignments and for
 *     `${{ secrets.NAME }}` references — renaming the variable a secret is mapped
 *     onto does not hide which secret is being reached for;
 *  4. JSON config such as `vercel.json`, whose quoted keys no line parser sees.
 *
 * It cannot see a secret that exists only in a hosting dashboard or in GitHub's
 * secret store and is never referenced by tracked config nor mapped into the
 * environment of this process. That is a real limit and it is stated rather than
 * papered over: surface 3 is what gives the check reach over CI secrets, because
 * a secret that is never referenced in a tracked workflow cannot be used by one.
 *
 * That reach is narrower for GitLab than for GitHub, and the difference matters.
 * `secretReferencesFromText` recognises `${{ secrets.NAME }}`, which is GitHub's
 * syntax. GitLab injects CI/CD variables as bare `$NAME`, indistinguishable from
 * any other shell variable, so reference-following gives no reach over the GitLab
 * variable store. `.gitlab-ci.yml` is still read and still parsed for outright
 * assignments — a credential written into a `variables:` block is caught — but a
 * name that appears only as `$SOMETHING` in a script line is not treated as a
 * secret reference. Closing that gap means a GitLab-specific reference pattern,
 * which is a change to `secretReferencesFromText` rather than to this list.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  entriesFromEnv,
  entriesFromJson,
  entriesFromText,
  secretReferencesFromText,
  type ConfigEntry,
} from './config-entries'
import { describeViolations, findForbiddenCredentials } from './forbidden-credentials'

/**
 * Resolved from this file rather than from `process.cwd()`. A guard whose reach
 * depends on which directory the runner was launched from can silently inspect
 * nothing and still report compliance.
 */
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: dirname(fileURLToPath(import.meta.url)),
  encoding: 'utf8',
}).trim()

/**
 * Tracked config worth reading in full, as git pathspecs relative to the root.
 *
 * Both CI systems are listed. GitLab is the one this project actually runs, and
 * omitting it would leave the guard reading a pipeline definition nobody executes
 * while ignoring the one that does — a check that inspects the wrong file and
 * still reports compliance.
 */
const TRACKED_CONFIG_PATHSPECS = [
  '**/.env*',
  '**/*.env.example',
  '.github/workflows/*.yml',
  '.github/workflows/*.yaml',
  '.gitlab-ci.yml',
  '.gitlab-ci.yaml',
]

const JSON_CONFIG_FILES = ['vercel.json']

/** Never descended into: vendored code, build output, and BMad's own tooling. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.next',
  '.git',
  '.agents',
  '.claude',
  '_bmad',
  '_bmad-output',
  'coverage',
  'out',
])

const MAX_WALK_DEPTH = 4

/**
 * Finds `.env*` files on disk, git-ignored ones included. Bounded by depth and
 * by an explicit skip list so this never becomes a full-repository walk.
 */
function dotEnvFilesOnDisk(directory: string = REPO_ROOT, depth = 0): string[] {
  if (depth > MAX_WALK_DEPTH) return []

  const found: string[] = []
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (item.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(item.name)) continue
      found.push(...dotEnvFilesOnDisk(join(directory, item.name), depth + 1))
    } else if (item.name.startsWith('.env')) {
      found.push(join(directory, item.name))
    }
  }
  return found
}

function trackedConfigFiles(): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--', ...TRACKED_CONFIG_PATHSPECS],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  return output
    .split('\0')
    .filter((path) => path.length > 0)
    .map((path) => join(REPO_ROOT, path))
}

function jsonConfigFilesOnDisk(): string[] {
  const present = new Set(readdirSync(REPO_ROOT))
  return JSON_CONFIG_FILES.filter((name) => present.has(name)).map((name) => join(REPO_ROOT, name))
}

function label(absolutePath: string): string {
  return relative(REPO_ROOT, absolutePath).split(sep).join('/')
}

interface Scan {
  readonly entries: ConfigEntry[]
  readonly filesInspected: string[]
}

function scanDeployUnit(): Scan {
  const entries = entriesFromEnv('process.env', process.env)
  const filesInspected = new Set<string>()

  const textFiles = [...dotEnvFilesOnDisk(), ...trackedConfigFiles()]
  for (const path of textFiles) {
    const name = label(path)
    if (filesInspected.has(name)) continue
    filesInspected.add(name)

    const content = readFileSync(path, 'utf8')
    entries.push(...entriesFromText(name, content), ...secretReferencesFromText(name, content))
  }

  for (const path of jsonConfigFilesOnDisk()) {
    const name = label(path)
    filesInspected.add(name)
    entries.push(...entriesFromJson(name, readFileSync(path, 'utf8')))
  }

  return { entries, filesInspected: [...filesInspected] }
}

describe('NFR-2: no external write credentials in this deploy unit', () => {
  it('holds no credential for a banking platform, payment processor, or external accounting system', () => {
    const violations = findForbiddenCredentials(scanDeployUnit().entries)

    expect(
      violations,
      violations.length === 0
        ? ''
        : `NFR-2 violation — remove the credential, do not weaken this check:\n${describeViolations(violations)}`,
    ).toEqual([])
  })

  it('read at least one configuration file, so a collection failure cannot pass as compliance', () => {
    // Asserted on the files specifically. process.env alone always yields dozens
    // of entries, so a check on the total would stay green with every file
    // silently unread — which is the failure this test exists to catch.
    expect(scanDeployUnit().filesInspected).not.toHaveLength(0)
  })

  it('inspects the CI workflow, whose secret references are its reach over the CI secret store', () => {
    expect(scanDeployUnit().filesInspected).toContain('.github/workflows/ci.yml')
  })
})
