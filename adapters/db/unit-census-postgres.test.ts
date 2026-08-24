/**
 * Does this member's association hold any units? (story 5.8, Task 1.)
 *
 * ## Two halves, and only one of them runs here
 *
 * The text half always runs and is where the tenancy rule is pinned. The
 * database half skips without a connection — and there is no database configured
 * on the machine this project is currently built on, so a rule proven only there
 * is proven nowhere. Story 5.7 established the split after the same discovery.
 *
 * ## The pool is not a preference
 *
 * A SELECT belongs on `readerPool` by instinct, and it cannot work here.
 * Migration 003 revokes **all** on `board_member` from `watchdog_reader` —
 * deliberately, because "the LLM-driven query path has no business with
 * credentials" — and deriving an association from a member means reading
 * `board_member`. A reader-pool version of this query fails at runtime, with a
 * permission error, on a path that only runs when somebody uploads.
 */

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { neutralise } from '@/core/ports/declared-members'

import { createUnitCensus } from './unit-census-postgres'

const SOURCE = readFileSync(join(__dirname, 'unit-census-postgres.ts'), 'utf8')

/** Comments blanked by the shared `neutralise`: this file's prose states every rule it asserts. */
const code = neutralise(SOURCE).commentsBlanked

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const adminUrl = process.env.DATABASE_URL
const configured = Boolean(writerUrl && adminUrl)
const describeWithDatabase = configured ? describe : describe.skip

describe('the association is derived, not asserted', () => {
  it('reads it from the member in SQL rather than taking it as a parameter', () => {
    /**
     * The rule `document-repository-postgres.ts` states as "a caller cannot
     * supply the wrong one". Here it decides whether another board's units
     * satisfy this board's upload — so a caller able to name an association
     * could unlock deposits against units that are not theirs.
     */
    expect(code).toContain('select association_id from board_member where id = $1')
  })

  it('never names an association id as a bound parameter', () => {
    // The failure this guards is a later edit adding one, not today's code.
    expect(code).not.toMatch(/associationId/)
  })

  it('scopes the unit lookup by that association', () => {
    // Without the clause the answer is "does *anyone* hold units", which on a
    // multi-association install is `true` forever after the first board onboards.
    expect(code).toMatch(/where\s+association_id = \(select association_id from board_member where id = \$1\)/)
  })

  it('asks whether one exists rather than counting them all', () => {
    /**
     * `exists` stops at the first row. `count(*)` reads every unit the
     * association holds to answer a question that only needs one — on the upload
     * path, which every submission goes through.
     */
    expect(code).toMatch(/select exists/i)
    expect(code).not.toMatch(/count\(\*\)/i)
  })

  it('uses the writer pool, because the reader cannot read board_member', () => {
    /**
     * Migration 003 revokes all on `board_member` from `watchdog_reader`. A
     * reader-pool version of this query does not return a wrong answer — it
     * throws a permission error, at upload time, in production. Asserted because
     * the instinct to "use the reader for a read" is strong and wrong here, and
     * the database half that would catch it skips on this machine.
     */
    expect(code).toContain('writerPool()')
    expect(code).not.toContain('readerPool')
  })

  it('asks about units, never about whether a roll was uploaded', () => {
    /**
     * The distinction the whole story turns on, and it was implemented correctly
     * and asserted nowhere until the AC audit looked for it.
     *
     * "Has an assessment_roll document been ingested" reads like the same
     * question and is cheaper to answer -- the document table is already to hand
     * and needs no join. It is not the same question. A roll uploaded as the
     * wrong kind, or unreadable, or with no valid rows, leaves a document behind
     * and creates no units, and deposits after it would be let through into
     * exactly the trap this story removes.
     *
     * So the census must name `unit` and must not name `document` or
     * `extraction`. A later edit making that substitution would look like a
     * sensible optimisation.
     */
    expect(code).toMatch(/from unit\b/)
    expect(code).not.toMatch(/\bdocument\b(?!_)/)
    expect(code).not.toMatch(/\bextraction\b/)
  })

  it('reads and does not write', () => {
    expect(code).not.toMatch(/\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b/i)
  })

  it('is not passing because the blanker emptied the file', () => {
    // Three of the assertions above are absences.
    expect(code).toContain('export function createUnitCensus')
  })
})

describeWithDatabase('against a real database', () => {
  const prefix = `a${randomBytes(4).toString('hex')}`
  let admin: Client
  let withUnits: string
  let withoutUnits: string

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl })
    await admin.connect()

    const member = async (label: string, units: number) => {
      const association = await admin.query<{ id: string }>(
        `insert into association (name) values ($1) returning id`,
        [`${prefix} ${label}`],
      )
      const associationId = association.rows[0]!.id

      for (let index = 0; index < units; index += 1) {
        await admin.query(
          `insert into unit (association_id, unit_number) values ($1, $2)`,
          [associationId, `${prefix}-${label}-${index}`],
        )
      }

      const row = await admin.query<{ id: string }>(
        `insert into board_member (email, association_id) values ($1, $2) returning id`,
        [`${prefix}-${label}@example.com`, associationId],
      )
      return row.rows[0]!.id
    }

    withUnits = await member('roll-imported', 1)
    withoutUnits = await member('fresh-install', 0)
  })

  afterAll(async () => {
    if (!configured) return

    await admin.query(`delete from unit where unit_number like $1`, [`${prefix}-%`])
    await admin.query(`delete from board_member where email like $1`, [`${prefix}-%`])
    await admin.query(`delete from association where name like $1`, [`${prefix} %`])
    await admin.end()
  })

  it('answers true for an association that holds units', async () => {
    await expect(createUnitCensus().hasUnits(withUnits)).resolves.toBe(true)
  })

  it('answers false for an association that holds none, while another holds some', async () => {
    /**
     * The fresh install, and the isolation case, in one assertion — which is why
     * there is no longer a separate test for the latter.
     *
     * `beforeAll` gives the *other* association a unit, so `exists (select 1
     * from unit)` is true in this database at this moment. An unscoped query
     * would therefore answer `true` here, and only the association clause makes
     * it `false`. A second board onboarding must not silently unlock deposits
     * for every board after it.
     *
     * A third test asserting both members' answers together was removed: it
     * repeated this one and the one above and added no case. Raised by ocr, and
     * the reason is kept, because "we already have a test for that" is how a
     * duplicate earns its place back.
     */
    await expect(createUnitCensus().hasUnits(withoutUnits)).resolves.toBe(false)
  })

  it('answers false for a member who does not exist, rather than throwing', async () => {
    /**
     * The scalar subquery yields NULL, `association_id = NULL` matches nothing,
     * and the answer is `false` — which refuses the upload. That is the safe
     * direction: an unknown member is not a reason to let deposits through.
     */
    await expect(
      createUnitCensus().hasUnits('00000000-0000-0000-0000-000000000000'),
    ).resolves.toBe(false)
  })
})
