/**
 * The hexagonal boundary, enforced rather than described.
 *
 * The architecture spine's paradigm and story 1.4's Project Structure Notes both
 * say it: *"`core/` imports nothing outward."* That was a sentence in a document
 * until this test, which is the kind of rule that holds until the first afternoon
 * someone needs a bucket name in a hurry.
 *
 * It matters concretely. `core/ingestion` has to be runnable with no network, no
 * credentials and no database — that is what makes the accept/reject rules and
 * the hashing cheap enough to test exhaustively. One `@aws-sdk` import inside
 * `core/` takes that away, and takes the port's meaning with it.
 *
 * **The detector is tested against planted violations.** The first version of
 * this file matched only `from '…'` on a single line, so a formatter wrapping a
 * long import list, a side-effect `import 'pg'`, a dynamic `import()`, a
 * `require()`, or `'../adapters'` written from a different depth all passed. A
 * boundary test that reports green on the violations it exists to catch is worse
 * than none: it makes the guarantee feel checked.
 */

import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = process.cwd()
const CORE = join(REPO_ROOT, 'core')

/** Package specifiers that belong on the outside of the boundary. */
const FORBIDDEN_PACKAGES = [
  { specifier: '@aws-sdk', why: 'object storage belongs to adapters/storage' },
  { specifier: 'pg', why: 'the database belongs to adapters/db' },
  { specifier: 'next-auth', why: 'the auth framework belongs to adapters/auth' },
  { specifier: 'next', why: 'the framework belongs to app/ and adapters/' },
  { specifier: 'xlsx', why: 'the spreadsheet parser belongs to adapters/extraction' },
] as const

/** Directories `core/` must not reach into, however the path is spelled. */
const FORBIDDEN_DIRECTORIES = [
  { directory: join(REPO_ROOT, 'adapters'), why: 'core must not import an adapter' },
  { directory: join(REPO_ROOT, 'app'), why: 'core must not import the surface' },
] as const

/**
 * Every module specifier, in every form that loads a module:
 *
 * - `from '…'`      — static import or re-export, **including one wrapped across
 *                     lines by a formatter**, since this matches only the tail
 * - `import '…'`    — side-effect import, which has no `from` at all
 * - `import('…')`   — dynamic import
 * - `require('…')`  — CommonJS
 */
