/**
 * A director provisioned in the product can actually sign in (story 5.9, AC1).
 *
 * ## The gap this closes
 *
 * `app/directors/actions.test.ts` proves the shown password verifies against the
 * hash handed to the roster. `adapters/db/director-roster-postgres.test.ts`
 * proves the row lands in the right association — in its database half, which
 * skips wherever no database is configured.
 *
 * **Neither proves the account can be signed in to.** That claim spans the
 * action, the roster's normalisation, and `authenticate` — three pieces each
 * tested on their own terms, with nothing joining them. AC1 says the new account
 * can sign in afterwards, and until this file that was a chain of reasoning
 * rather than an assertion.
 *
 * The reasoning was: the roster lower-cases, `authenticate` lower-cases what it
 * is given, so they meet. That is *true*, and it is exactly the kind of true
 * thing that stops being true when one side changes. Story 5.8's integration
 * pass found the same shape — every part correct, the join asserted nowhere.
 *
 * ## Why this needs no database
 *
 * `authenticate` takes its directory as an argument. So the test can hold what
 * the roster *would have stored* and ask the real sign-in path about it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { neutralise } from '@/core/ports/declared-members'

import type { UserDirectory } from '../ports/user-directory'
import { authenticate } from './authenticate'
import { hashPassword } from './password'

/**
 * What the roster writes, spelled the way the roster spells it.
 *
 * `email.trim().toLowerCase()` is copied from `director-roster-postgres.ts`
 * deliberately rather than imported: sharing the folding would make drift
 * between the two sides undetectable.
 *
 * **The copy alone catches nothing.** `asStored` folds the address itself and
 * the adapter is never called, so every behavioural case below keeps passing
 * after the adapter stops folding - a guard that passes whether or not the
 * behaviour it guards is present. The first version of this comment claimed
 * otherwise; CodeRabbit caught the claim on the merge request. What makes it
 * true is the one assertion at the bottom of this file, which reads the adapter
 * and fails when the copy stops being faithful.
 */
interface StoredDirector {
  readonly id: string
  readonly email: string
  readonly passwordHash: string
  readonly disabledAt: Date | null
  readonly associationId: string
}

const asStored = async (typedEmail: string, password: string): Promise<StoredDirector> => ({
  id: 'new-director',
  email: typedEmail.trim().toLowerCase(),
  passwordHash: await hashPassword(password),
  disabledAt: null,
  associationId: 'association-1',
})

const directoryHolding = (row: StoredDirector): UserDirectory => ({
  // `authenticate` normalises before looking up, so this answers only for the
  // stored spelling — which is the whole point.
  findByEmail: vi.fn(async (email: string) => (email === row.email ? row : null)),
  updatePasswordHash: vi.fn(async () => undefined),
})

describe('an account added through the product', () => {
  it('signs in with the password it was shown', async () => {
    const password = 'aaaa-bbbb-cccc-dddd'
    const stored = await asStored('New.Director@example.com', password)

    const result = await authenticate(directoryHolding(stored), {
      email: 'New.Director@example.com',
      password,
    })

    expect(result.kind).toBe('authenticated')
  })

  it('signs in when the address is typed in a different case', async () => {
    /**
     * The join that was only reasoned about. A treasurer types the address one
     * way when adding a colleague and that colleague types it another way when
     * signing in — and the row was stored in whatever case the adapter chose.
     *
     * If `authenticate` stopped normalising, this fails. The roster side is
     * held by `the fixture still matches the adapter` below - not by this case,
     * which folds the address itself.
     */
    const password = 'aaaa-bbbb-cccc-dddd'
    const stored = await asStored('  New.Director@Example.com  ', password)

    const result = await authenticate(directoryHolding(stored), {
      email: 'NEW.DIRECTOR@EXAMPLE.COM',
      password,
    })

    expect(result.kind).toBe('authenticated')
  })

  it('does not sign in with a different password', async () => {
    /**
     * The control. Without it, every assertion above is satisfied by an
     * `authenticate` that accepts anything — which would make this file report
     * success for a provisioning flow that stored nothing usable.
     */
    const stored = await asStored('new@example.com', 'the-real-password')

    const result = await authenticate(directoryHolding(stored), {
      email: 'new@example.com',
      password: 'not-the-real-password',
    })

    expect(result.kind).toBe('rejected')
  })

  it('does not sign in once the account is disabled', async () => {
    // Story 5.9 does not set `disabled_at`, and revocation is deliberately out
    // of its scope — but the column exists and sign-in honours it, so a
    // provisioned account must be revocable by the mechanism already there.
    const password = 'aaaa-bbbb-cccc-dddd'
    const stored = { ...(await asStored('new@example.com', password)), disabledAt: new Date() }

    const result = await authenticate(directoryHolding(stored), {
      email: 'new@example.com',
      password,
    })

    expect(result.kind).toBe('rejected')
  })
})

describe('the fixture still matches the adapter', () => {
  it('folds the address exactly the way the adapter does', () => {
    /**
     * What makes the copy above a drift detector rather than duplication.
     *
     * `asStored` spells the folding out because the adapter inlines it and
     * exports nothing to import. That is only safe while the two spellings
     * agree - and nothing else in this file can tell that they have stopped,
     * because every case here folds its own input.
     *
     * `director-roster-postgres.test.ts` asserts the adapter lower-cases, and
     * accepts `lower($2)` as an alternative. This is narrower on purpose: it
     * pins the exact expression this file copied, trim included, so a move to
     * SQL-side folding fails here and points at the fixture that needs changing.
     */
    const adapter = readFileSync(
      join(__dirname, '..', '..', 'adapters', 'db', 'director-roster-postgres.ts'),
      'utf8',
    )

    expect(neutralise(adapter).commentsBlanked).toContain('.trim().toLowerCase()')
  })
})
