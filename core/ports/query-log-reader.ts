/**
 * The port through which a board member reads the provenance log (story 3.8).
 *
 * **Separate from `QueryLog` on purpose, and the separation is the design.**
 * That port's own comment is explicit about why a `find` method does not belong
 * on it:
 *
 * > "Story 3.8 is what gives the log a reader, and it will surface it through
 * > the gateway to a board member — not to the query path, which is the thing
 * > being recorded. A `find` method here would satisfy the same acceptance
 * > criteria and hand the audit trail to its own subject."
 *
 * So the reading capability exists here, where the query path has no reason to
 * reach for it, and the writing capability stays there. Two ports rather than
 * one interface with two methods, because a capability nothing declares is a
 * capability nothing can quietly acquire — the argument AD-11 makes for the
 * model, applied to our own code.
 *
 * **There is no `record` here and there never will be.** A reader that could
 * append is a reader that could forge an entry in the record of who read what.
 */

/**
 * One provenance record, as it comes back out.
 *
 * Wider than `QueryLogEntry`, which is what goes *in*. That type deliberately
 * omits `executedAt` and the id so a caller cannot backdate a query or choose
 * its identity; both are stamped by the database, and both are exactly what a
 * reader needs — the timestamp is half of "who asked what and when", and the id
 * is how a specific row gets cited in a dispute.
 */
export interface QueryLogRecord {
  /** The row's own id, so a reader can cite one. */
  readonly id: string

  /** The board member the query was run for. */
  readonly actorId: string

  /** Stamped by the database, never by a caller. */
  readonly executedAt: Date

  /** The catalog entry id, `verb_noun`. */
  readonly entryId: string

  /** The version that actually executed. */
  readonly entryVersion: number

  /** The bound parameter values, keyed by parameter name. */
  readonly parameters: Readonly<Record<string, unknown>>

  /**
   * The exact SQL that ran, character for character.
   *
   * Stored verbatim rather than looked up by version, so the trail survives the
   * catalog file being deleted or lost to a bad merge. It is the column that
   * makes a record reproducible a year later, which is the whole point of
   * keeping one.
   */
  readonly sqlText: string
}

/**
 * How a reader narrows the trail.
 *
 * Applied **in the query**, never in the browser. A surface that fetches
 * everything and hides some of it has still put the whole audit trail on the
 * wire, and the trail names every question every board member has asked.
 */
export interface QueryLogFilter {
  /** Only this board member's queries. */
  readonly actorId?: string

  /** Only this catalog entry, across versions. */
  readonly entryId?: string

  /**
   * How many rows at most.
   *
   * Required rather than optional: an audit trail grows without bound, and the
   * caller that forgets a limit is the one that renders a page which never
   * finishes loading. Making it a required argument means that caller does not
   * exist.
   */
  readonly limit: number
}

/**
 * The most rows any single read will return.
 *
 * Declared on the port rather than inside the adapter, because two callers need
 * to agree about it. The adapter clamps to this; the surface parses a `?limit=`
 * against it. When only the adapter knew, a URL asking for 10,000 rows kept that
 * number in the page and in the form while the database returned 500 — the
 * reader was told they were looking at more of the audit trail than they were.
 * Raised by Argus.
 */
export const MAX_LIMIT = 500

export interface QueryLogReader {
  /**
   * The matching records, newest first.
   *
   * Newest first because an audit trail is read from the present backwards: the
   * question a reader arrives with is almost always about something recent.
   */
  recent(filter: QueryLogFilter): Promise<readonly QueryLogRecord[]>
}
