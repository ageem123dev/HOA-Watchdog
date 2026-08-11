/**
 * What the reasoning model is allowed to see of the catalog.
 *
 * AD-5: "The agent selects a named entry from a fixed, version-controlled query
 * catalog and supplies typed parameters. […] **Free-form SQL from a model is
 * never executed.**"
 *
 * The epic's claim for story 3.4 is `no model-authored SQL is possible`, and
 * "possible" is a claim about structure rather than about behaviour. Two things
 * have to be true for it, and this file asserts both:
 *
 * 1. The model never *sees* SQL. Not because it would copy it — because the
 *    shortest path from a model to a database is a system where SQL text is
 *    already flowing toward it.
 * 2. The model has no field to *put* SQL in. Every declaration it is handed
 *    carries `additionalProperties: false`, so a `sql` key it invents is refused
 *    before anything binds.
 *
 * **The sweep is over `ALL_ENTRIES`, not over `dues_status@1`.** There is one
 * entry today and the catalog exists to grow; an invariant written about the
 * first entry is one the second is not held to, and nothing would say so.
 * `registry.test.ts` established that shape here.
 */

import { describe, expect, it } from 'vitest'

import { agentViewOf, agentViewOfCatalog } from './agent-view'
import type { CatalogEntry } from './entry'
import { ALL_ENTRIES } from './registry'

const anEntry = (overrides: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: 'test_entry',
  version: 1,
  description: 'A test entry.',
  sql: 'select 1 as one where $1 = $1',
  parameters: {
    type: 'object',
    properties: { someParameter: { type: 'string', description: 'A parameter.' } },
    required: ['someParameter'],
    additionalProperties: false,
  },
  bind: ['someParameter'],
  ...overrides,
})

describe('the catalog is not empty', () => {
  /**
   * Every assertion below sweeps `ALL_ENTRIES`, and a sweep over nothing passes
   * by describing an empty world. Story 3.3 shipped exactly that bug — a source
   * sweep that passed over an empty package for a whole task.
   */
  it('holds at least one entry, so the sweeps below check something', () => {
    expect(ALL_ENTRIES.length).toBeGreaterThan(0)
  })
})

describe('what the agent view carries', () => {
  it('carries what a model needs to choose', () => {
    const view = agentViewOf(anEntry())

    expect(view).toEqual({
      id: 'test_entry',
      version: 1,
      description: 'A test entry.',
      parameters: {
        type: 'object',
        properties: { someParameter: { type: 'string', description: 'A parameter.' } },
        required: ['someParameter'],
        additionalProperties: false,
      },
    })
  })

  /**
   * `toEqual` above already fails on an extra key, but it fails as "these
   * objects differ" — which reads like a fixture that needs updating. This says
   * what the rule is, so the next person meets the reason rather than the
   * symptom.
   */
  it('carries nothing else at all', () => {
    expect(Object.keys(agentViewOf(anEntry())).sort()).toEqual([
      'description',
      'id',
      'parameters',
      'version',
    ])
  })
})

