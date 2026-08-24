/**
 * The mapping-change record, asserted as text (story 5.7, AC6).
 *
 * No database half. Every assertion worth making here is about the *shape* of
 * one insert, and `migrations/mapping-change.test.ts` already carries the
 * database half for this table — a second `describe.skip` block re-inserting the
 * same row would add a file that never runs and prove nothing twice.
 *
 * What it does assert are the three things that would be wrong in a way no type
 * checker sees: the association derived rather than passed, a null previous
 * mapping staying null, and the outcomes serialised as JSON rather than handed
 * to the driver as an array.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { neutralise } from '@/core/ports/declared-members'

const SOURCE = readFileSync(join(__dirname, 'mapping-change-log-postgres.ts'), 'utf8')

/** Comments blanked by the shared `neutralise`, not a local regex - see the sibling test. */
const code = neutralise(SOURCE).commentsBlanked

describe('the record insert', () => {
  it('derives the association from the member rather than taking it', () => {
    // This row is evidence about one board. A caller able to name the
    // association could file evidence against another one.
    expect(code).toMatch(
      /values \(\(select association_id from board_member where id = \$1\)/,
    )
    expect(code).not.toMatch(/associationId/)
  })

  it('writes and never rewrites', () => {
    // Migration 027 revokes UPDATE and DELETE, so either would fail at runtime,
    // in production, on a treasurer's second mapping change.
    expect(code).toMatch(/\binsert into mapping_change\b/i)
    expect(code).not.toMatch(/\bupdate\s+mapping_change\b|\bdelete\s+from\b/i)
  })

  it('keeps a first change null rather than the string "null"', () => {
    /**
     * `JSON.stringify(null)` is `'null'` — a jsonb value that is *present* and
     * means "no mapping", where the column being NULL means "nothing was
     * replaced". Migration 027 leaves the column nullable for exactly that
     * distinction, and `JSON.stringify` applied unconditionally erases it.
     */
    expect(code).toMatch(/change\.previous === null \? null : JSON\.stringify\(change\.previous\)/)
  })

  it('serialises the outcomes rather than handing the driver an array', () => {
    // `node-postgres` maps a JS array to a Postgres array; the column is jsonb.
    // The mismatch is at the driver, which the type checker cannot see.
    expect(code).toContain('JSON.stringify(change.documents)')
  })

  it('is not passing because the stripper emptied the file', () => {
    // Two of the assertions above are absences.
    expect(code).toContain('export function createMappingChangeLog')
  })
})
