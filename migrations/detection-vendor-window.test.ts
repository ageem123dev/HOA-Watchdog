/**
 * Migration 022: the index both invoice detectors read through.
 *
 * An index is an awkward thing to test, because the property that matters —
 * "the planner uses it" — is not one a table of nineteen rows will demonstrate:
 * a sequential scan really is cheaper at that size, and asserting a plan would
 * pin the planner's arithmetic rather than this migration's.
 *
 * So what is asserted is the two things that can actually break:
 *
 * 1. **The index exists and covers what the queries narrow on.** Not its exact
 *    text — a definition string is a spelling test — but that the folded vendor
 *    name leads it, that `issued_on` follows, and that it is partial on
 *    invoices, which is what makes it serve `priorCandidates` and
 *    `trailingInvoices` at once.
 *
 * 2. **`vendor_normalised_name` is still declared IMMUTABLE** — and the reason
 *    is not the one it looks like. This file first carried a third case
 *    asserting that migration 022's `create index` still executes, on the
 *    theory that Postgres refuses an expression index over anything less than
 *    IMMUTABLE. The sensitivity check killed it: with the function marked
 *    `stable`, and then `volatile`, the index was created anyway. It is a
 *    SQL-language function, so Postgres inlines it and checks the *body*'s
 *    volatility rather than the wrapper's label.
 *
 *    That makes this assertion worth more, not less. The database enforces
 *    nothing about the label, the planner trusts it everywhere else, and so the
 *    only thing standing behind migration 009's declaration is a test that says
 *    it is still true.
 */

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const adminUrl = process.env.DATABASE_URL
const configured = Boolean(adminUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn('\n  migration 022 tests SKIPPED: DATABASE_URL must be set.\n')
}

let owner: Client

describeWithDatabase('the index both invoice detectors read through', () => {
  beforeAll(async () => {
    owner = new Client({ connectionString: adminUrl })
    await owner.connect()
  })

  afterAll(async () => {
    await owner.end()
  })

  it('indexes the folded vendor name first, then the issue date', async () => {
    const { rows } = await owner.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where tablename = 'extraction' and indexname = 'extraction_vendor_window_idx'`,
    )

    expect(rows).toHaveLength(1)

    const definition = rows[0]!.indexdef
    // The folded name leads: both detectors have an equality on it, and a
    // btree can only walk a range under an equality prefix.
    expect(definition).toMatch(/\(vendor_normalised_name\(vendor_name\), issued_on\)/)
    // Partial: a bank statement's rows are the bulk of a real upload and no
    // detection query ever looks at them.
    expect(definition).toMatch(/WHERE \(document_kind = 'invoice'/)
  })

  it('rests on a vendor_normalised_name that is still declared immutable', async () => {
    // `i` = immutable. Nothing in the database enforces this — see the header —
    // so this expectation is the enforcement.
    const { rows } = await owner.query<{ provolatile: string }>(
      `select provolatile from pg_proc where proname = 'vendor_normalised_name'`,
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.provolatile).toBe('i')
  })
})
