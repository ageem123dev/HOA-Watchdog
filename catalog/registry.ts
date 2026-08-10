/**
 * The catalog: every entry that exists, and the only way to reach one.
 *
 * A lookup rather than an export of the entries themselves, because AD-5 makes
 * "which SQL runs" a decision the catalog owns and not one a caller composes.
 * The executor is handed an id and a version; it never holds SQL.
 */

import type { CatalogEntry } from './entry'
import { duesStatusV1 } from './entries/dues-status-v1'

/**
 * Every entry, in no particular order.
 *
 * Exported so the tests can sweep it. An invariant asserted about `dues_status`
 * is an invariant the *second* entry is not held to, and nothing would say so.
 */
export const ALL_ENTRIES: readonly CatalogEntry[] = [duesStatusV1]

export class UnknownCatalogEntryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnknownCatalogEntryError'
  }
}

const reference = (id: string, version: number) => `${id}@${version}`

/**
 * Built once, at module load, and it throws on a duplicate rather than letting
 * the last registration win.
 *
 * Two entries sharing `(id, version)` is the one thing that would make AD-14
 * unenforceable from inside the process: the provenance log's pair would resolve
 * to two SQL texts, and which one ran would depend on array order. Failing at
 * load makes that a startup crash in front of whoever caused it, rather than an
 * audit trail that quietly stops meaning anything.
 */
const BY_REFERENCE: ReadonlyMap<string, CatalogEntry> = (() => {
  const map = new Map<string, CatalogEntry>()

  for (const entry of ALL_ENTRIES) {
    const key = reference(entry.id, entry.version)
    if (map.has(key)) {
      throw new Error(
        `the catalog holds two entries named ${key}; an entry version identifies exactly one SQL text (AD-14)`,
      )
    }
    map.set(key, entry)
  }

  return map
})()

/**
 * The entry a caller names, or a refusal that says which half was wrong.
 *
 * An unknown id and an unknown version are different mistakes and the messages
 * keep them apart: asking for `dues_status@2` is asking for SQL nobody has
 * written yet, which is a story, while asking for `dues_statuses@1` is a typo.
 */
export function entryFor(id: string, version: number): CatalogEntry {
  const entry = BY_REFERENCE.get(reference(id, version))
  if (entry) return entry

  const versions = versionsOf(id)
  if (versions.length === 0) {
    throw new UnknownCatalogEntryError(`the catalog holds no entry called ${id}`)
  }

  throw new UnknownCatalogEntryError(
    `${id} has no version ${version}; the catalog holds ${versions.join(', ')}`,
  )
}

/**
 * The highest version of an entry.
 *
 * Callers that want "the current one" ask here and then pass the explicit pair
 * to the executor, so the version that ran is the version that gets logged. The
 * executor never resolves "current" itself: a provenance row has to record the
 * version that actually executed, not the one that was current when somebody
 * later read the log.
 */
export function currentVersionOf(id: string): number {
  const versions = versionsOf(id)
  if (versions.length === 0) {
    throw new UnknownCatalogEntryError(`the catalog holds no entry called ${id}`)
  }

  return Math.max(...versions)
}

function versionsOf(id: string): number[] {
  return ALL_ENTRIES.filter((entry) => entry.id === id).map((entry) => entry.version)
}
