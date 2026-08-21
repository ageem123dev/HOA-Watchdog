/**
 * What the `QueryLog` port is allowed to express.
 *
 * Types and prose, so there is no behaviour to run. What can be checked is the
 * shape of the declaration, and this port's shape is its argument: it writes and
 * cannot read, because story 3.8 gives the audit trail a reader and that reader
 * is a board member — not the query path the trail is recording.
 *
 * The member reader is `core/ports/declared-members.ts`, which has its own tests
 * for the ways it has been wrong. Nothing here re-tests the helper.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { declaredMembers } from './declared-members'

const HERE = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(HERE, 'query-log.ts'), 'utf8')

describe('the QueryLog port', () => {
  it('declares exactly the one member AD-12 needs', () => {
    expect(declaredMembers(source, 'QueryLog')).toEqual([
      'record(entry: QueryLogEntry): Promise<QueryLogRecord>',
    ])
  })

  /**
   * The forms a read capability could arrive in. Each one was found escaping an
   * earlier name-matching helper on a sibling port, so they are listed here as
   * the record of what was missed rather than as hypotheses.
   */
  it.each([
    ['a named method', '  find(entryId: string): Promise<QueryLogEntry[]>'],
    ['a function-typed property', '  readonly find: (entryId: string) => Promise<unknown>'],
    ['a generic method', '  find<T>(entryId: string): Promise<T>'],
    ['a call signature', '  (entryId: string): Promise<unknown>'],
    ['an index signature', '  [key: string]: unknown'],
    ['an optional method', '  find?(entryId: string): Promise<unknown>'],
    ['a quoted member name', '  "find"(entryId: string): Promise<unknown>'],
  ])('sees a read capability declared as %s', (_label, member) => {
    const sample = [
      'export interface QueryLog {',
      '  record(entry: QueryLogEntry): Promise<string>',
      member,
      '}',
    ].join('\n')

    expect(declaredMembers(sample, 'QueryLog')).toHaveLength(2)
    expect(declaredMembers(sample, 'QueryLog')[1]).toBe(member.trim())
  })

  /**
   * AD-12 lists what a record carries, and a field missing from the type is a
   * field the adapter cannot write. `executed_at` is deliberately absent — the
   * database stamps it, so a caller cannot backdate a query.
   */
  it('carries every field AD-12 requires a record to hold', () => {
    expect(declaredMembers(source, 'QueryLogEntry')).toEqual([
      'readonly actorId: string',
      'readonly entryId: string',
      'readonly entryVersion: number',
      'readonly parameters: Readonly<Record<string, unknown>>',
      'readonly sqlText: string',
    ])
  })
})