describe('AD-5: the model never sees SQL', () => {
  it.each(ALL_ENTRIES.map((entry) => [`${entry.id}@${entry.version}`, entry] as const))(
    '%s does not carry its SQL into the agent view',
    (_label, entry) => {
      expect(agentViewOf(entry)).not.toHaveProperty('sql')
    },
  )

  /**
   * Serialized, because that is the form it travels in. A `sql` nested inside
   * `parameters` — or inside a field added to `CatalogEntry` next year — would
   * pass a top-level key check and still reach the model.
   *
   * **The comparison is against the JSON-escaped SQL, not the raw text**, and
   * that is not a detail. The first version of this test compared
   * `JSON.stringify(view)` against `entry.sql` directly and **passed while the
   * SQL was leaking**: every entry's SQL is a multi-line template literal, and
   * `JSON.stringify` turns its real newlines into two-character escape sequences,
   * so the raw form is never a substring of the serialized form whether the SQL
   * is there or not.
   * Caught by breaking `agentViewOf` to leak `sql` and finding this assertion
   * still green — the keyword sweep below was the only one that fired.
   */
  it('has no entry SQL anywhere in the serialized catalog view', () => {
    const serialized = JSON.stringify(agentViewOfCatalog(ALL_ENTRIES))

    for (const entry of ALL_ENTRIES) {
      // `slice(1, -1)` drops the quotes `stringify` wraps the string in, leaving
      // exactly the bytes that would appear inside the serialized object.
      const asItWouldTravel = JSON.stringify(entry.sql).slice(1, -1)

      expect(asItWouldTravel.length).toBeGreaterThan(0)
      expect(serialized).not.toContain(asItWouldTravel)
    }
  })

  /**
   * The check above compares against each entry's *whole* SQL text, which a
   * projection that leaked a fragment would slip past. SQL keywords are the
   * cheap, robust second angle: nothing a model needs in order to choose an
   * entry contains the word `select`.
   */
  it('has no SQL keywords in the serialized catalog view', () => {
    const serialized = JSON.stringify(agentViewOfCatalog(ALL_ENTRIES))

    for (const keyword of ['select ', ' from ', ' where ', ' join ', 'coalesce(']) {
      expect(serialized.toLowerCase()).not.toContain(keyword)
    }
  })

  it('does not carry the bind order either', () => {
    // Not secret, and not the model's business: `bind` is the mapping onto
    // `$1 … $n`, which only the executor uses. Anything the model does not need
    // in order to choose is surface it should not have.
    expect(agentViewOf(anEntry())).not.toHaveProperty('bind')
  })
})

describe('AD-5: there is no field a model could put SQL in', () => {
  it.each(ALL_ENTRIES.map((entry) => [`${entry.id}@${entry.version}`, entry] as const))(
    '%s refuses undeclared properties',
    (_label, entry) => {
      expect(agentViewOf(entry).parameters.additionalProperties).toBe(false)
    },
  )

  it.each(ALL_ENTRIES.map((entry) => [`${entry.id}@${entry.version}`, entry] as const))(
    '%s declares only parameters its entry declares',
    (_label, entry) => {
      const view = agentViewOf(entry)

      expect(Object.keys(view.parameters.properties).sort()).toEqual(
        Object.keys(entry.parameters.properties).sort(),
      )
    },
  )

  it.each(ALL_ENTRIES.map((entry) => [`${entry.id}@${entry.version}`, entry] as const))(
    '%s declares no parameter of a free-text type the executor would forward',
    (_label, entry) => {
      // `ParameterType` is `'string' | 'integer'` and a string parameter is
      // legitimate — `unitNumber` is one. This asserts the union has not been
      // widened to something unbounded underneath the catalog.
      for (const declaration of Object.values(entry.parameters.properties)) {
        expect(['string', 'integer']).toContain(declaration.type)
      }
    },
  )
})

describe('every entry can be chosen', () => {
  it.each(ALL_ENTRIES.map((entry) => [`${entry.id}@${entry.version}`, entry] as const))(
    '%s has a description a model could choose on',
    (_label, entry) => {
      // A model picks between entries on this text and nothing else. An empty
      // description is an entry that can only be chosen by accident.
      expect(entry.description.trim().length).toBeGreaterThan(0)
    },
  )

  it.each(ALL_ENTRIES.map((entry) => [`${entry.id}@${entry.version}`, entry] as const))(
    '%s describes every parameter it declares',
    (_label, entry) => {
      for (const [name, declaration] of Object.entries(entry.parameters.properties)) {
        expect(declaration.description.trim(), `${name} has no description`).not.toBe('')
      }
    },
  )
})

describe('the whole catalog view', () => {
  it('projects every registered entry', () => {
    expect(agentViewOfCatalog(ALL_ENTRIES)).toHaveLength(ALL_ENTRIES.length)
  })

  it('is the projection applied entry by entry', () => {
    expect(agentViewOfCatalog(ALL_ENTRIES)).toEqual(ALL_ENTRIES.map(agentViewOf))
  })
})
