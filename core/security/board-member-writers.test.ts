/**
 * Who may write `board_member`, and why the list is closed (story 5.9).
 *
 * ## The privilege this protects
 *
 * A row in `board_member` is an account that can sign in and read an
 * association's financial records. Creating one is the highest privilege the
 * product grants, and until this story it was granted only to somebody holding
 * `WATCHDOG_WRITER_DATABASE_URL` and running a script.
 *
 * Story 5.9 moves that into the product, scoped to the inviting director's
 * association. That scoping lives in one adapter — so a fourth writer added
 * later would inherit none of it, and would be invisible to every behavioural
 * test in this story, all of which go through the path that *is* scoped.
 *
 * ## AC7 said two, and there are three
 *
 * The story's acceptance criterion was written from what this story adds rather
 * than from what the codebase holds. `user-directory-postgres.ts` has
 * `updatePasswordHash`, which `authenticate.ts` calls on a successful sign-in
 * when the stored hash uses outdated scrypt parameters.
 *
 * It is a legitimate writer and it is not a *creator*, which is the distinction
 * that matters: it changes a hash for a member who already exists and can bring
 * nobody into being. The list below records that rather than pretending it away.
 *
 * ## What this cannot see
 *
 * A query assembled from fragments at runtime is invisible to a text scan. That
 * is why the real control is the port — `DirectorRoster` is the only interface
 * offering creation, and `core/ports/` is small enough to read. This test
 * catches the ordinary case: somebody writing SQL in a new file.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..', '..')

/** Every non-test source file under the directories that could hold a writer. */
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

      // Test files insert fixtures legitimately — nine of them do. They are
      // excluded, and that exclusion is where a real writer could hide, so the
      // assertions below are about the production set rather than about a count.
      if (!/\.(ts|tsx|mjs)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) continue
      found.push(path)
    }
  }

  walk(join(root, from))
  return found
}

const WRITES = /\b(insert\s+into|update|delete\s+from)\s+board_member\b/i

const writers = [...sources('app'), ...sources('core'), ...sources('adapters'), ...sources('scripts')]
  .filter((path) => WRITES.test(readFileSync(path, 'utf8')))
  .map((path) => path.slice(root.length + 1).replace(/\\/g, '/'))
  .sort()

/** Every file that may write `board_member`, and what each is allowed to do. */
const ALLOWED: Readonly<Record<string, string>> = {
  'adapters/db/director-roster-postgres.ts':
    'creates, scoped to the inviting director’s association',
  'scripts/add-board-member.mjs':
    'creates the first director of an association, and resets a locked-out password',
  'adapters/auth/user-directory-postgres.ts':
    'updates a hash only, on sign-in, for a member who already exists',
}

describe('the set of things that can write board_member is closed', () => {
  it('has exactly the writers this project has decided about', () => {
    /**
     * A new name here is not an obstacle. It is the moment to decide whether
     * that writer *creates* accounts — and if it does, whether it derives the
     * association from an authenticated member the way the roster does.
     */
    expect(writers).toEqual(Object.keys(ALLOWED).sort())
  })

  it('is not passing because it found nothing to check', () => {
    // The assertion above is satisfied by an empty list on both sides if the
    // scanner breaks — a changed statement style, a walk that skipped a
    // directory. This project has shipped that shape twelve times.
    expect(writers.length).toBe(3)
    expect(sources('adapters').length).toBeGreaterThan(20)
  })

  it('finds the adapter that certainly writes', () => {
    // The positive control for the scanner itself. If it cannot see the file
    // this story just added, its silence about any other file means nothing.
    expect(writers).toContain('adapters/db/director-roster-postgres.ts')
  })
})
