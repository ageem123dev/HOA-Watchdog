/**
 * What a catalog entry is.
 *
 * AD-5: "The agent selects a named entry from a fixed, version-controlled query
 * catalog and supplies typed parameters. […] Free-form SQL from a model is never
 * executed. A new question shape is a new catalog entry — a story, not a runtime
 * capability."
 *
 * These are declarations, not behaviour. Nothing in this directory opens a
 * connection, reads an environment variable or imports `pg`: an entry is the SQL
 * text and the shape of its inputs, so that reviewing an entry is reviewing the
 * whole of what will run. `adapters/db/catalog-executor-postgres.ts` is the only
 * thing that executes one.
 */

/**
 * The types a catalog parameter may have.
 *
 * Two, because two is what the catalog uses. This is deliberately not a general
 * JSON Schema vocabulary: every type in this union is a type
 * `validate-parameters.ts` checks and a test forces, and adding a third is a
 * change with a test attached rather than a config value someone sets.
 */
export type ParameterType = 'string' | 'integer'

export interface ParameterDeclaration {
  readonly type: ParameterType

  /**
   * What the parameter means, in the words a model will read.
   *
   * Story 3.4 hands these schemas to the reasoning model as tool definitions,
   * so this text is part of how an entry gets chosen. It is deliberately outside
   * the AD-14 digest: rewording a description changes how well the model picks,
   * never what the entry accepts or what it runs.
   */
  readonly description: string
}

/**
 * The parameter schema, in the shape the tool contract requires.
 *
 * The architecture's Consistency Conventions: "Every agent-facing tool declares
 * `strict: true` and `additionalProperties: false`. A tool without both is not
 * registered." `additionalProperties` is typed as the literal `false` so an
 * entry that tries to relax it does not compile — the cheapest available
 * enforcement, and one that cannot be forgotten at registration time.
 */
export interface ParameterSchema {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, ParameterDeclaration>>
  readonly required: readonly string[]
  readonly additionalProperties: false
}

export interface CatalogEntry {
  /** Stable, `verb_noun`, and never reused for a different question. */
  readonly id: string

  /** Starts at 1 and only goes up. Frozen once published — see AD-14. */
  readonly version: number

  /**
   * What this entry answers, in one sentence, in the words a model reads.
   *
   * The reasoning model chooses between entries on this text and the parameter
   * descriptions below it, and on nothing else — `agent-view.ts` is what it is
   * handed, and that carries no SQL. An entry whose description does not
   * distinguish it from its neighbours is an entry that gets chosen by accident,
   * which is a wrong financial answer rather than a missing one.
   *
   * **Outside the AD-14 digest, deliberately**, exactly as
   * `ParameterDeclaration.description` is: rewording this changes how well the
   * model picks and never what the entry accepts or what it runs. A digest that
   * moved on a reworded sentence would fire on edits that change nothing, and a
   * check that cries wolf gets silenced. `published-versions.test.ts` pins that
   * property rather than leaving it to this comment.
   */
  readonly description: string

  /**
   * The reviewed SQL, with `$1 … $n` placeholders and nothing interpolated.
   *
   * A single statement, no trailing semicolon: `pg` sends this text as one
   * query, and a semicolon is the character that turns one statement into two.
   */
  readonly sql: string

  readonly parameters: ParameterSchema

  /**
   * Parameter names in the positional order the SQL's placeholders expect, so
   * `bind[0]` is `$1`.
   *
   * This is the join between a named parameter set and a positional query, and
   * it is the part of an entry that can be wrong without looking wrong: swapping
   * two entries of the same type runs perfectly and answers about the wrong
   * unit. `registry.test.ts` holds every entry to its SQL's actual placeholders.
   */
  readonly bind: readonly string[]
}
