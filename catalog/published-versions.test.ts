/**
 * AD-14 — catalog entry versions are immutable.
 *
 * "Once a catalog entry version is used in production, its SQL text and
 * parameter schema are frozen. Changing either mints a new version. The
 * provenance log's `(entry_id, version)` pair must always resolve to exactly one
 * SQL text, forever."
 *
 * Nothing in TypeScript can stop somebody editing `dues-status-v1.ts`. What can
 * be done is to make the edit fail loudly and say what to do instead, which is
 * what `published-versions.json` is for: a committed digest per published
 * version, so an in-place change shows up as a diff to a file whose entire
 * purpose is to be hard to change casually.
 *
 * **The digest covers the parameter schema as well as the SQL**, because the
 * likelier mistake is the quieter one. Widening a parameter from `integer` to
 * `string` does not touch a line of SQL, and it changes what `dues_status@1`
 * accepts while every provenance row keeps saying `dues_status@1`.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { digestOf } from './digest'
import { ALL_ENTRIES } from './registry'

const HERE = dirname(fileURLToPath(import.meta.url))

const published = JSON.parse(
  readFileSync(join(HERE, 'published-versions.json'), 'utf8'),
) as Record<string, string>

const reference = (id: string, version: number) => `${id}@${version}`

describe('the published versions file', () => {
  it('pins something, so the assertions below cannot pass over an empty set', () => {
    expect(Object.keys(published).length).toBeGreaterThan(0)
  })

  it.each(ALL_ENTRIES.map((entry) => [reference(entry.id, entry.version), entry] as const))(
    '%s is unchanged since it was published',
    (label, entry) => {
      expect(
        published[label],
        `${label} is in the catalog but not in published-versions.json. A new version is published by adding its digest; an existing one is never edited.`,
      ).toBeDefined()

      expect(
        digestOf(entry),
        `${label} no longer matches its published digest. A published version's SQL and parameter schema are frozen (AD-14) — mint a new version rather than editing this one.`,
      ).toBe(published[label])
    },
  )

  /**
   * The other direction. Deleting an entry from the registry while leaving its
   * digest pinned would pass every assertion above, because they iterate the
   * registry — and it would break the provenance trail exactly as editing it
   * does: a `(entry_id, version)` in `query_log` that resolves to nothing.
   */
  it('pins no version the catalog has stopped holding', () => {
    const held = new Set(ALL_ENTRIES.map((entry) => reference(entry.id, entry.version)))
    const orphaned = Object.keys(published).filter((label) => !held.has(label))

    expect(orphaned).toEqual([])
  })
})

/**
 * The freeze is only as good as the digest's sensitivity, and a digest computed
 * over the wrong fields would make every assertion above pass through any edit
 * at all. So the digest is tested as the load-bearing thing it is.
 */
describe('the digest', () => {
  const entry = ALL_ENTRIES[0]!

  it('changes when the SQL changes', () => {
    expect(digestOf({ ...entry, sql: `${entry.sql} order by 1` })).not.toBe(digestOf(entry))
  })

  /**
   * The type is flipped to the *other* one rather than set to a fixed value.
   * The first draft set it to `'string'`, and the first property happened to be
   * a string already — so the "changed" entry was identical to the original and
   * the assertion passed for a reason that had nothing to do with the digest.
   */
  it('changes when a parameter type changes', () => {
    const [first] = Object.keys(entry.parameters.properties)
    const declaration = entry.parameters.properties[first!]!
    const flipped = {
      ...entry,
      parameters: {
        ...entry.parameters,
        properties: {
          ...entry.parameters.properties,
          [first!]: {
            ...declaration,
            type: declaration.type === 'string' ? ('integer' as const) : ('string' as const),
          },
        },
      },
    }

    expect(flipped.parameters.properties[first!]!.type).not.toBe(declaration.type)
    expect(digestOf(flipped)).not.toBe(digestOf(entry))
  })

  it('changes when a parameter stops being required', () => {
    expect(digestOf({ ...entry, parameters: { ...entry.parameters, required: [] } })).not.toBe(
      digestOf(entry),
    )
  })

  it('changes when the binding order changes', () => {
    if (entry.bind.length < 2) {
      expect(digestOf({ ...entry, bind: [...entry.bind, ...entry.bind] })).not.toBe(digestOf(entry))
      return
    }

    expect(digestOf({ ...entry, bind: [...entry.bind].reverse() })).not.toBe(digestOf(entry))
  })

  /**
   * And the converse, which is what makes the four assertions above mean
   * something: the digest must be stable across everything that is *not* the
   * frozen contract, or it would change on a whitespace edit and train whoever
   * hits it to paste the new value in.
   */
  it('does not change when a property description is reworded', () => {
    const [first] = Object.keys(entry.parameters.properties)
    const reworded = {
      ...entry,
      parameters: {
        ...entry.parameters,
        properties: {
          ...entry.parameters.properties,
          [first!]: { ...entry.parameters.properties[first!]!, description: 'Reworded.' },
        },
      },
    }

    expect(digestOf(reworded)).toBe(digestOf(entry))
  })

  it('does not depend on the order the properties happen to be written in', () => {
    const reversed = Object.fromEntries(Object.entries(entry.parameters.properties).reverse())

    expect(digestOf({ ...entry, parameters: { ...entry.parameters, properties: reversed } })).toBe(
      digestOf(entry),
    )
  })
})
