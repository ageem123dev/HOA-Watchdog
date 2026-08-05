/**
 * `VendorDirectory` against real Postgres.
 *
 * The claim under test is a negative one and it is the whole story: two names
 * can be similar enough to sit at the top of a suggestion list and still not
 * resolve to each other. A fake cannot test that -- the similarity comes from
 * pg_trgm and the identity from a generated column, so the disagreement between
 * them only exists in the database.
 */

import { randomBytes } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createVendorDirectory } from './vendor-directory-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const configured = Boolean(writerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn('\n  vendor-directory tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL must be set.\n')
}

const RUN_PREFIX = randomBytes(4).toString('hex')
const named = (suffix: string) => `${RUN_PREFIX} ${suffix}`

/**
 * Only this run's vendors.
 *
 * `suggest` ranks the whole table by design, and vitest runs test files in
 * parallel against one database, so another file's rows drift in and out of the
 * result while this one is asserting on it. That made the limit test fail once
 * and pass twice on identical code -- a flake, which is a defect in the test
 * rather than a nuisance to re-run past.
 */
const mine = <T extends { readonly displayName: string }>(suggestions: readonly T[]): T[] =>
  suggestions.filter((suggestion) => suggestion.displayName.startsWith(RUN_PREFIX))

describeWithDatabase('createVendorDirectory', () => {
  const directory = createVendorDirectory()
  let seed: Client
  let evergreenId: string

  beforeAll(async () => {
    seed = new Client({ connectionString: writerUrl })
    await seed.connect()

    const { rows } = await seed.query(
      'insert into vendor (display_name) values ($1) returning id',
      [named('Evergreen Landscaping')],
    )
    evergreenId = rows[0].id

    await seed.query('insert into vendor (display_name) values ($1), ($2), ($3)', [
      // Close enough to rank beside Evergreen Landscaping, and a different
      // vendor. Without a second candidate of this run's own, the ordering and
      // limit tests were passing on rows another test file happened to leave
      // in the table -- which is how they passed once and failed twice.
      named('Evergreen Landscaping Co'),
      named('Acme Plumbing'),
      named('Northside Electric'),
    ])
  })

  afterAll(async () => {
    if (!seed) return

    // Tolerated deliberately. If `beforeAll` failed to connect, `seed` exists
    // but the client does not, and letting the cleanup throw replaces the real
    // connection error with a confusing secondary one.
    await seed
      .query('delete from vendor where display_name like $1', [`${RUN_PREFIX}%`])
      .catch(() => undefined)
    await seed.end().catch(() => undefined)
  })

  describe('resolve', () => {
    it('finds a vendor whose name matches exactly', async () => {
      await expect(directory.resolve(named('Evergreen Landscaping'))).resolves.toEqual({
        outcome: 'resolved',
        vendorId: evergreenId,
      })
    })

    it.each([
      ['different case', 'EVERGREEN LANDSCAPING'],
      ['padded ends', '   Evergreen Landscaping   '],
      ['a doubled space', 'Evergreen  Landscaping'],
      ['a tab', 'Evergreen\tLandscaping'],
      ['NBSP, which a PDF extractor emits', 'Evergreen\u00a0Landscaping'],
      ['narrow NBSP', 'Evergreen\u202fLandscaping'],
    ])('finds the same vendor through %s', async (_label, variant) => {
      await expect(directory.resolve(named(variant))).resolves.toEqual({
        outcome: 'resolved',
        vendorId: evergreenId,
      })
    })

    it('does not resolve a name it has never seen', async () => {
      await expect(directory.resolve(named('Someone Else Entirely'))).resolves.toEqual({
        outcome: 'unresolved',
      })
    })

    it('does not resolve a merely similar name, however close', async () => {
      // The story in one assertion. `Evergreen Landscape` scores 0.75 against
      // `Evergreen Landscaping` -- high enough to head a suggestion list, and
      // still a different vendor. Resolving it would write a false identity
      // into the comparison history with no error anywhere.
      await expect(directory.resolve(named('Evergreen Landscape'))).resolves.toEqual({
        outcome: 'unresolved',
      })
    })

    it('is not fooled by a name that is a prefix of a known one', async () => {
      await expect(directory.resolve(named('Evergreen'))).resolves.toEqual({
        outcome: 'unresolved',
      })
    })

    it('does not resolve an empty name', async () => {
      await expect(directory.resolve('')).resolves.toEqual({ outcome: 'unresolved' })
    })

    it('does not resolve a name made only of separators', async () => {
      // Normalises to the empty string. No vendor can hold that key -- the check
      // constraint forbids it -- so this must not match, and must not error.
      await expect(directory.resolve(' \t\u00a0 ')).resolves.toEqual({ outcome: 'unresolved' })
    })

    it('creates nothing when it fails to resolve', async () => {
      // AD-8: unknown vendors go to a human and never auto-create. The count is
      // the assertion, because "returned unresolved" is equally true of code
      // that returned unresolved *and* inserted a row.
      const before = await seed.query('select count(*)::int as n from vendor where display_name like $1', [
        `${RUN_PREFIX}%`,
      ])

      await directory.resolve(named('Definitely Not A Known Vendor'))

      const after = await seed.query('select count(*)::int as n from vendor where display_name like $1', [
        `${RUN_PREFIX}%`,
      ])

      expect(after.rows[0].n).toBe(before.rows[0].n)
    })

    it('treats a name that is only quotes as data, not as SQL', async () => {
      await expect(directory.resolve("'); delete from vendor; --")).resolves.toEqual({
        outcome: 'unresolved',
      })

      const { rows } = await seed.query('select count(*)::int as n from vendor where display_name like $1', [
        `${RUN_PREFIX}%`,
      ])

      expect(rows[0].n).toBeGreaterThan(0)
    })
  })

  describe('suggest', () => {
    it('ranks the closest name first', async () => {
      const suggestions = mine(await directory.suggest(named('Evergreen Landscape'), 20))

      expect(suggestions[0]?.id).toBe(evergreenId)
      expect(suggestions[0]?.displayName).toBe(named('Evergreen Landscaping'))
    })

    it('scores the closest above the rest', async () => {
      const suggestions = mine(await directory.suggest(named('Evergreen Landscape'), 20))

      expect(suggestions.length).toBeGreaterThan(1)
      for (let index = 1; index < suggestions.length; index += 1) {
        expect(suggestions[index - 1]!.score).toBeGreaterThanOrEqual(suggestions[index]!.score)
      }
    })

    it('reports a score between zero and one', async () => {
      const [first] = mine(await directory.suggest(named('Evergreen Landscape'), 20))

      expect(first, 'no candidate to score').toBeDefined()
      expect(first?.score).toBeGreaterThan(0)
      expect(first?.score).toBeLessThanOrEqual(1)
    })

    it('honours the limit', async () => {
      // States its own precondition rather than assuming one. The first draft
      // asserted two results for a name that only ever matched one, so it was
      // testing the seed data and not the limit.
      const unlimited = mine(await directory.suggest(named('Evergreen Landscape'), 50))

      expect(unlimited.length, 'need more than one candidate for a limit to mean anything')
        .toBeGreaterThan(1)

      await expect(directory.suggest(named('Evergreen Landscape'), 1)).resolves.toHaveLength(1)
    })

    it('returns nothing when asked for nothing', async () => {
      await expect(directory.suggest(named('Evergreen'), 0)).resolves.toEqual([])
    })

    it('refuses a negative limit rather than guessing what it meant', async () => {
      await expect(directory.suggest(named('Evergreen'), -1)).rejects.toThrow(/limit/i)
    })

    it('refuses a non-integer limit', async () => {
      await expect(directory.suggest(named('Evergreen'), 1.5)).rejects.toThrow(/limit/i)
    })

    it('returns nothing for a name with no resemblance to anything stored', async () => {
      const suggestions = mine(await directory.suggest('zzzzqqqq xxxxvvvv', 50))

      expect(suggestions).toEqual([])
    })

    it('creates nothing while suggesting', async () => {
      const before = await seed.query('select count(*)::int as n from vendor where display_name like $1', [
        `${RUN_PREFIX}%`,
      ])

      await directory.suggest(named('Evergreen Landscape'), 5)

      const after = await seed.query('select count(*)::int as n from vendor where display_name like $1', [
        `${RUN_PREFIX}%`,
      ])

      expect(after.rows[0].n).toBe(before.rows[0].n)
    })
  })

  describe('the two paths disagree, which is the point', () => {
    it('suggests a name it will not resolve', async () => {
      // Both directions in one test, because either alone passes against an
      // implementation that has quietly collapsed the two into one.
      const name = named('Evergreen Landscape')

      const [top] = mine(await directory.suggest(name, 20))
      const resolution = await directory.resolve(name)

      expect(top?.id).toBe(evergreenId)
      expect(resolution).toEqual({ outcome: 'unresolved' })
    })

    it('resolves a name it also suggests', async () => {
      // The mirror image: an exact match still ranks, so `suggest` is not
      // secretly excluding whatever `resolve` would have matched.
      const name = named('Evergreen Landscaping')

      const [top] = mine(await directory.suggest(name, 20))

      expect(top?.id).toBe(evergreenId)
      await expect(directory.resolve(name)).resolves.toEqual({
        outcome: 'resolved',
        vendorId: evergreenId,
      })
    })
  })
})
