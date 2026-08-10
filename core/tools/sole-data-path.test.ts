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

const REPO_ROOT = process.cwd()
const APP = join(REPO_ROOT, 'app')

/** The one file allowed to reach the executor, relative to the repo root. */
const THE_DOOR = 'app/tools/v1/catalog/execute/route.ts'

/** What a caller would import to get at the catalog. */
const EXECUTOR_MODULES = ['adapters/db/catalog-executor-postgres', 'catalog/registry'] as const

/**
 * Every module specifier, in every form that loads a module — the same pattern
 * `boundary.test.ts` arrived at after a formatter-wrapped import, a side-effect
 * import, a dynamic `import()` and a `require()` each slipped past a narrower
 * one.
 */
const MODULE_SPECIFIER = /\b(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g

export function reachesTheCatalog(source: string): readonly string[] {
  const found: string[] = []

  for (const match of source.matchAll(MODULE_SPECIFIER)) {
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

async function routeFiles(directory: string, found: string[] = []): Promise<string[]> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) {
      await routeFiles(full, found)
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(relative(REPO_ROOT, full).split(sep).join('/'))
    }
  }

  return found
}

describe('the catalog has one door', () => {
  it('is reached from the tool endpoint and from nowhere else under app/', async () => {
    const files = await routeFiles(APP)
    const reaching = files.filter(
      (file) => reachesTheCatalog(readFileSync(resolve(REPO_ROOT, file), 'utf8')).length > 0,
    )

    expect(reaching).toEqual([THE_DOOR])
  })

  it('finds files to scan, so an empty sweep cannot pass', async () => {
    // The assertion above is also satisfied by a walk that returns nothing and a
    // `THE_DOOR` that no longer exists. Both halves are pinned.
    const files = await routeFiles(APP)

    expect(files.length).toBeGreaterThan(5)
    expect(files).toContain(THE_DOOR)
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
    ['the word in a comment', '// the catalog/registry is reached only from the tool endpoint'],
    ['the word in a string', "const note = 'adapters/db/catalog-executor-postgres'"],
  ])('does not report %s', (_label, source) => {
    expect(reachesTheCatalog(source)).toHaveLength(0)
  })
})
