/**
 * What the `CatalogExecutor` port is allowed to express.
 *
 * AD-5's enforcement is the shape of the request, not a convention about how to
 * call it: a request that could carry SQL is a request through which a model
 * could author SQL, whatever the prompt said.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { declaredMembers } from './declared-members'

const HERE = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(HERE, 'catalog-executor.ts'), 'utf8')

describe('the CatalogExecutor port', () => {
  it('gives a caller no way to supply SQL', () => {
    const request = declaredMembers(source, 'CatalogExecutionRequest')

    expect(request).toEqual([
      'readonly entryId: string',
      'readonly version: number',
      'readonly parameters: Readonly<Record<string, unknown>>',
      'readonly actorId: string',
    ])
    expect(request.join('\n')).not.toMatch(/sql/i)
  })

  it('hands back the provenance id, so a caller holds proof of its own record', () => {
    expect(declaredMembers(source, 'CatalogExecution')).toEqual([
      'readonly provenanceId: string',
      'readonly rows: readonly Readonly<Record<string, unknown>>[]',
    ])
  })

  it('declares exactly the one way in', () => {
    expect(declaredMembers(source, 'CatalogExecutor')).toEqual([
      'execute(request: CatalogExecutionRequest): Promise<CatalogExecution>',
    ])
  })
})
