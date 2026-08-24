/**
 * Who may call `ingest`, and why the list is closed (story 5.8).
 *
 * ## The gap the integration pass found
 *
 * Story 5.8 refuses a deposit upload until an assessment roll has created units,
 * and it puts that refusal in `app/upload/actions.ts`. Story 5.7 had already
 * given `ingest` a second caller — a mapping change re-imports affected
 * documents — which is deliberately exempt, because by then units exist.
 *
 * Both facts are asserted. `app/upload/actions.test.ts` proves the upload path
 * is guarded; `core/mapping/reimport-boundary.test.ts` proves the re-import
 * never reaches the census. **Neither says there is nothing else.**
 *
 * That matters because 5.8's guarantee is not "the upload action refuses
 * deposits". It is "deposits cannot land before a roll". A third caller — a bulk
 * import, a scheduled job, an admin route — would satisfy every existing test
 * and reopen the trap completely, because the guard lives at one entry point
 * rather than in `ingest` itself.
 *
 * ## Why the guard is not in `ingest`
 *
 * It cannot be. The re-import calls `ingest` for documents whose deposits are
 * exactly the ones this rule is about, and refusing them there would break a
 * mapping change for a reason about first-time setup. So the rule is enforced
 * per entry point, and the price of that choice is this file: the set of entry
 * points has to be closed, and closed visibly.
 *
 * ## What a new caller should do
 *
 * Add it here, and decide in writing whether it accepts deposits from an
 * association that may have no units. If it does, it needs the same refusal
 * `app/upload/actions.ts` carries. If it cannot (like the re-import), say so.
 * Failing this test is the prompt for that decision, not an obstacle to it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { specifiersIn } from '../ports/module-specifiers'
import { neutralise } from '../ports/declared-members'

const root = join(__dirname, '..', '..')

/** Every source file under the directories that could reach ingestion. */
function sources(from: string): string[] {
  const found: string[] = []

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue

      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }

      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue
      found.push(path)
    }
  }

  walk(join(root, from))
  return found
}

/**
 * Files that import `ingest` as a **value** — the ones that can actually call
 * it. Type-only imports are not callers: `upload-state.ts` and
 * `upload-feedback.ts` name `IngestOutcome` and could not invoke anything.
 */
const callers = [...sources('app'), ...sources('core'), ...sources('adapters')]
  .filter((path) => {
    const code = neutralise(readFileSync(path, 'utf8')).commentsBlanked
    if (!specifiersIn(code).some((specifier) => /(^|\/)ingest$/.test(specifier))) return false

    // `import type { ... }` cannot call anything.
    return /import\s+\{[^}]*\bingest\b[^}]*\}\s+from\s+['"][^'"]*ingest['"]/.test(code)
  })
  .map((path) => path.slice(root.length + 1).replace(/\\/g, '/'))

/**
 * Every entry point that may invoke `ingest`, and what each one does about
 * story 5.8's rule.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  'app/upload/actions.ts': 'refuses deposits until the association holds units',
  'app/onboarding/mapping/reimport-actions.ts':
    'exempt: a re-import is not a first upload, and units exist by then',
}

describe('the set of things that can call ingest is closed', () => {
  it('has exactly the callers this project has decided about', () => {
    /**
     * A new name here is not a failure to route around. It is the moment to
     * decide whether that caller can accept deposits from an association with no
     * units — and if it can, to give it the same refusal.
     */
    expect(callers.sort()).toEqual(Object.keys(ALLOWED).sort())
  })

  it('is not passing because it found nothing to check', () => {
    // Every assertion above is satisfied by an empty list: a broken scanner, a
    // changed import style, a walk that silently skipped a directory. This
    // project has shipped that shape twelve times.
    expect(callers.length).toBeGreaterThan(0)
    expect(sources('app').length).toBeGreaterThan(10)
  })

  it('finds the upload action, which is the one carrying the refusal', () => {
    // The positive control for the scanner itself: if it cannot see this file,
    // its silence about any other file means nothing.
    expect(callers).toContain('app/upload/actions.ts')
  })
})
