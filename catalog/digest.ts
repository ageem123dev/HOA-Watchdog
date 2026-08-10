/**
 * The fingerprint AD-14's freeze is enforced against.
 *
 * "Once a catalog entry version is used in production, its SQL text and
 * parameter schema are frozen. […] The provenance log's `(entry_id, version)`
 * pair must always resolve to exactly one SQL text, forever."
 *
 * A digest over the entry's **contract** — what it runs and what it accepts —
 * and deliberately not over the file. Two things follow from that choice, and
 * both are asserted in `published-versions.test.ts` rather than left as claims:
 *
 * - **What is in.** The SQL, each parameter's name and type, which parameters
 *   are required, and the binding order. Widen `assessmentYear` from `integer`
 *   to `string` and the digest moves, because the entry now accepts input it did
 *   not before while every provenance row still reads `dues_status@1`. That is
 *   the quieter half of the freeze and the half a SQL-only digest would miss.
 *
 * - **What is out.** Descriptions, and the order properties happen to be written
 *   in. A digest that moved on a reworded description or a reordered object
 *   would fire on edits that change nothing, and a check that cries wolf is one
 *   people learn to silence by pasting the new value in — which is the failure
 *   mode, not the fix.
 *
 * `sha256` because it is in the standard library and this is a change detector,
 * not a secret. Nothing here defends against someone who can edit both the entry
 * and the pinned digest; the diff is what defends against that, and pinning the
 * digest in a committed file is what puts it in the diff.
 */

import { createHash } from 'node:crypto'

import type { CatalogEntry } from './entry'

export function digestOf(entry: CatalogEntry): string {
  // Property names are sorted and `required` is sorted, because neither order is
  // part of the contract. `bind` is emphatically NOT sorted: its order *is* the
  // contract, mapping named parameters onto `$1 … $n`.
  const contract = {
    id: entry.id,
    version: entry.version,
    sql: entry.sql,
    bind: [...entry.bind],
    parameters: {
      type: entry.parameters.type,
      additionalProperties: entry.parameters.additionalProperties,
      required: [...entry.parameters.required].sort(),
      properties: Object.keys(entry.parameters.properties)
        .sort()
        .map((name) => [name, entry.parameters.properties[name]!.type]),
    },
  }

  return createHash('sha256').update(JSON.stringify(contract), 'utf8').digest('hex')
}
