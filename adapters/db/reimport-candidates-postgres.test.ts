/**
 * The re-import candidate query (story 5.7, Task 4).
 *
 * Text assertions only, and deliberately so. Every adapter test in this
 * directory is `describe.skip` without a database, and this query carries two
 * decisions that must not be lost quietly: the association is derived in SQL,
 * and the join is `distinct`. A rule proven only under a connection nobody has
 * configured is proven nowhere on this machine.
 *
 * `mapping-store-postgres.test.ts` learned the technique the hard way — three of
 * its five mutations survived the first version of its assertions.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(join(__dirname, 'reimport-candidates-postgres.ts'), 'utf8')

/** Comments stripped: this file's prose discusses every rule it asserts. */
const code = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')

describe('the candidate query', () => {
  it('derives the association from the member rather than taking it', () => {
    // This list decides whose financial history a re-import rewrites.
    expect(code).toContain('(select association_id from board_member where id = $1)')
    expect(code).not.toMatch(/associationId/)
  })

  it('returns each document once', () => {
    /**
     * One document has one extraction row per record it contained, so a
     * forty-line statement joins forty times. Without `distinct`, `reimport`
     * fetches it from object storage forty times and reports forty outcomes for
     * one file — 4h.
     */
    expect(code).toMatch(/select\s+distinct\b/i)
  })

  it('scopes by kind, on the table that actually carries it', () => {
    // `document_kind` is on `extraction`, not `document` — migration 006. A
    // query looking for it on `document` would not compile against the schema.
    expect(code).toMatch(/join extraction e on e\.document_id = d\.id/)
    expect(code).toMatch(/e\.document_kind = \$2/)
  })

  it('reads and does not write', () => {
    expect(code).not.toMatch(/\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b/i)
  })

  it('is not passing because the stripper emptied the file', () => {
    // Three of the four assertions above are satisfiable by an empty string.
    expect(code).toContain('export function createReimportCandidates')
  })
})
