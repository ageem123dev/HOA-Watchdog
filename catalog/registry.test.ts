/**
 * The catalog as a whole: what it holds, and the invariants every entry in it
 * must satisfy.
 *
 * The per-entry assertions here are written as a sweep over `ALL_ENTRIES` rather
 * than as assertions about `dues_status@1`. There is one entry today and the
 * second one is story 3.4's; an invariant written about the first entry is an
 * invariant the second one is not held to, and nothing would say so.
 */

import { loadModule, parseSync } from 'libpg-query'
import { beforeAll, describe, expect, it } from 'vitest'

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
   * `parseSync` throws until the WASM module is resolved, which is why this is
   * here rather than inside the sweep: loading it lazily on first use would make
   * the sweep async, and every fixture and per-entry assertion below would have
   * to become async with it. One await, once, keeps `sweepVerdict` a plain
   * function returning a reason or `null`.
   */
  beforeAll(async () => {
    await loadModule()
  })

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
   * ## The sweep reads SQL. It no longer resembles it.
   *
   * Story 5.1d. What stood here was a hand-written Postgres lexer inside a test
   * file — comment stripping, literal blanking, dollar-tag recognition, a
   * `from`/`join` regex with a keyword lookahead — and over MR !71 it was
   * defeated **eight times**, each by a different lexical form, with two of the
   * fixes introducing false positives of their own. That is a race against
   * Postgres's grammar, and the way to stop losing it is to stop running it.
   *
   * `libpg-query` is the actual PostgreSQL parser compiled to WASM, so the
   * lexical questions simply stop being questions: a nested block comment, an
   * `E'…\'…'` escape string and a `$café$` tag are not puzzles to a parser that
   * *is* Postgres. None of them survive into the tree.
   *
   * **What the parse buys that no scanner could: aliases resolved per query
   * scope.** The bypass that ended the previous round —
   * `from unit where exists (select 1 from assessment as unit where
   * unit.association_id = $1)` — reads every association's units, because the
   * predicate belongs to the *inner* `unit`. A flat namespace sees one `unit`
   * and one predicate and is satisfied. Here each `SelectStmt` is its own scope
   * and the outer `unit` is unbound, which is a refusal.
   *
   * **The sweep is still not the proof.** `adapters/db/catalog-isolation.test.ts`
   * gives two associations the same unit number and runs the real query; that is
   * what establishes isolation. This is the early warning, and this story is
   * about making the early warning honest rather than promoting it.
   */

  /** A table reference, as the parser reports it. */
  interface Reference {
    readonly table: string
    readonly alias: string
    readonly schema: string | null
  }

  type Node = Record<string, unknown>

  const isNode = (value: unknown): value is Node =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

  /**
   * Every `SelectStmt` body in the tree — one per query scope, which is the
   * unit the whole rule is written in terms of. A CTE's query, a derived table
   * and an `EXISTS` subquery each arrive here as their own scope.
   */
  const scopesOf = (node: unknown, out: Node[] = []): Node[] => {
    if (Array.isArray(node)) {
      for (const child of node) scopesOf(child, out)
      return out
    }
    if (!isNode(node)) return out

    for (const [key, value] of Object.entries(node)) {
      if (key === 'SelectStmt' && isNode(value)) out.push(value)
      scopesOf(value, out)
    }
    return out
  }

  /**
   * Walk one scope's own subtree, **stopping at any nested `SelectStmt`**.
   *
   * That boundary is the entire difference between this and what it replaced. A
   * walk that descended would put an inner query's aliases and predicates in the
   * outer scope's namespace, which is precisely the flat namespace the previous
   * scanner had and the bypass it could not see.
   */
  const withinScope = (node: unknown, visit: (key: string, value: Node) => void): void => {
    if (Array.isArray(node)) {
      for (const child of node) withinScope(child, visit)
      return
    }
    if (!isNode(node)) return

    for (const [key, value] of Object.entries(node)) {
      if (key === 'SelectStmt') continue
      if (isNode(value)) visit(key, value)
      withinScope(value, visit)
    }
  }

  /** The tables this scope reads directly. */
  const referencesIn = (scope: Node): Reference[] => {
    const references: Reference[] = []

    withinScope(scope, (key, value) => {
      if (key !== 'RangeVar') return
      const table = String(value.relname ?? '')
      const alias = isNode(value.alias) ? String(value.alias.aliasname ?? '') : ''

      references.push({
        table: table.toLowerCase(),
        alias: (alias || table).toLowerCase(),
        schema: typeof value.schemaname === 'string' ? value.schemaname.toLowerCase() : null,
      })
    })

    return references
  }

  /**
   * The conjuncts of a boolean expression — the predicates that must **all**
   * hold.
   *
   * `OR` and `NOT` contribute nothing, and that is a real bypass this closes
   * rather than a technicality. `where u.association_id = $1 or 1 = 1` contains
   * the scoping predicate and scopes nothing; the text scan this replaces
   * matched it, and so would a parse-based rule that merely looked for the
   * predicate somewhere in the tree. Reachability through `AND` is the property
   * that actually means "this constrains every row returned".
   */
  const conjunctsOf = (node: unknown, out: Node[] = []): Node[] => {
    if (!isNode(node)) return out

    if (isNode(node.BoolExpr)) {
      if (node.BoolExpr.boolop === 'AND_EXPR' && Array.isArray(node.BoolExpr.args)) {
        for (const argument of node.BoolExpr.args) conjunctsOf(argument, out)
      }
      return out
    }
    if (isNode(node.A_Expr)) out.push(node.A_Expr)

    return out
  }

  /**
   * The alias an `= $1` comparison scopes, or `null`.
   *
   * Both operand orders, because `$1 = u.association_id` is the same predicate.
   * An unqualified `association_id = $1` is resolved only when the scope reads
   * exactly one table — otherwise which table it constrains is genuinely
   * ambiguous, and guessing is the habit this story exists to remove.
   */
  const aliasScopedBy = (expression: Node, soleAlias: string | null): string | null => {
    if (expression.kind !== 'AEXPR_OP') return null

    const name = expression.name
    if (!Array.isArray(name) || name.length !== 1) return null
    const operator = isNode(name[0]) && isNode(name[0].String) ? name[0].String.sval : null
    if (operator !== '=') return null

    const sides = [
      [expression.lexpr, expression.rexpr],
      [expression.rexpr, expression.lexpr],
    ] as const

    for (const [column, parameter] of sides) {
      if (!isNode(column) || !isNode(parameter)) continue
      if (!isNode(parameter.ParamRef) || parameter.ParamRef.number !== 1) continue
      if (!isNode(column.ColumnRef) || !Array.isArray(column.ColumnRef.fields)) continue

      const fields = column.ColumnRef.fields
        .map((field) => (isNode(field) && isNode(field.String) ? String(field.String.sval) : null))
        .filter((field): field is string => field !== null)
        .map((field) => field.toLowerCase())

      if (fields.length === 2 && fields[1] === 'association_id') return fields[0]!
      if (fields.length === 1 && fields[0] === 'association_id') return soleAlias
    }

    return null
  }

  /**
   * The aliases this scope proves are bound to `$1`.
   *
   * Two sources, both of which constrain every row the scope returns: the
   * `where` clause, and the `on` conditions of its **inner** joins. Leaving
   * joins out entirely would refuse a correctly scoped entry that binds in `on`
   * — a false rejection is as much a broken guard as a false pass, and harder
   * to notice because somebody simply rewrites the entry until the sweep stops
   * complaining.
   *
   * **An outer join's `on` clause constrains one side, not both**, and getting
   * that wrong is a false pass in the exact direction this sweep exists to
   * prevent. `from unit u left join m on u.association_id = $1` returns every
   * unit row — unmatched ones simply come back with nulls — so crediting `u`
   * would accept a query reading every association's units.
   *
   * The *nullable* side is genuinely filtered by the same clause, and that is
   * not a hypothetical: `dues_status@1` scopes `payment` exactly that way, in
   * the `on` of a `left join`. So the rule is per side rather than per join:
   *
   * - `JOIN_INNER` — the clause filters both sides;
   * - `JOIN_LEFT` — only the right (nullable) side;
   * - `JOIN_RIGHT` — only the left;
   * - `JOIN_FULL`, and anything unrecognised — neither side is filtered, so the
   *   clause credits nothing and the entry must scope in `where`.
   *
   * Raised by Argus, whose finding was right about the preserved side. The
   * first fix here refused outer joins outright, which was blunter than the
   * semantics and **rejected the one entry the catalog actually has** — caught
   * by the per-entry sweep, which is what it is for.
   */
  const boundAliasesIn = (scope: Node): Set<string> => {
    const references = referencesIn(scope)
    const soleAlias = references.length === 1 ? references[0]!.alias : null

    const bound = new Set<string>()

    /** `filtered === null` means the predicates constrain whatever they name. */
    const credit = (predicates: Node[], filtered: Set<string> | null): void => {
      for (const predicate of predicates) {
        const alias = aliasScopedBy(predicate, soleAlias)
        if (alias === null) continue
        if (filtered !== null && !filtered.has(alias)) continue

        bound.add(alias)
      }
    }

    /** The aliases one side of a join brings, so a side can be credited alone. */
    const aliasesOf = (side: unknown): Set<string> =>
      new Set(isNode(side) ? referencesIn(side).map((reference) => reference.alias) : [])

    credit(conjunctsOf(scope.whereClause), null)

    withinScope(scope.fromClause, (key, value) => {
      if (key !== 'JoinExpr') return

      const quals = conjunctsOf(value.quals)
      if (value.jointype === 'JOIN_INNER') credit(quals, null)
      else if (value.jointype === 'JOIN_LEFT') credit(quals, aliasesOf(value.rarg))
      else if (value.jointype === 'JOIN_RIGHT') credit(quals, aliasesOf(value.larg))
      // JOIN_FULL preserves both sides, so its `on` clause filters neither.
      // Anything unrecognised is treated the same way, on purpose.
    })

    return bound
  }

  /**
   * The sweep, as one function.
   *
   * Returns the reason an entry is rejected, or `null` if it passes. **Both the
   * per-entry sweep and the bypass fixtures call this**, because two copies
   * drift: if the per-entry path later loses a stage, fixtures written against
   * their own copy keep passing and stop proving the production path. Raised by
   * CodeRabbit on MR !71, and it had already happened in miniature.
   */
  const sweepVerdict = (
    sql: string,
    // The parser is an argument for one reason: the branch below that tells a
    // *broken harness* apart from an *unparseable entry* is unreachable
    // otherwise, and it is the branch whose failure would be silent. The same
    // reasoning `core/auth/actor-assertion.ts` records about its key and clock —
    // the case worth testing hardest is the one you cannot set up.
    parse: (sql: string) => unknown = parseSync,
  ): string | null => {
    let parsed: Node
    try {
      parsed = parse(sql) as Node
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      // **A broken harness is not a refusal.** `parseSync` throws "WASM module
      // not initialized" when `loadModule()` has not been awaited, and a sweep
      // that folded that into "refused" would turn a setup failure into a suite
      // where every bypass fixture passes for a reason none of them are about.
      // Rethrown so it fails as what it is.
      if (/not initialized/i.test(message)) throw error

      return `is not SQL PostgreSQL can parse (${message.split('\n')[0]!.trim()})`
    }

    const statements = Array.isArray(parsed.stmts) ? parsed.stmts : []
    if (statements.length !== 1) {
      return `is ${statements.length} statements rather than exactly one`
    }

    const scopes = scopesOf(parsed)
    if (scopes.length === 0) return 'is not a select statement'

    let scopedReferences = 0

    for (const scope of scopes) {
      const bound = boundAliasesIn(scope)

      for (const reference of referencesIn(scope)) {
        // Refused, though the parser reads it perfectly well. Whether
        // `public.unit` *is* the scoped `unit` depends on `search_path`, which
        // this sweep does not know and must not assume. The previous version
        // refused it because the scanner misread it; this one refuses it
        // because the question is genuinely open.
        if (reference.schema !== null) {
          return `names ${reference.schema}.${reference.table}, whose identity depends on search_path`
        }
        if (!SCOPED_TABLES.has(reference.table)) continue

        scopedReferences += 1
        if (!bound.has(reference.alias)) {
          return `reads ${reference.table} as "${reference.alias}" without binding it to $1 in its own query scope`
        }
      }
    }

    // Not vacuous: an entry reading no scoped table at all would otherwise pass
    // by touching nothing.
    if (scopedReferences === 0) return 'reads no association-owning table'

    return null
  }

  describe('the scoping sweep', () => {
    /**
     * The harness itself, asserted rather than assumed.
     *
     * Every refusal case below is satisfied by a sweep that refuses
     * *everything*, and an unloaded WASM module is exactly that sweep. So this
     * says out loud that the parser is working and that a real entry passes,
     * before any of the refusals mean anything.
     */
    it('has a working parser, so the refusals below are not refusing everything', () => {
      expect(sweepVerdict('select u.unit_number from unit u where u.association_id = $1')).toBeNull()
    })

    /**
     * The distinction the sweep is built to preserve, and the reason the parser
     * is injectable at all.
     *
     * An uninitialised WASM module makes `parseSync` throw. Folded into the
     * `catch` below it, that becomes "this entry is unanalysable" — and then
     * **every refusal fixture in this file passes while the parser is not
     * running at all**, which is a green suite proving nothing. So the two are
     * told apart, and both directions are asserted here rather than reasoned
     * about.
     */
    it('rethrows a harness failure instead of reporting it as a refused entry', () => {
      const uninitialised = () => {
        throw new Error('WASM module not initialized. Call `loadModule()` first.')
      }

      expect(() => sweepVerdict('select 1 from unit', uninitialised)).toThrow(/not initialized/i)
    })

    it('reports a genuine parse failure as a refusal, not as a crash', () => {
      const syntaxError = () => {
        throw new Error('syntax error at or near "this"')
      }

      expect(sweepVerdict('this is not sql', syntaxError)).toMatch(
        /is not SQL PostgreSQL can parse/,
      )
    })

    /**
     * All eight bypasses found on MR !71, plus the ones the parser makes
     * newly expressible. Each names the reason, so a case that starts passing
     * for a *different* reason than it was written for shows up as a changed
     * message rather than as a silent pass.
     */
    it.each([
      // --- the eight from MR !71 ---------------------------------------------
      [
        'a predicate hidden in a line comment',
        'select 1 from unit -- unit.association_id = $1',
        /without binding it to \$1/,
      ],
      [
        'a predicate hidden in a nested block comment',
        'select 1 from unit /* outer /* inner */ unit.association_id = $1 */ where 1 = 1',
        /without binding it to \$1/,
      ],
      [
        'a predicate hidden in a string literal',
        "select 'unit.association_id = $1' from unit",
        /without binding it to \$1/,
      ],
      [
        'a predicate hidden in an E-string with an escaped quote',
        "select 1 from unit where x = E'unit.association_id = $1 \\' '",
        /without binding it to \$1/,
      ],
      [
        'a predicate hidden in a non-ASCII dollar tag',
        'select 1 from unit where x = $café$unit.association_id = $1$café$',
        /without binding it to \$1/,
      ],
      [
        'a schema-qualified name',
        'select 1 from public.unit where unit.association_id = $1',
        /depends on search_path/,
      ],
      [
        'a comma-separated list leaving the second table unbound',
        'select 1 from assessment a, unit u where a.association_id = $1',
        /reads unit as "u" without binding it/,
      ],
      [
        'an alias shadowed inside a subquery',
        'select 1 from unit where exists (select 1 from assessment as unit where unit.association_id = $1)',
        /reads unit as "unit" without binding it/,
      ],
      // --- what the parser makes newly checkable -----------------------------
      [
        'a scoping predicate disarmed by OR',
        'select 1 from unit u where u.association_id = $1 or 1 = 1',
        /without binding it to \$1/,
      ],
      [
        'a scoping predicate negated',
        'select 1 from unit u where not (u.association_id = $1)',
        /without binding it to \$1/,
      ],
      [
        'a CTE whose inner query is unscoped',
        'with t as (select 1 from unit) select 1 from t',
        /reads unit as "unit" without binding it/,
      ],
      [
        'a derived table whose inner query is unscoped',
        'select 1 from (select 1 from unit) u',
        /reads unit as "unit" without binding it/,
      ],
      [
        'an IN subquery reading a scoped table unbound',
        'select 1 from unit u where u.association_id = $1 and u.id in (select a.unit_id from assessment a)',
        /reads assessment as "a" without binding it/,
      ],
      [
        'a placeholder that is not the association one',
        'select 1 from unit u where u.association_id = $2',
        /without binding it to \$1/,
      ],
      [
        'an ambiguous unqualified predicate with two tables in scope',
        'select 1 from assessment a join unit u on u.id = a.unit_id where association_id = $1',
        /without binding it to \$1/,
      ],
      // --- not analysable at all ---------------------------------------------
      ['SQL that does not parse', 'select from where', /is not SQL PostgreSQL can parse/],
      ['not SQL at all', 'this is not sql', /is not SQL PostgreSQL can parse/],
      [
        'two statements',
        'select 1 from unit u where u.association_id = $1; select 1',
        /2 statements rather than exactly one/,
      ],
      ['no scoped table at all', 'select 1 from schema_migration', /reads no association-owning/],
      /**
       * An outer join's `on` clause does not filter the **preserved** side.
       * `unit left join … on u.association_id = $1` returns every unit row
       * regardless of the predicate — unmatched ones simply come back with
       * nulls for the other table. Crediting `u` there would accept a query
       * that reads every association's units.
       *
       * Raised by Argus on the first review of this rewrite, and it is a defect
       * the *previous* scanner could not even have had, because it never looked
       * at join conditions at all. Reading SQL properly means owning SQL's
       * semantics, not just its syntax.
       */
      [
        'a predicate on the preserved side of a left join',
        'select 1 from unit u left join schema_migration m on u.association_id = $1',
        /reads unit as "u" without binding it/,
      ],
      [
        'a predicate on the preserved side of a right join',
        'select 1 from schema_migration m right join unit u on u.association_id = $1',
        /reads unit as "u" without binding it/,
      ],
      [
        'a predicate in a full join, which preserves both sides',
        'select 1 from unit u full join schema_migration m on u.association_id = $1',
        /reads unit as "u" without binding it/,
      ],
    ])('rejects %s, and says why', (_label, sql, reason) => {
      expect(sweepVerdict(sql)).toMatch(reason)
    })

    /**
     * The inverse, and the half that keeps the block above honest. Each of these
     * is a shape a correct entry may legitimately take, and a sweep that refused
     * them would be pushing entry authors to rewrite correct SQL until the guard
     * stopped complaining.
     */
    it.each([
      ['a single table bound in where', 'select 1 from unit u where u.association_id = $1'],
      ['no alias, bound by table name', 'select 1 from unit where unit.association_id = $1'],
      [
        'an unqualified predicate with exactly one table in scope',
        'select 1 from unit where association_id = $1',
      ],
      ['the operands reversed', 'select 1 from unit u where $1 = u.association_id'],
      ['AS spelled out', 'select 1 from unit as u where u.association_id = $1'],
      [
        'two tables, each bound in where',
        'select 1 from assessment a join unit u on u.id = a.unit_id where a.association_id = $1 and u.association_id = $1',
      ],
      [
        'a table bound in the join condition rather than the where clause',
        'select 1 from assessment a join unit u on u.id = a.unit_id and u.association_id = $1 where a.association_id = $1',
      ],
      [
        'a subquery whose own scoped table is bound in its own scope',
        'select 1 from unit u where u.association_id = $1 and exists (select 1 from assessment a where a.association_id = $1 and a.unit_id = u.id)',
      ],
      [
        'an unscoped table alongside a scoped one',
        'select 1 from unit u join schema_migration m on true where u.association_id = $1',
      ],
      /**
       * The nullable side of an outer join, scoped in the `on` clause — which
       * is not a contrived shape: it is exactly how `dues_status@1` scopes
       * `payment`. Refusing this was the first, too-blunt fix for the
       * preserved-side defect, and the per-entry sweep caught it.
       */
      [
        'the nullable side of a left join, scoped in its on clause',
        'select 1 from unit u left join payment p on p.unit_id = u.id and p.association_id = $1 where u.association_id = $1',
      ],
      [
        'the nullable side of a right join, scoped in its on clause',
        'select 1 from payment p right join unit u on p.unit_id = u.id and p.association_id = $1 where u.association_id = $1',
      ],
    ])('accepts %s', (_label, sql) => {
      expect(sweepVerdict(sql)).toBeNull()
    })
  })

  it.each(ALL_ENTRIES.map((entry) => [`${entry.id}@${entry.version}`, entry] as const))(
    '%s scopes every association-owning table it reads to the association placeholder',
    (_label, entry) => {
      // The same `sweepVerdict` the fixtures above use. One implementation, so a
      // stage dropped here is a stage dropped there — rather than fixtures that
      // keep passing against a pipeline the entries no longer go through.
      //
      // The second sweep that used to sit here re-implemented the check with its
      // own copy of the scanner, which is the duplication the comment above
      // warns about, present in the same file. Story 5.1d removed it.
      expect(
        sweepVerdict(entry.sql),
        `${entry.id}@${entry.version} was rejected by the scoping sweep. Every association-owning ` +
          `table an entry reads must be bound to $1 within the query scope that reads it, and a ` +
          `construct whose meaning depends on something the sweep cannot see — a schema ` +
          `qualification, an ambiguous unqualified predicate — is refused rather than guessed at.`,
      ).toBeNull()
    },
  )

  it.each(ALL_ENTRIES.map((entry) => [`${entry.id}@${entry.version}`, entry] as const))(
    '%s reads at least one association-owning table, so the sweep above is not vacuous',
    (_label, entry) => {
      const scoped = scopesOf(parseSync(entry.sql) as Node)
        .flatMap((scope) => referencesIn(scope))
        .filter((reference) => SCOPED_TABLES.has(reference.table))

      expect(scoped.length).toBeGreaterThan(0)
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
