/**
 * The catalog, projected down to what the reasoning model is allowed to see.
 *
 * AD-5: "The agent selects a named entry from a fixed, version-controlled query
 * catalog and supplies typed parameters. […] Free-form SQL from a model is never
 * executed."
 *
 * A `CatalogEntry` is the SQL text, the parameter schema, and the bind order. Of
 * those, a model choosing between entries needs the schema and needs to be told
 * what the entry is *for*. It needs neither the SQL nor the bind order, and the
 * epic's claim for story 3.4 — `no model-authored SQL is possible` — is a claim
 * about structure, so the structure is where it is enforced.
 *
 * ## Why this is written out field by field
 *
 * The obvious implementation is `{...entry}` with `sql` and `bind` deleted, and
 * it is the wrong one. A spread-and-delete is **open by default**: the field
 * somebody adds to `CatalogEntry` next year travels to the model unless they
 * remember to come back here, and nothing fails if they do not. Picking the four
 * fields explicitly inverts that — a new field stays put until somebody decides
 * it should not, and `agent-view.test.ts` pins the key set so the decision is
 * visible in a diff.
 *
 * This is the same instinct as AD-8's rule that "prompts carry row identifiers,
 * tools resolve values", one layer down: give the reasoning side the least that
 * lets it do its job.
 */

import type { CatalogEntry, ParameterSchema } from './entry'

/**
 * One entry as the model meets it.
 *
 * Not `Omit<CatalogEntry, 'sql' | 'bind'>`. That spelling looks tighter and is
 * looser: it is a subtraction, so it re-opens the moment a field is added, which
 * is the failure this whole module exists to prevent.
 */
export interface AgentFacingEntry {
  readonly id: string
  readonly version: number

  /** What the entry answers, in the words the model chooses on. */
  readonly description: string

  readonly parameters: ParameterSchema
}

export function agentViewOf(entry: CatalogEntry): AgentFacingEntry {
  return {
    id: entry.id,
    version: entry.version,
    description: entry.description,
    parameters: entry.parameters,
  }
}

export function agentViewOfCatalog(
  entries: readonly CatalogEntry[],
): readonly AgentFacingEntry[] {
  return entries.map(agentViewOf)
}
