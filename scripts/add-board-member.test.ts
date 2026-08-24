/**
 * What `scripts/add-board-member.mjs` is still for (story 5.9).
 *
 * ## Why a text test rather than running it
 *
 * The script's whole body is one database round trip against a live connection.
 * What changed in this story is not its behaviour but its *remit* — and a remit
 * lives in what the file says and which query it sends, both of which are read
 * rather than executed. `dual-llm-boundary.test.ts` and `sole-data-path.test.ts`
 * read source text for the same kind of claim.
 *
 * ## The claim that goes stale on its own
 *
 * Before this story the script's comment said story 5.9 "replaces it with a
 * provisioning flow that knows which association a director belongs to". That
 * sentence was true when written and becomes false the moment this story ships —
 * which is exactly the sort of comment nobody re-reads. It is asserted gone.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { neutralise } from '@/core/ports/declared-members'

const SOURCE = readFileSync(join(__dirname, 'add-board-member.mjs'), 'utf8')

/**
 * Comments blanked for the assertions that are about *code*.
 *
 * The header and the inline comments necessarily quote the old shapes they
 * replaced - `argv.slice(0, associationAt)` is named in the very comment
 * explaining why it is gone - so a check for its absence run over the raw text
 * finds the explanation and fails. This project has hit that five times, twice
 * inside guards written to prevent it.
 *
 * Assertions about what the file *says* keep using `SOURCE`; assertions about
 * what it *does* use this.
 */
const code = neutralise(SOURCE).commentsBlanked

describe('the script says what it is now for', () => {
  it('names the product as the route for directors after the first', () => {
    /**
     * Somebody reaching for this script should learn, from the script, that
     * there is now a better way for the case they probably have.
     */
    expect(SOURCE).toMatch(/\/directors|in the product|from inside the product/i)
  })

  it('no longer says this story will replace it', () => {
    // 4a. The comment predicted its own replacement; the replacement has
    // arrived, so the prediction is now a false statement about the system.
    expect(SOURCE).not.toMatch(/story 5\.9 replaces it|replaces it with a provisioning flow/i)
  })

  it('explains why the first director cannot be added in the product', () => {
    // Without the reason, "use the product instead" reads as advice somebody
    // can follow in the one case where they cannot.
    expect(SOURCE).toMatch(/nobody is signed in|no session|first director/i)
  })
})

describe('it can still bootstrap an association', () => {
  it('takes the association by name rather than assuming there is one', () => {
    /**
     * 4b, found while narrowing the script rather than planned.
     *
     * It wrote `(select id from association)`, which returns two rows the moment
     * a second association exists and raises. Story 5.1 made that representable,
     * so the script could not create the first director of association number
     * two — the one case this story says it is still for.
     */
    expect(SOURCE).toMatch(/association.*name|--association/i)
    expect(code).not.toMatch(/\(select id from association\)\s*\)/)

    // And the resolved association actually reaches the insert. Asserting only
    // that the argument exists passes against a script that parses it and then
    // writes `null` — the argument present and unused, which is the shape a
    // half-finished refactor leaves behind. Found by mutation.
    expect(code).toMatch(/displayName,\s*association\.id/)
  })

  it('refuses when the name does not match exactly one association', () => {
    /**
     * 4c. An argument that picks *an* association is worse than a subquery that
     * refuses to guess — the bare subquery was chosen because "failing loudly is
     * better than silently enrolling somebody into the wrong board", and an
     * argument must keep that property rather than trade it away for
     * convenience.
     */
    expect(SOURCE).toMatch(/rowCount !== 1|rows\.length !== 1|exactly one/i)
  })

  it('still resets a password on conflict, and says why that is deliberate', () => {
    /**
     * 4d. The product refuses a duplicate address on purpose — resetting a
     * colleague's password by accident locks them out. That makes this script
     * the only remaining way to recover a locked-out director, so the upsert
     * stays and the reason is written down.
     */
    expect(SOURCE).toMatch(/do update set password_hash/)
    expect(SOURCE).toMatch(/locked out|reset|recover/i)
  })
})

describe('what the review found in the first version', () => {
  it('refuses an address that belongs to a different association', () => {
    /**
     * The high one, and this story's own change made it worse.
     *
     * `email` is unique across the whole table, so `on conflict (email) do
     * update set password_hash` fires for an address held by *any* association.
     * Run with `--association B` for an address already in association A and the
     * script resets A's password, leaves the account in A, and prints
     * "association: B" - a false report of what it did.
     *
     * The upsert was there before this story. What this story added was an
     * association argument the upsert ignores, which turned a silent reset into
     * a confidently mislabelled one. Raised by Argus.
     */
    expect(code).toMatch(/association_id !== association\.id/)
  })

  it('lists the associations that do exist when the name matches none', () => {
    /**
     * The message promises "There are:" and then prints nothing, because the
     * query that found no match is the one being listed. An error that offers
     * help and delivers an empty list is worse than one that offers none.
     */
    expect(code).toMatch(/rows\.length === 0[\s\S]{0,200}select name from association/i)
  })

  it('does not lose arguments that follow --association', () => {
    /**
     * `argv.slice(0, associationAt)` drops everything after the flag, so
     * `<email> --association "X" "Display Name"` silently loses the name, and
     * `--association X <email>` fails with a usage error for a well-formed
     * command.
     */
    expect(code).not.toMatch(/argv\.slice\(0, associationAt\)/)
  })
})

describe('the guard can actually fail', () => {
  it('is reading the script and not an empty string', () => {
    // Three assertions above are absences.
    expect(SOURCE.length).toBeGreaterThan(500)
    expect(SOURCE).toContain('insert into board_member')
  })
})
