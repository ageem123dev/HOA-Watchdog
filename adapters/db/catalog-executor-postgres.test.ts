/**
 * AD-12's ordering, which is the one property of this story that no database can
 * demonstrate.
 *
 * "A query path that can execute without writing this record is a defect."
 *
 * `catalog-execution.test.ts` proves the whole path works against the real
 * database. It cannot prove *ordering*, and the reason is worth stating because
 * it is the trap the acceptance criterion warns about: if the provenance write
 * fails, an executor that logs first and an executor that logs last both reject
 * and both return no rows to the caller. The observable outcome is identical.
 *
 * What tells them apart is whether the query ran at all — so the query runner is
 * a seam, and these tests watch it. An executor that runs the SELECT and then
 * logs would leave a director's dues on a wire with nothing in the audit trail
 * saying anyone asked, which is precisely the state AD-12 exists to make
 * unreachable.
 */

import { describe, expect, it } from 'vitest'

import { duesStatusV1 } from '../../catalog/entries/dues-status-v1'
import type { QueryLog, QueryLogEntry } from '../../core/ports/query-log'
import { createCatalogExecutorWith } from './catalog-executor-postgres'

const ACTOR = '00000000-0000-7000-8000-000000000001'
const VALID = { unitNumber: '4B', assessmentYear: 2026 }

interface Harness {
  readonly calls: string[]
  readonly recorded: QueryLogEntry[]
  readonly queries: { sql: string; values: readonly unknown[] }[]
}

/**
 * Both collaborators append to one list, so the assertions can be about order
 * rather than about each one in isolation.
 */
function harness(options: { logFails?: Error; queryFails?: Error; rows?: unknown[] } = {}) {
  const state: Harness = { calls: [], recorded: [], queries: [] }

  const queryLog: QueryLog = {
    async record(entry) {
      state.calls.push('record')
      state.recorded.push(entry)
      if (options.logFails) throw options.logFails

      return 'provenance-row-id'
    },
  }

  const runQuery = async (sql: string, values: readonly unknown[]) => {
    state.calls.push('query')
    state.queries.push({ sql, values })
    if (options.queryFails) throw options.queryFails

    return (options.rows ?? []) as Record<string, unknown>[]
  }

  return { state, executor: createCatalogExecutorWith({ queryLog, runQuery }) }
}

describe('executing a catalog entry', () => {
  describe('the ordinary case', () => {
    it('records the provenance, then runs the query, and hands back both', async () => {
      const { state, executor } = harness({ rows: [{ unitNumber: '4B', annualAmount: '1200.00' }] })

      const execution = await executor.execute({
        entryId: 'dues_status',
        version: 1,
        parameters: VALID,
        actorId: ACTOR,
      })

      expect(state.calls).toEqual(['record', 'query'])
      expect(execution.provenanceId).toBe('provenance-row-id')
      expect(execution.rows).toEqual([{ unitNumber: '4B', annualAmount: '1200.00' }])
    })

    it('logs the exact SQL the catalog holds, not a paraphrase of it', async () => {
      const { state, executor } = harness()

      await executor.execute({
        entryId: 'dues_status',
        version: 1,
        parameters: VALID,
        actorId: ACTOR,
      })

      expect(state.recorded[0]!.sqlText).toBe(duesStatusV1.sql)
      expect(state.queries[0]!.sql).toBe(duesStatusV1.sql)
    })

    it('logs the version that ran and the actor who asked', async () => {
      const { state, executor } = harness()

      await executor.execute({
        entryId: 'dues_status',
        version: 1,
        parameters: VALID,
        actorId: ACTOR,
      })

      expect(state.recorded[0]).toMatchObject({
        actorId: ACTOR,
        entryId: 'dues_status',
        entryVersion: 1,
        parameters: VALID,
      })
    })

    /**
     * The binding order comes from the entry, never from the caller's object.
     *
     * Object key order is not a contract anybody should be relying on, and this
     * is the failure that would not look like one: the query runs, returns rows,
     * and answers about the wrong unit and the wrong year.
     */
    it('binds values in the entry\'s declared order, whatever order they arrive in', async () => {
      const { state, executor } = harness()

      await executor.execute({
        entryId: 'dues_status',
        version: 1,
        parameters: { assessmentYear: 2026, unitNumber: '4B' },
        actorId: ACTOR,
      })

      expect(duesStatusV1.bind).toEqual(['unitNumber', 'assessmentYear'])
      expect(state.queries[0]!.values).toEqual(['4B', 2026])
    })
  })

  /**
   * The acceptance criterion, and the only test in the story that can carry it.
   */
  describe('when the provenance write fails', () => {
    it('does not run the query', async () => {
      const { state, executor } = harness({ logFails: new Error('query_log is unreachable') })

      await expect(
        executor.execute({
          entryId: 'dues_status',
          version: 1,
          parameters: VALID,
          actorId: ACTOR,
        }),
      ).rejects.toThrow(/query_log is unreachable/)

      expect(state.calls).toEqual(['record'])
      expect(state.queries).toEqual([])
    })

    it('lets the failure escape rather than answering from an unlogged query', async () => {
      const { executor } = harness({ logFails: new Error('query_log is unreachable') })

      await expect(
        executor.execute({
          entryId: 'dues_status',
          version: 1,
          parameters: VALID,
          actorId: ACTOR,
        }),
      ).rejects.toThrow(Error)
    })
  })

  describe('when the request never should have reached the database', () => {
    it('logs nothing and runs nothing for an entry that does not exist', async () => {
      const { state, executor } = harness()

      await expect(
        executor.execute({
          entryId: 'drop_everything',
          version: 1,
          parameters: VALID,
          actorId: ACTOR,
        }),
      ).rejects.toThrow(/drop_everything/)

      expect(state.calls).toEqual([])
    })

    it('logs nothing and runs nothing for a version that does not exist', async () => {
      const { state, executor } = harness()

      await expect(
        executor.execute({
          entryId: 'dues_status',
          version: 99,
          parameters: VALID,
          actorId: ACTOR,
        }),
      ).rejects.toThrow(/dues_status.*99/)

      expect(state.calls).toEqual([])
    })

    /**
     * Validation precedes the provenance write, so a rejected parameter set
     * leaves no row behind. The audit trail records executions, and a request
     * that never became one is not an execution — it is a caller being told no.
     */
    it.each([
      ['a missing parameter', { unitNumber: '4B' }],
      ['an undeclared parameter', { ...VALID, limit: 1000 }],
      ['a wrongly typed parameter', { unitNumber: '4B', assessmentYear: '2026' }],
    ])('logs nothing and runs nothing for %s', async (_label, parameters) => {
      const { state, executor } = harness()

      await expect(
        executor.execute({ entryId: 'dues_status', version: 1, parameters, actorId: ACTOR }),
      ).rejects.toThrow()

      expect(state.calls).toEqual([])
    })
  })

  /**
   * The other half of the ordering: a query that fails *after* the record was
   * written leaves that record in place. There is no compensating delete, and
   * there could not be — migration 020 takes DELETE away from the only role that
   * could issue one. A logged execution states what was executed, not that it
   * succeeded.
   */
  describe('when the query fails after the record is written', () => {
    it('leaves the provenance record and lets the query error escape', async () => {
      const { state, executor } = harness({ queryFails: new Error('relation does not exist') })

      await expect(
        executor.execute({
          entryId: 'dues_status',
          version: 1,
          parameters: VALID,
          actorId: ACTOR,
        }),
      ).rejects.toThrow(/relation does not exist/)

      expect(state.calls).toEqual(['record', 'query'])
      expect(state.recorded).toHaveLength(1)
    })
  })
})
