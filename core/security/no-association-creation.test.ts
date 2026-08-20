/**
 * Nothing in the product creates an association — AC5 of story 5.1b.
 *
 * The pilot's association arrives by migration. A second one arrives in a test,
 * inserted by the test. No code path a user can reach makes one, and this file
 * is what keeps that true.
 *
 * ## Why a guard and not a note
 *
 * Row-level security does not exist. Scoping is by construction: a correct
 * catalog predicate and a correct derivation, two pieces of code that must both
 * be right. AD-4's amendment calls onboarding a second association without RLS a
 * **defect rather than a trade-off** — and story 5.1b deliberately left eight
 * product read paths matching on `normalised_number` and `normalised_name`
 * alone, which are unambiguous with one association and ambiguous with two.
 *
 * So the day a second association becomes creatable is a day that needs a
 * conversation, and a guard is what forces it. Without one, the second
 * association arrives as a feature nobody flagged, on top of read paths nobody
 * revisited.
 *
 * ## What this checks, and what it cannot
 *
 * It reads every production source file and asserts none contains an INSERT into
 * `association`. It cannot see an insert assembled from string fragments at
 * runtime, and it does not try — AD-5 forbids model-authored SQL and every query
 * in this repository is a literal, so a statement that is not visible as text
 * here is already a larger problem than this file's.
 *
 * Globbed rather than listed, unlike `no-model-in-alerts.test.ts`. That file
 * guards a short, named path where adding a module should be deliberate; this
 * one makes a claim about *the whole product*, and a hand-written list would
 * silently stop covering the directory somebody adds next.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = process.cwd()

/**
 * Where product code lives. `migrations/` is absent deliberately — the pilot
 * association is seeded there, which is the arrangement this test protects
 * rather than the one it forbids.
 */
const PRODUCT_DIRECTORIES = ['adapters', 'app', 'catalog', 'core', 'scripts']

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js'])

/** A test may create an association; that is how AC4's second board exists. */
const isTest = (path: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)

function productSources(): string[] {
  const found: string[] = []

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue

      const path = join(directory, entry)
      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }

      if (SOURCE_EXTENSIONS.has(extname(entry)) && !isTest(path)) found.push(path)
    }
  }

  for (const directory of PRODUCT_DIRECTORIES) walk(join(REPO_ROOT, directory))

  return found
}

/**
 * `association` and not `association_id`: `\b` does not fall between `n` and
 * `_`, so the column name cannot match. Every insert in this repository is a
 * literal string, so matching the text is matching the statement.
 */
const CREATES_AN_ASSOCIATION = /insert\s+into\s+"?association"?\b/i

describe('the matcher itself', () => {
  /**
   * A guard whose matcher is wrong is a guard that reports success forever. The
   * sweep below cannot tell "nothing inserts" from "the regex never matches
   * anything", so these two say which.
   */
  it.each([
    'insert into association (name) values ($1)',
    'INSERT INTO association(name) VALUES ($1)',
    'insert   into\n  "association" (name) values ($1)',
  ])('recognises %j as creating an association', (statement) => {
    expect(CREATES_AN_ASSOCIATION.test(statement)).toBe(true)
  })

  it.each([
    'insert into board_member (email, association_id) values ($1, $2)',
    'select association_id from board_member where id = $1',
    'insert into document (association_id) values ($1)',
  ])('does not mistake %j for creating one', (statement) => {
    expect(CREATES_AN_ASSOCIATION.test(statement)).toBe(false)
  })
})

describe('no product code path creates an association', () => {
  const sources = productSources()

  it('has product source files to read, so the sweep is not passing over nothing', () => {
    expect(sources.length).toBeGreaterThan(50)
  })

  it('finds no INSERT into association in any of them', () => {
    const offenders = sources.filter((path) =>
      CREATES_AN_ASSOCIATION.test(readFileSync(path, 'utf8')),
    )

    expect(
      offenders.map((path) => path.slice(REPO_ROOT.length + 1).replaceAll('\\', '/')),
      'an association may only be created by a migration, or by a test that needs a second one',
    ).toEqual([])
  })
})
