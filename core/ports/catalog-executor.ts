/**
 * The port a caller reaches the query catalog through.
 *
 * AD-5: "The agent selects a named entry from a fixed, version-controlled query
 * catalog and supplies typed parameters. […] Free-form SQL from a model is never
 * executed."
 *
 * **There is no argument here through which SQL can travel**, and that is the
 * enforcement rather than a convention about how to call it. A request names an
 * entry and a version and carries values; the text that runs is resolved from
 * the catalog on the other side. Story 3.2 puts this behind `/tools/*` and story
 * 3.4 lets a model fill the request in — neither of them widens this shape.
 */

export interface CatalogExecutionRequest {
  /** The catalog entry id, `verb_noun`. */
  readonly entryId: string

  /**
   * The version to run, always explicit.
   *
   * The executor never resolves "the current one" for a caller. A provenance row
   * has to name the version that actually executed, and a caller that meant
   * `dues_status@1` should not silently get `@2` because one was minted between
   * the question and the answer. `currentVersionOf` in the catalog registry is
   * where a caller asks what current means, before it commits to a version.
   */
  readonly version: number

  /** Values keyed by parameter name, validated against the entry's schema. */
  readonly parameters: Readonly<Record<string, unknown>>

  /** The board member the query is run for; recorded as the actor (AD-12). */
  readonly actorId: string
}

export interface CatalogExecution {
  /**
   * The id of the `query_log` row written before the query ran.
   *
   * Returned rather than discarded so that "was this execution logged?" is
   * answerable from the result itself. A caller holding a `CatalogExecution`
   * holds proof of its own provenance record.
   */
  readonly provenanceId: string

  /**
   * The rows, exactly as the entry's SELECT list named them.
   *
   * `unknown` values rather than a mapped type: the shape is the entry's, and an
   * entry is data. Story 3.5's numeric validator reads these, and it must read
   * what actually came back rather than what a type said would.
   */
  readonly rows: readonly Readonly<Record<string, unknown>>[]
}

export interface CatalogExecutor {
  /**
   * Runs a catalog entry, having first recorded that it is about to.
   *
   * Rejects — and runs nothing — if the entry does not exist, if the parameters
   * do not match its schema, or if the provenance record cannot be written.
   */
  execute(request: CatalogExecutionRequest): Promise<CatalogExecution>
}
