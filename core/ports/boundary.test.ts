/**
 * The hexagonal boundary, enforced rather than described.
 *
 * The architecture spine's paradigm and this story's Project Structure Notes
 * both say it: *"`core/` imports nothing outward."* Until now that was a
 * sentence in a document, which is the kind of rule that holds until the first
 * afternoon someone needs a bucket name in a hurry.
 *
 * It matters concretely. `core/ingestion` has to be runnable in a test with no
 * network, no credentials and no database — that is what makes the accept/reject
 * rules and the hashing cheap enough to test exhaustively. One `@aws-sdk` import
 * inside `core/` takes that away, and takes the port's meaning with it.
 */

import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const CORE = join(process.cwd(), 'core')

/** Packages and directories that belong on the outside of the boundary. */
const FORBIDDEN = [
  { specifier: '@aws-sdk', why: 'object storage belongs to adapters/storage' },
  { specifier: 'pg', why: 'the database belongs to adapters/db' },
  { specifier: 'next-auth', why: 'the auth framework belongs to adapters/auth' },
  { specifier: 'next', why: 'the framework belongs to app/ and adapters/' },
  { specifier: '../../adapters', why: 'core must not import an adapter' },
  { specifier: '@/adapters', why: 'core must not import an adapter' },
] as const

async function sourceFilesUnderCore(): Promise<string[]> {
  const entries = await readdir(CORE, { recursive: true, withFileTypes: true })

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
}

/**
 * Matches the module specifier of a static import or a re-export. Tests are
 * excluded by the caller, not here — a test may legitimately read a file that
 * mentions these names, and this one does.
 */
const IMPORT_SPECIFIER = /(?:^|\n)\s*(?:import|export)[^\n]*?from\s+['"]([^'"]+)['"]/g

describe('the core/ boundary', () => {
  it('finds source files to check, so a rename cannot make this test vacuous', async () => {
    // Without this, a moved directory turns every assertion below into a loop
    // over an empty list, and the suite reports green on an unenforced rule.
    const files = await sourceFilesUnderCore()

    expect(files.length).toBeGreaterThan(10)
  })

  it('has nothing under core/ importing an outward dependency', async () => {
    const files = (await sourceFilesUnderCore()).filter((file) => !file.endsWith('.test.ts'))
    const violations: string[] = []

    for (const file of files) {
      const source = readFileSync(file, 'utf8')

      for (const [, specifier] of source.matchAll(IMPORT_SPECIFIER)) {
        const forbidden = FORBIDDEN.find(
          (entry) => specifier === entry.specifier || specifier.startsWith(`${entry.specifier}/`),
        )

        if (forbidden) {
          violations.push(
            `${relative(process.cwd(), file)} imports ${specifier} — ${forbidden.why}`,
          )
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('detects a violation when one is present', async () => {
    // The inverse. The test above passes just as happily if the regex matches
    // nothing at all, so prove the matcher fires on a known-bad line before
    // trusting an empty result from it.
    const planted = `import { S3Client } from '@aws-sdk/client-s3'\n`
    const found = [...planted.matchAll(IMPORT_SPECIFIER)].map(([, specifier]) => specifier)

    expect(found).toEqual(['@aws-sdk/client-s3'])
    expect(
      FORBIDDEN.some((entry) => found[0]?.startsWith(`${entry.specifier}/`)),
    ).toBe(true)
  })
})
