/**
 * Two properties of the SQL that a runtime test cannot settle.
 *
 * Both are about what a *concurrent* transaction may do, and neither can be
 * forced deterministically from a test: the interleaving that exposes them is
 * the one the database is free not to produce. Story 1.6c met the same wall with
 * an `order by` tiebreak — removing it was caught in only two runs out of three —
 * and the answer is the same, asserting the rule where it is deterministic.
 *
 * The database tests prove the behaviour is right when they run; this proves it
 * was asked for.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function adapterSource(): string {
  const path = join(dirname(fileURLToPath(import.meta.url)), 'vendor-resolution-postgres.ts')

  try {
    return readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\s+/g, ' ')
  } catch {
    return ''
  }
}

describe('the resolution SQL', () => {
  it('locks the vendor row the check depends on', () => {
    // Without `for key share`, the select proves the vendor existed at the
    // moment it was read. A concurrent transaction may delete it before this one
    // commits, and the hold is then cleared pointing at a vendor that is gone —
    // the exact failure the check was written to prevent, arriving one step
    // later. Raised in review.
    expect(adapterSource()).toContain('select id from vendor where id = $1 for key share')
  })

  it('states its isolation level rather than inheriting one', () => {
    // The conflict-then-select in `confirmAsNew` is only correct under `read
    // committed`: it needs a fresh snapshot to see the row that won the race.
    // Under `repeatable read` the select uses the transaction's snapshot, cannot
    // see the concurrently committed vendor, and a correct confirmation is
    // rolled back with `neither created nor found`.
    //
    // `default_transaction_isolation` is server configuration, so the argument
    // in the comments holds only where nobody has changed it. Stated in the SQL
    // instead.
    expect(adapterSource()).toContain('begin isolation level read committed')
  })

  it('reads the file it claims to read', () => {
    // The control: both assertions above pass against an empty string if the
    // read fails, which is the vacuous shape this project keeps finding.
    expect(adapterSource()).toContain('createVendorResolution')
  })
})