const MODULE_SPECIFIER = /\b(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g

export interface BoundaryViolation {
  readonly specifier: string
  readonly why: string
}

/**
 * Exported so the detector can be tested directly against planted violations
 * rather than only against a tree that is expected to be clean. A scan over
 * clean files cannot distinguish "nothing is wrong" from "nothing is checked".
 */
export function forbiddenImportsIn(source: string, filePath: string): BoundaryViolation[] {
  const violations: BoundaryViolation[] = []

  for (const [, specifier] of source.matchAll(MODULE_SPECIFIER)) {
    const packageMatch = FORBIDDEN_PACKAGES.find(
      (entry) => specifier === entry.specifier || specifier.startsWith(`${entry.specifier}/`),
    )

    if (packageMatch) {
      violations.push({ specifier, why: packageMatch.why })
      continue
    }

    // Relative and aliased paths are resolved to an absolute location before
    // being judged. `'../adapters'`, `'../../adapters'` and `'@/adapters/db/x'`
    // are the same violation written from three depths, and a literal list of
    // spellings will always be one depth short.
    const resolved = specifier.startsWith('.')
      ? resolve(dirname(filePath), specifier)
      : specifier.startsWith('@/')
        ? join(REPO_ROOT, specifier.slice(2))
        : null

    if (resolved === null) continue

    const directoryMatch = FORBIDDEN_DIRECTORIES.find(
      (entry) => resolved === entry.directory || resolved.startsWith(entry.directory + '\\') ||
        resolved.startsWith(entry.directory + '/'),
    )

    if (directoryMatch) violations.push({ specifier, why: directoryMatch.why })
  }

  return violations
}

async function sourceFilesUnderCore(): Promise<string[]> {
  const entries = await readdir(CORE, { recursive: true, withFileTypes: true })

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
}

const SOME_CORE_FILE = join(CORE, 'ingestion', 'ingest.ts')

describe('the core/ boundary', () => {
  describe('the detector', () => {
    it.each([
      ['a plain import', `import { Pool } from 'pg'\n`],
      ['a scoped package', `import { S3Client } from '@aws-sdk/client-s3'\n`],
      ['the spreadsheet parser', `import * as XLSX from 'xlsx'\n`],
      [
        'an import wrapped across lines by a formatter',
        `import {\n  PutObjectCommand,\n  S3Client,\n} from '@aws-sdk/client-s3'\n`,
      ],
      ['a side-effect import', `import 'pg'\n`],
      ['a dynamic import', `const { Pool } = await import('pg')\n`],
      ['a require', `const { Pool } = require('pg')\n`],
      ['a re-export', `export { Pool } from 'pg'\n`],
      ['a type-only import', `import type { Pool } from 'pg'\n`],
      ['double quotes', `import { Pool } from "pg"\n`],
      ['an adapter two levels up', `import { x } from '../../adapters/db/y'\n`],
      ['an aliased adapter', `import { x } from '@/adapters/db/y'\n`],
      ['the app directory', `import { x } from '@/app/upload/actions'\n`],
    ])('catches %s', (_label, source) => {
      expect(forbiddenImportsIn(source, SOME_CORE_FILE)).not.toEqual([])
    })

    it('catches the same adapter import written from any depth', () => {
      // The reason the specifier is resolved rather than pattern-matched. These
      // are one violation spelled three ways, and a literal list of spellings is
      // always one depth short of the next directory someone adds.
      const fromCoreRoot = forbiddenImportsIn(
        `import { x } from '../adapters/db/y'\n`,
        join(CORE, 'x.ts'),
      )
      const fromOneDeep = forbiddenImportsIn(
        `import { x } from '../../adapters/db/y'\n`,
        join(CORE, 'ingestion', 'x.ts'),
      )
      const fromTwoDeep = forbiddenImportsIn(
        `import { x } from '../../../adapters/db/y'\n`,
        join(CORE, 'ingestion', 'nested', 'x.ts'),
      )

      expect(fromCoreRoot).not.toEqual([])
      expect(fromOneDeep).not.toEqual([])
      expect(fromTwoDeep).not.toEqual([])
    })

    it('does not flag a relative path that stays inside core, whatever it is called', () => {
      // `../adapters` from core/ingestion/ is `core/adapters` — a different
      // place entirely. Resolving is what tells them apart; matching on the
      // string cannot.
      expect(
        forbiddenImportsIn(`import { x } from '../adapters/y'\n`, SOME_CORE_FILE),
      ).toEqual([])
    })

    it.each([
      ['a node builtin', `import { createHash } from 'node:crypto'\n`],
      ['a sibling core module', `import { assess } from './acceptance'\n`],
      ['a port', `import type { DocumentStore } from '../ports/document-store'\n`],
      ['react', `import { useMemo } from 'react'\n`],
      ['the word next inside a longer package name', `import x from 'nextish-thing'\n`],
      ['a comment mentioning pg', `// the pg pool lives in adapters/db\n`],
      ['a string that is not an import', `const message = 'pg'\n`],
    ])('does not flag %s', (_label, source) => {
      expect(forbiddenImportsIn(source, SOME_CORE_FILE)).toEqual([])
    })
  })

  describe('the tree', () => {
    it('finds source files to check, so a rename cannot make this test vacuous', async () => {
      const files = await sourceFilesUnderCore()

      expect(files.length).toBeGreaterThan(10)
    })

    it('has nothing under core/ importing an outward dependency', async () => {
      const files = (await sourceFilesUnderCore()).filter((file) => !file.endsWith('.test.ts'))
      const violations: string[] = []

      for (const file of files) {
        for (const violation of forbiddenImportsIn(readFileSync(file, 'utf8'), file)) {
          violations.push(
            `${relative(REPO_ROOT, file)} imports ${violation.specifier} — ${violation.why}`,
          )
        }
      }

      expect(violations).toEqual([])
    })
  })
})
