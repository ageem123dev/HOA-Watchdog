/**
 * The catalog as a whole: what it holds, and the invariants every entry in it
 * must satisfy.
 *
 * The per-entry assertions here are written as a sweep over `ALL_ENTRIES` rather
 * than as assertions about `dues_status@1`. There is one entry today and the
 * second one is story 3.4's; an invariant written about the first entry is an
 * invariant the second one is not held to, and nothing would say so.
 */

import { describe, expect, it } from 'vitest'

import { ALL_ENTRIES, UnknownCatalogEntryError, currentVersionOf, entryFor } from './registry'

describe('resolving an entry', () => {
  it('resolves the entry a caller names', () => {
    const entry = entryFor('dues_status', 1)

    expect(entry.id).toBe('dues_status')
    expect(entry.version).toBe(1)
  })

  it('refuses an id the catalog does not hold, naming it', () => {
    expect(() => entryFor('drop_everything', 1)).toThrow(/drop_everything/)
    expect(() => entryFor('drop_everything', 1)).toThrow(UnknownCatalogEntryError)
  })

  /**
   * A version that does not exist is a different failure from an id that does
   * not exist, and the message has to tell them apart: AD-14 means a caller
   * asking for `dues_status@2` is asking for SQL that has not been written yet,
   * not making a typo.
   */
  it('refuses a version the catalog does not hold, naming both', () => {
    expect(() => entryFor('dues_status', 99)).toThrow(/dues_status.*99/)
  })

  it('reports the current version of an entry', () => {
    expect(currentVersionOf('dues_status')).toBe(1)
  })

  it('refuses to report a current version for an id it does not hold', () => {
    expect(() => currentVersionOf('drop_everything')).toThrow(UnknownCatalogEntryError)
  })

  it('holds at least one entry, so the sweeps below cannot pass vacuously', () => {
    expect(ALL_ENTRIES.length).toBeGreaterThan(0)
  })
})

describe('every entry in the catalog', () => {
  /**
   * The same shape `migrations/020_query_log.sql` constrains `entry_id` to.
   *
   * Two statements of one rule, which migration 007's comment warns is only safe
   * when something fails on disagreement — this is that something. An entry the
   * catalog accepts and the provenance table rejects would fail at the moment of
   * logging, which is to say on the query path, in production.
   */
  const CATALOG_ID = /^[a-z][a-z0-9_]*$/

  it.each(ALL_ENTRIES.map((entry) => [`${entry.id}@${entry.version}`, entry] as const))(
    '%s is named and versioned as the conventions require',
    (_label, entry) => {
      expect(entry.id).toMatch(CATALOG_ID)
      expect(entry.id.length).toBeLessThanOrEqual(64)
      expect(Number.isInteger(entry.version)).toBe(true)
      expect(entry.version).toBeGreaterThanOrEqual(1)
    },
  )

  it.each(ALL_ENTRIES.map((entry) => [`${entry.id}@${entry.version}`, entry] as const))(
    '%s declares a strict parameter schema',
    (_label, entry) => {
      expect(entry.parameters.type).toBe('object')
      expect(entry.parameters.additionalProperties).toBe(false)

      for (const name of entry.parameters.required) {
        expect(Object.hasOwn(entry.parameters.properties, name)).toBe(true)
      }
    },
  )

  /**
   * The binding order is the join between a named parameter set and a
   * positional `$1 … $n` query, and it is the one part of an entry that can be
   * wrong without looking wrong. `bind: ['assessmentYear', 'unitNumber']` against
   * SQL expecting the other order runs perfectly and answers about the wrong
   * unit — a silently incorrect financial answer, which is the exact failure
   * this epic exists to prevent.
   */
  it.each(ALL_ENTRIES.map((entry) => [`${entry.id}@${entry.version}`, entry] as const))(
    '%s binds exactly the placeholders its SQL uses, in an order it declares',
    (_label, entry) => {
      const placeholders = [...entry.sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]))
      const highest = placeholders.length === 0 ? 0 : Math.max(...placeholders)

      expect(entry.bind).toHaveLength(highest)
      expect(new Set(placeholders).size).toBe(highest)

      for (const name of entry.bind) {
        expect(Object.hasOwn(entry.parameters.properties, name)).toBe(true)
      }
      expect(new Set(entry.bind).size).toBe(entry.bind.length)

      for (const name of entry.parameters.required) {
        expect(entry.bind).toContain(name)
      }
    },
  )

  /**
   * AD-5, read literally: "Free-form SQL from a model is never executed." The
   * corollary is that a catalog entry must not be able to *become* free-form
   * SQL, which is what interpolating a value into the text would make it. A
   * parameter reaches the database as a bound placeholder or it does not reach
   * it at all.
   */
  it.each(ALL_ENTRIES.map((entry) => [`${entry.id}@${entry.version}`, entry] as const))(
    '%s reads rather than writes, and carries no interpolation',
    (_label, entry) => {
      expect(entry.sql).toMatch(/^\s*select\b/i)
      expect(entry.sql).not.toMatch(/\b(insert|update|delete|truncate|drop|alter|create|grant)\b/i)
      expect(entry.sql).not.toContain('${')
      expect(entry.sql).not.toContain(';')
    },
  )
})

describe('the catalog itself', () => {
  it('holds no two entries with the same id and version', () => {
    const references = ALL_ENTRIES.map((entry) => `${entry.id}@${entry.version}`)

    expect(new Set(references).size).toBe(references.length)
  })
})
