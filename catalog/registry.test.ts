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

import { ASSOCIATION_SCOPED_TABLES } from '../core/association/scoped-tables'
import type { CatalogEntry } from './entry'
import {
  ALL_ENTRIES,
  DuplicateCatalogEntryError,
  UnknownCatalogEntryError,
  currentVersionOf,
  entryFor,
  indexEntries,
} from './registry'

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

      // `$1` is the association and is **not** an entry parameter — the
      // executor supplies it from the provenance write. So an entry declaring
      // n parameters uses n+1 placeholders, and `bind` names the last n.
      // Loosening this to `toHaveLength(highest)` would let an entry declare a
      // parameter that lands on `$1` and let a caller choose the association.
      expect(entry.bind).toHaveLength(highest - 1)
      expect(new Set(placeholders).size).toBe(highest)
      expect(placeholders).toContain(1)

      for (const name of entry.bind) {
        expect(name).not.toBe('associationId')
      }

      for (const name of entry.bind) {
        expect(Object.hasOwn(entry.parameters.properties, name)).toBe(true)
      }
      expect(new Set(entry.bind).size).toBe(entry.bind.length)

      for (const name of entry.parameters.required) {
        expect(entry.bind).toContain(name)
      }

      // And the reverse direction, which is the one an entry can fail silently.
      // A parameter declared but never bound is accepted by validation, reaches
      // no placeholder, and is discarded — so a caller supplying
      // `assessmentYear` gets an answer computed without it, and nothing
      // anywhere says the value was ignored.
      for (const name of Object.keys(entry.parameters.properties)) {
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

  /**
   * AC3, and the assertion the whole story rests on: **every entry scopes every
   * scoped table it touches to `$1`.**
   *
   * Enforced here rather than judged at review, because AD-5's registry test can
   * only catch a predicate it can *see*. `strict: true` guarantees an entry's
   * arguments are well-formed; it says nothing about whether the query is
   * bounded, and parameter validation cannot save an entry that never scoped.
   *
   * A grep for the string `association_id` would pass on an entry that merely
   * mentions it in a comment, or that scopes one of its three tables. So this
   * walks the `from`/`join` clauses, takes the alias each scoped table is bound
   * to, and requires a predicate joining *that alias* to `$1`.
   */
  /**
   * From `core/association/scoped-tables.ts`, not a copy of it. A second list
   * here would fall behind the schema silently — a table added to migrations and
   * missed here is a table catalog entries may read unscoped while this sweep
   * reports success. `migrations/association.test.ts` holds the live schema to
   * the same constant, so it cannot drift from reality unnoticed.
   */
  const SCOPED_TABLES = new Set<string>(ASSOCIATION_SCOPED_TABLES)

  /**
   * The word that cannot follow a table name and still be its alias.
   *
   * Without this the scanner reads `from assessment join unit` as "assessment
   * aliased to join", then demands `join.association_id = $1` and fails an entry
   * that is perfectly scoped. Found by this test failing on its own first run.
   */
  const NOT_AN_ALIAS = [
    'on',
    'using',
    'where',
    'group',
    'order',
    'having',
    'limit',
    'offset',
    'join',
    'left',
    'right',
    'inner',
    'outer',
    'full',
    'cross',
    'natural',
    'union',
  ]

  /**
   * The keyword list is a **lookahead**, not a post-hoc filter, and the
   * difference is the whole correctness of this scanner.
   *
   * Written as a filter — match the alias, then discard it if it turns out to be
   * a keyword — the optional group still *consumes* the word. So
   * `from assessment join unit` matched as "assessment, aliased join", ate the
   * `join`, and the next scan began at `unit on …` with no `from`/`join` in
   * front of it. `unit` was never seen, and the sweep below silently checked two
   * of this entry's three tables. Deleting `unit.association_id = $1` left the
   * suite green; the sensitivity check is what found it.
   */
  const TABLE_REFERENCE = new RegExp(
    `\\b(?:from|join)\\s+([a-z_][a-z0-9_]*)` +
      `(?:\\s+(?:as\\s+)?(?!(?:${NOT_AN_ALIAS.join('|')})\\b)([a-z_][a-z0-9_]*))?`,
    'gi',
  )

  /** Every `from`/`join` target, as `[table, alias]`; the alias defaults to the table. */
  function tableReferences(sql: string): [string, string][] {
    return [...sql.matchAll(TABLE_REFERENCE)].map((match) => [
      match[1]!.toLowerCase(),
      (match[2] ?? match[1]!).toLowerCase(),
    ])
  }

  /**
   * The scanner gets its own tests because the sweep below is only as good as
   * it is, and a table it fails to see is a table nobody checks — which is a
   * green suite reporting an invariant it never tested.
   */
  describe('the table scanner the sweep depends on', () => {
    it('sees every table in a from/join/left-join chain', () => {
      expect(
        tableReferences('from assessment join unit on unit.id = 1 left join payment on 2 = 2'),
      ).toEqual([
        ['assessment', 'assessment'],
        ['unit', 'unit'],
        ['payment', 'payment'],
      ])
    })

    it('reads a real alias, with and without AS', () => {
      expect(tableReferences('from assessment a join unit as u on 1 = 1')).toEqual([
        ['assessment', 'a'],
        ['unit', 'u'],
      ])
    })

    /**
     * The three shapes the scanner reads *wrongly* rather than not at all, which
     * is why they are refused above instead of tolerated. Each was verified
     * against the real regex before the refusal was written; `from public.unit`
     * yields `public`, and `from assessment, unit` yields `assessment` alone.
     */
    it.each([
      ['a schema-qualified name', 'select 1 from public.unit', ['public']],
      ['a comma-separated list', 'select 1 from assessment, unit', ['assessment']],
    ])('misreads %s, which is why UNANALYSABLE refuses it', (_label, sql, expected) => {
      expect(tableReferences(sql).map(([table]) => table)).toEqual(expected)
      expect(UNANALYSABLE.some(([pattern]) => pattern.test(sql))).toBe(true)
    })

    it.each([
      ['a WITH RECURSIVE CTE', 'with recursive t as (select 1 from unit) select 1 from t'],
      ['a plain CTE', 'with t as (select 1 from unit) select 1 from t'],
      ['a derived table', 'select 1 from (select id from unit) u'],
      ['a quoted identifier', 'select 1 from "unit"'],
    ])('refuses %s', (_label, sql) => {
      expect(UNANALYSABLE.some(([pattern]) => pattern.test(sql))).toBe(true)
    })

    it('does not refuse the ordinary shape the catalog actually uses', () => {
      const sql = 'select 1 from assessment join unit on unit.id = assessment.unit_id'

      expect(UNANALYSABLE.some(([pattern]) => pattern.test(sql))).toBe(false)
    })
  })

  /**
   * Comment stripping, in both directions. Without it the scoping sweep is
   * satisfied by a promise: `-- unit.association_id = $1` is text, and the check
   * is a text match.
   */
  describe('stripping comments before anything is matched', () => {
    it('removes a line comment and a block comment', () => {
      expect(withoutComments('select 1 -- unit.association_id = $1\nfrom unit')).not.toContain(
        'association_id',
      )
      expect(withoutComments('select 1 /* unit.association_id = $1 */ from unit')).not.toContain(
        'association_id',
      )
    })

    it('leaves the SQL that actually runs alone', () => {
      const sql = 'select 1 from unit where unit.association_id = $1'

      expect(withoutComments(sql)).toContain('unit.association_id = $1')
    })

    it('does not let a commented-out table hide from the scanner either', () => {
      // The reverse direction: a table named only in a comment is not read by
      // the query, so demanding a predicate for it would fail a correct entry.
      expect(tableReferences(withoutComments('select 1 -- from payment\n from unit'))).toEqual([
        ['unit', 'unit'],
      ])
    })
  })

  /**
   * Constructs the scanner cannot see into, each of which would make it skip a
   * table **silently** — which is worse than not having the sweep at all, since
   * a green result would say the entry was checked.
   *
   * - a CTE (`with x as (…)`) puts its tables outside any `from`/`join` the
   *   scanner reaches;
   * - a derived table (`from (select … from unit) u`) is read as the alias `u`,
   *   and `unit` is never seen;
   * - a quoted identifier (`from "unit"`) does not match the bare-word pattern.
   *
   * So the sweep refuses them rather than passing over them. This is a
   * deliberate restriction on what a catalog entry may look like, not a
   * limitation being papered over: the day one is genuinely needed, the scanner
   * is extended and this list shrinks. Raised by `ocr` reviewing story 5.1b.
   */
  const UNANALYSABLE = [
    [/\bwith\s+(?:recursive\s+)?[a-z_][a-z0-9_]*\s+as\s*\(/i, 'a common table expression'],
    [/\b(?:from|join)\s*\(/i, 'a derived table'],
    [/\b(?:from|join)\s+"/i, 'a quoted identifier'],
    // `from public.unit` captures `public` and never sees `unit`.
    [/\b(?:from|join)\s+[a-z_][a-z0-9_]*\s*\./i, 'a schema-qualified table name'],
    // `from assessment, unit` captures `assessment` and never sees `unit`.
    [/\b(?:from|join)\s+[a-z_][a-z0-9_]*(?:\s+(?:as\s+)?[a-z_][a-z0-9_]*)?\s*,/i,
      'a comma-separated table list'],
  ] as const

  /**
   * SQL with its comments removed.
   *
   * **The scoping sweep is a text match, so a comment can satisfy it.** Left in,
   * `-- unit.association_id = $1` makes an entry that scopes nothing look
   * scoped, and the guard the whole story rests on passes on a promise rather
   * than a predicate. Raised by CodeRabbit on MR !71 and confirmed:
   * `/\\bunit\\.association_id\\s*=\\s*\\$1\\b/` matched inside a comment.
   *
   * Applied to the reference scan too — a table named only in a comment is not
   * read by the query, and demanding a predicate for it would fail a correct
   * entry.
   */
  const withoutComments = (sql: string) =>
    sql.replaceAll(/\/\*[\s\S]*?\*\//g, ' ').replaceAll(/--[^\n]*/g, ' ')

  it.each(ALL_ENTRIES.map((entry) => [`${entry.id}@${entry.version}`, entry] as const))(
    '%s uses only SQL the scoping scanner can analyse',
    (_label, entry) => {
      for (const [pattern, what] of UNANALYSABLE) {
        expect(
          pattern.test(withoutComments(entry.sql)),
          `${entry.id}@${entry.version} uses ${what}, which the scoping scanner ` +
            `below cannot see into — it would skip a table and still report success. ` +
            `Extend tableReferences before allowing it.`,
        ).toBe(false)
      }
    },
  )

  it.each(ALL_ENTRIES.map((entry) => [`${entry.id}@${entry.version}`, entry] as const))(
    // No `$1` in this title: vitest reads `$name` in an `it.each` title as a
    // property of the case object, so it would print the whole entry.
    '%s scopes every association-owning table it reads to the association placeholder',
    (_label, entry) => {
      const sql = withoutComments(entry.sql)
      const references = tableReferences(sql).filter(([table]) => SCOPED_TABLES.has(table))

      // Not vacuous: an entry that reads no scoped table at all would pass this
      // sweep by touching nothing, so say out loud that it touched something.
      expect(references.length).toBeGreaterThan(0)

      for (const [table, alias] of references) {
        expect(
          sql,
          `${entry.id}@${entry.version} reads ${table} as "${alias}" without binding it to $1`,
        ).toMatch(new RegExp(`\\b${alias}\\.association_id\\s*=\\s*\\$1\\b`))
      }
    },
  )
})

describe('the catalog itself', () => {
  /**
   * A content check: what the catalog happens to hold today. It passes with the
   * duplicate guard deleted, which is why the rule is tested separately below.
   */
  it('holds no two entries with the same id and version', () => {
    const references = ALL_ENTRIES.map((entry) => `${entry.id}@${entry.version}`)

    expect(new Set(references).size).toBe(references.length)
  })

  /**
   * The rule, tested against a catalog that breaks it.
   *
   * Two entries sharing `(id, version)` would make AD-14 unenforceable from
   * inside the process: `query_log`'s pair would resolve to two SQL texts, and
   * which one ran would depend on array order. Silent last-wins is the outcome
   * without this guard, and the sweep above cannot see the difference.
   */
  describe('rejecting a duplicate registration', () => {
    const anEntry = (version: number, sql: string): CatalogEntry => ({
      id: 'twice_over',
      version,
      description: 'A fixture registered twice, to prove the registry refuses it.',
      sql,
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      bind: [],
    })

    it('throws when two entries share an id and a version', () => {
      expect(() => indexEntries([anEntry(1, 'select 1'), anEntry(1, 'select 2')])).toThrow(
        DuplicateCatalogEntryError,
      )
      expect(() => indexEntries([anEntry(1, 'select 1'), anEntry(1, 'select 2')])).toThrow(
        /twice_over@1/,
      )
    })

    it('accepts two versions of the same entry, which is how a change is made', () => {
      expect(() => indexEntries([anEntry(1, 'select 1'), anEntry(2, 'select 2')])).not.toThrow()
    })
  })
})
