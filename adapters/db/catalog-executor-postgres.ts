import { Pool } from 'pg'

import { bindValues } from '../../catalog/bind-values'
import { entryFor } from '../../catalog/registry'
import { validateParameters } from '../../catalog/validate-parameters'
import type {
  CatalogExecution,
  CatalogExecutionRequest,
  CatalogExecutor,
} from '../../core/ports/catalog-executor'
import type { QueryLog } from '../../core/ports/query-log'
import { readReaderDatabaseUrl } from '../auth/env'
import { createQueryLog } from './query-log-postgres'

/**
 * The only thing that executes a catalog entry.
 *
 * Connects as `watchdog_reader`, like the unit and assessment directories and
 * for the stronger version of the same reason: AD-4 names this path
 * specifically — "`watchdog_reader` is SELECT-only and is the *only* role any
 * catalog query executes under". A prompt-injected agent that reached this far
 * still cannot mutate anything, because the connection it arrives on has no
 * capability to.
 *
 * ## The order, which is the whole point
 *
 * Resolve the entry, validate the parameters, **write the provenance record**,
 * then run the query. AD-12: "A query path that can execute without writing this
 * record is a defect." Logging first is what makes that structural rather than
 * customary — if the write fails, there is no path to the SELECT.
 *
 * The two halves are on different connections under different roles and cannot
 * share a transaction, so a record can exist for a query that then failed. That
 * is the honest reading and it is stated in migration 020's comment too: a row
 * says what was executed, not that rows came back. The alternative — log
 * afterwards — would record only successes, and an agent induced into firing
 * five hundred failing queries would leave nothing behind at all.
 *
 * Validation happens *before* the record, and that is a different judgement: a
 * request whose parameters do not match the schema never becomes an execution,
 * so there is nothing for the trail to record. What it produces is a caller
 * being told no, which the caller can see for itself.
 */

export interface CatalogQueryRunner {
  (sql: string, values: readonly unknown[]): Promise<Record<string, unknown>[]>
}

export interface CatalogExecutorDependencies {
  readonly queryLog: QueryLog
  readonly runQuery: CatalogQueryRunner
}

let sharedPool: Pool | null = null

/** One pool per process, built on first use — see the `next build` note in `../auth/env.ts`. */
function getPool(): Pool {
  if (sharedPool === null) {
    sharedPool = new Pool({
      connectionString: readReaderDatabaseUrl(),
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
    })

    sharedPool.on('error', () => {
      // An idle client failing has no request to reject. With no listener here
      // Node treats it as unhandled and takes the process down.
    })
  }

  return sharedPool
}

const runAgainstReader: CatalogQueryRunner = async (sql, values) => {
  const { rows } = await getPool().query<Record<string, unknown>>(sql, [...values])

  return rows
}

/** The production wiring: the reader pool, and the Postgres provenance log. */
export function createCatalogExecutor(): CatalogExecutor {
  return createCatalogExecutorWith({ queryLog: createQueryLog(), runQuery: runAgainstReader })
}

/**
 * The same executor with its two collaborators supplied.
 *
 * The seam exists for one assertion that nothing else can make. If the
 * provenance write fails, an executor that logs first and one that logs last
 * both reject and both return no rows — the outcomes are identical from outside.
 * What separates them is whether the SELECT ran, and only a caller holding the
 * query runner can see that. `catalog-executor-postgres.test.ts` is that caller.
 */
export function createCatalogExecutorWith(
  dependencies: CatalogExecutorDependencies,
): CatalogExecutor {
  return {
    async execute(request: CatalogExecutionRequest): Promise<CatalogExecution> {
      // Throws for an unknown id or an unknown version, and says which. Before
      // anything is logged, because a request naming an entry that does not
      // exist has no SQL text to record and no execution to attribute.
      const entry = entryFor(request.entryId, request.version)

      validateParameters(entry.parameters, request.parameters)

      const provenanceId = await dependencies.queryLog.record({
        actorId: request.actorId,
        entryId: entry.id,
        entryVersion: entry.version,
        parameters: request.parameters,
        // The entry's own text, not the request's — there is nothing in a
        // request that could supply SQL, and this is where that stops being a
        // property of the type and becomes a property of what runs.
        sqlText: entry.sql,
      })

      // Positional, in the order the entry declares. Reading the values off the
      // request object in its own key order would answer about the wrong unit
      // whenever a caller happened to write the keys the other way round, and
      // the query would succeed while doing it.
      const rows = await dependencies.runQuery(entry.sql, bindValues(entry, request.parameters))

      return { provenanceId, rows }
    },
  }
}
