/**
 * AD-15's other half, which is easy to state and easy to lose.
 *
 * "…versioned `/tools/*` endpoints, **which are the sole data path in the
 * system**." The rule is not only that the endpoint rejects strangers; it is
 * that there is nothing else to call. What it prevents is named in the AD's own
 * *Prevents* line: "Ad-hoc endpoints accumulating between the gateway and the
 * agent service."
 *
 * That is not a property a reviewer can hold in their head six stories from now,
 * when `app/` has a dozen routes and someone needs dues figures on a dashboard.
 * The tempting shortcut is to call the catalog executor directly from wherever
 * the number is wanted — perfectly reasonable-looking code that quietly makes
 * the "sole data path" claim false.
 *
 * So it is a test. The shape is `core/ports/boundary.test.ts`'s, including its
 * hardest-won lesson: **the detector is tested against planted violations**,
 * because a scanner that reports green on the thing it exists to catch is worse
 * than no scanner at all.
 */

import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

import { neutralise } from '../ports/declared-members'

const REPO_ROOT = process.cwd()

/** The one file allowed to reach the executor, relative to the repo root. */
const THE_DOOR = 'app/tools/v1/catalog/execute/route.ts'

/**
 * Every root where reaching the catalog would be a violation.
 *
 * The first draft scanned `app/` alone, which is narrower than the rule: a
 * server action, a script or a root-level module reaching the executor breaks
 * "sole data path in the system" just as thoroughly, and nothing would have
 * said so. Raised by CodeRabbit.
 *
 * `adapters/` and `catalog/` are deliberately absent — that is where the catalog
 * machinery lives, and `catalog-executor-postgres.ts` importing the registry is
 * the mechanism, not a violation of it.
 */
const SCANNED_ROOTS = ['app', 'core', 'scripts'] as const

/** What a caller would import to get at the catalog. */
const EXECUTOR_MODULES = ['adapters/db/catalog-executor-postgres', 'catalog/registry'] as const

/**
 * Every module specifier, in every form that loads a module — the same pattern
 * `boundary.test.ts` arrived at after a formatter-wrapped import, a side-effect
 * import, a dynamic `import()` and a `require()` each slipped past a narrower
 * one.
 */
/**
 * `.mjs` counts. `scripts/` is written in it, and a script reaching the catalog
 * breaks "sole data path in the system" exactly as a route would — scanning only
 * `.ts` there would have found no files at all and passed.
 */
const SOURCE = /\.(?:m?[jt]sx?)$/
const IS_TEST = /\.test\.(?:m?[jt]sx?)$/

const MODULE_SPECIFIER = /\b(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g

/**
 * Comments are removed first, and string *contents* are kept.
 *
 * Without that, a commented-out import fails the build for a line nobody
 * executes — verified, not assumed: the regex matches
 * `// import x from '@/adapters/db/catalog-executor-postgres'` exactly as
 * happily as the real thing. `neutralise` is `core/ports/declared-members.ts`'s,
 * shared rather than copied.
 *
 * **Comments only — string contents are kept, and must be.** The specifiers this
 * looks for live inside strings, so masking those would blank the very thing it
 * reads. The cost is stated rather than papered over: a string literal
 * *containing* an import statement is indistinguishable from a real one without
 * a parser, and would be reported. No production file in this repo does that,
 * and the test files that do are excluded from the sweep.
 */
export function reachesTheCatalog(source: string): readonly string[] {
  const { commentsBlanked } = neutralise(source)
  const found: string[] = []

  for (const match of commentsBlanked.matchAll(MODULE_SPECIFIER)) {
    const specifier = match[1]
    if (specifier === undefined) continue

    // `@/adapters/…`, `../../adapters/…` and `adapters/…` all name the same
    // module; compare on the tail rather than resolving, so a path written from
    // a different depth is not invisible.
    const normalised = specifier.replace(/\\/g, '/')
    if (EXECUTOR_MODULES.some((m) => normalised.endsWith(m))) found.push(specifier)
  }

  return found
}

async function productionFiles(directory: string, found: string[] = []): Promise<string[]> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) {
      await productionFiles(full, found)
    } else if (SOURCE.test(entry.name) && !IS_TEST.test(entry.name)) {
      found.push(relative(REPO_ROOT, full).split(sep).join('/'))
    }
  }

  return found
}

async function everyScannedFile(): Promise<string[]> {
  const perRoot = await Promise.all(
    SCANNED_ROOTS.map((root) => productionFiles(join(REPO_ROOT, root))),
  )
  const rootLevel = (await readdir(REPO_ROOT, { withFileTypes: true }))
    .filter((e) => e.isFile() && SOURCE.test(e.name) && !IS_TEST.test(e.name))
    .map((e) => e.name)

  return [...perRoot.flat(), ...rootLevel]
}

describe('the catalog has one door', () => {
  it('is reached from the tool endpoint and from nowhere else in the system', async () => {
    const files = await everyScannedFile()
    const reaching = files.filter(
      (file) => reachesTheCatalog(readFileSync(resolve(REPO_ROOT, file), 'utf8')).length > 0,
    )

    expect(reaching).toEqual([THE_DOOR])
  })

  it('finds files to scan in every root, so an empty sweep cannot pass', async () => {
    // The assertion above is also satisfied by a walk that returns nothing and a
    // `THE_DOOR` that no longer exists. Both halves are pinned, per root, so a
    // root silently dropping out of `SCANNED_ROOTS` fails here.
    for (const root of SCANNED_ROOTS) {
      const files = await productionFiles(join(REPO_ROOT, root))
      expect(files.length, `${root}/ contributed no files to the sweep`).toBeGreaterThan(0)
    }

    expect(await everyScannedFile()).toContain(THE_DOOR)
    expect(await everyScannedFile()).toContain('proxy.ts')
  })

  /**
   * The detector, against violations that have actually escaped narrower
   * versions of it elsewhere in this repo.
   */
  it.each([
    ['a plain import', "import { createCatalogExecutor } from '@/adapters/db/catalog-executor-postgres'"],
    ['a relative path from another depth', "import x from '../../../adapters/db/catalog-executor-postgres'"],
    ['a side-effect import', "import '@/adapters/db/catalog-executor-postgres'"],
    ['a dynamic import', "const m = await import('@/adapters/db/catalog-executor-postgres')"],
    ['a require', "const m = require('@/adapters/db/catalog-executor-postgres')"],
    [
      'an import wrapped across lines by a formatter',
      "import {\n  createCatalogExecutor,\n} from '@/adapters/db/catalog-executor-postgres'",
    ],
    ['reaching the registry instead', "import { entryFor } from '@/catalog/registry'"],
  ])('sees %s', (_label, source) => {
    expect(reachesTheCatalog(source)).toHaveLength(1)
  })

  it.each([
    ['an unrelated import', "import { auth } from '@/adapters/auth/auth'"],
    ['a similarly named module', "import x from '@/adapters/db/catalog-executor-postgres-notes'"],
    ['the module named in prose', '// the catalog/registry is reached only from the tool endpoint'],
    ['the module named in a string', "const note = 'adapters/db/catalog-executor-postgres'"],
    [
      'a commented-out import',
      "// import { createCatalogExecutor } from '@/adapters/db/catalog-executor-postgres'",
    ],
    [
      'an import inside a block comment',
      "/*\n import x from '@/adapters/db/catalog-executor-postgres'\n*/",
    ],
  ])('does not report %s', (_label, source) => {
    expect(reachesTheCatalog(source)).toHaveLength(0)
  })
})
