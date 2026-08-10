/**
 * The port through which a catalog execution records that it happened.
 *
 * AD-12: "Each catalog execution appends an immutable record — user id,
 * timestamp, catalog entry id and version, bound parameter values, and the exact
 * SQL text executed — *before* the result is returned to the caller. […] A query
 * path that can execute without writing this record is a defect."
 *
 * **This port can only write, and the absence of a read method is the design.**
 * `core/ports/assessment-directory.ts` and `unit-directory.ts` make the opposite
 * argument for the same reason, and the reason is that a caller cannot quietly
 * reach for a method that was never declared. Story 3.8 is what gives the log a
 * reader, and it will surface it through the gateway to a board member — not to
 * the query path, which is the thing being recorded. A `find` method here would
 * satisfy the same acceptance criteria and hand the audit trail to its own
 * subject.
 *
 * There is no update and no delete, and there never will be: migration 020 takes
 * both privileges away from the only role that could use them, so a method
 * declared here would be a method the database refuses. The type and the grant
 * say the same thing, which is the arrangement migration 007's comment argues
 * for — a second statement of a shape is safe when something fails on
 * disagreement, and here the failure is a `42501` on the first call.
 */

/**
 * One provenance record, as the caller supplies it.
 *
 * `executed_at` and the row id are absent on purpose: the database stamps both,
 * so a caller cannot backdate a query or choose its identity.
 */
export interface QueryLogEntry {
  /** The board member the query is being run for. */
  readonly actorId: string

  /** The catalog entry id, `verb_noun`. */
  readonly entryId: string

  /** The version that actually executed — never "whatever is current". */
  readonly entryVersion: number

  /**
   * The bound parameter values, keyed by parameter name.
   *
   * The values as bound, not as typed by a user: this is what has to be replayed
   * against the SQL text to reproduce the answer a year later.
   */
  readonly parameters: Readonly<Record<string, unknown>>

  /** The exact SQL sent to the database, character for character. */
  readonly sqlText: string
}

export interface QueryLog {
  /**
   * Appends the record and returns its id.
   *
   * Returning the id rather than `void` is what lets a caller prove the write
   * happened before it did anything else — and it gives the executor something
   * to hand back, so "was this logged?" is answerable from the result rather
   * than by going and looking.
   *
   * It rejects rather than resolving on failure, and the caller must not
   * continue: an execution whose provenance write failed is the defect AD-12
   * names.
   */
  record(entry: QueryLogEntry): Promise<string>
}
