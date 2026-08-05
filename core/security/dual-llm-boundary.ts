/**
 * AD-10 — the dual-LLM boundary is a **vendor** boundary.
 *
 * "Different vendor, different credential, different deploy unit. Raw document
 * bytes and raw extracted text never enter the reasoning context."
 *
 * Three clauses, and they are not the same clause said three ways. Two keys
 * pointing at one provider satisfies *different credential* and fails *different
 * vendor*. Two vendors running in one process satisfies both and fails
 * *different deploy unit*, which is the arrangement where a prompt injection in
 * a scanned invoice reaches the extraction credential.
 *
 * This module is the decision procedure. `dual-llm-boundary.test.ts` runs it
 * against the tracked manifest and against planted violations, so the boundary
 * is a failing test rather than a convention — the same standing as
 * `nfr2-guard.test.ts`. Narrowing either is an architecture change that needs a
 * new AD; neither is a cleanup and neither is a flaky test to quarantine.
 *
 * **The hardest thing here is not detecting a violation — it is being able to
 * fail at all.** The reasoning side does not exist yet, so every clause below
 * would pass by describing an empty world and go on passing until the day epic 2
 * merges the two sides. `VACUOUS` exists for that: if the manifest stops
 * declaring both sides, the guard reports a violation rather than finding no
 * conflict among nothing.
 */

export const BOUNDARY_VIOLATIONS = [
  'vacuous',
  'shared-unit',
  'shared-credential',
  'converged-origin',
  'module-reads-both',
] as const

export type BoundaryViolationKind = (typeof BOUNDARY_VIOLATIONS)[number]

export interface BoundaryViolation {
  readonly kind: BoundaryViolationKind
  readonly detail: string
}

export interface DeployUnit {
  readonly name: string
  readonly responsibilities: readonly string[]
  readonly credentials: readonly string[]
}

export interface BoundarySide {
  readonly responsibility: string
  readonly credentials: readonly string[]
  readonly origin: string
}

export interface DeployManifest {
  readonly units: readonly DeployUnit[]
  readonly sides: {
    readonly extraction: BoundarySide
    readonly reasoning: BoundarySide
  }
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Every way the declared topology breaks AD-10.
 *
 * Returns all of them rather than the first: a topology with two problems
 * should not need two runs to learn the second.
 */
export function boundaryViolations(manifest: DeployManifest): readonly BoundaryViolation[] {
  const violations: BoundaryViolation[] = []
  const { extraction, reasoning } = manifest.sides

  // C1 — the guard must be capable of failing. Checked before anything else,
  // because every check below is trivially satisfied by an empty side.
  if (extraction.credentials.length === 0 || reasoning.credentials.length === 0) {
    violations.push({
      kind: 'vacuous',
      detail:
        'Both sides must declare at least one credential. With either side empty, every check ' +
        'below passes by describing an empty world rather than by holding.',
    })
  }

  if (manifest.units.length === 0) {
    violations.push({ kind: 'vacuous', detail: 'The manifest declares no deploy units.' })
  }

  const extractionCredentials = new Set(extraction.credentials)
  const reasoningCredentials = new Set(reasoning.credentials)

  for (const unit of manifest.units) {
    // C3 — different deploy unit. The clause nothing checked before this.
    const doesExtraction = unit.responsibilities.includes(extraction.responsibility)
    const doesReasoning = unit.responsibilities.includes(reasoning.responsibility)

    if (doesExtraction && doesReasoning) {
      violations.push({
        kind: 'shared-unit',
        detail: `Deploy unit "${unit.name}" carries both ${extraction.responsibility} and ${reasoning.responsibility}.`,
      })
    }

    // C4 — a unit holding both credentials is the same failure by another
    // route, and survives someone relabelling the responsibilities.
    const holdsExtraction = unit.credentials.some((name) => extractionCredentials.has(name))
    const holdsReasoning = unit.credentials.some((name) => reasoningCredentials.has(name))

    if (holdsExtraction && holdsReasoning) {
      violations.push({
        kind: 'shared-credential',
        detail: `Deploy unit "${unit.name}" holds credentials for both sides.`,
      })
    }
  }

  // C5 — different vendor. Distinct credential names prove nothing about which
  // endpoint they authenticate against.
  const extractionHost = hostOf(extraction.origin)
  const reasoningHost = hostOf(reasoning.origin)

  if (extractionHost === null || reasoningHost === null) {
    violations.push({
      kind: 'converged-origin',
      detail: 'Both sides must declare a parsable absolute origin.',
    })
  } else if (extractionHost === reasoningHost) {
    violations.push({
      kind: 'converged-origin',
      detail: `Both sides point at ${extractionHost}. Different credentials at one vendor is not a vendor boundary.`,
    })
  }

  // A credential name shared outright between the two sides.
  for (const name of extractionCredentials) {
    if (reasoningCredentials.has(name)) {
      violations.push({
        kind: 'shared-credential',
        detail: `${name} is declared on both sides.`,
      })
    }
  }

  return violations
}

/**
 * C6 — no single module **reads** both sides' credentials.
 *
 * A module that reads both is one import away from passing extracted text into
 * a reasoning prompt, and no topology check can see that.
 *
 * **Reads, not mentions.** The first version of this matched the name anywhere
 * in the file, and immediately flagged `forbidden-credentials.test.ts` — which
 * lists both names in a fixture of credentials NFR-2 must *permit*. That file
 * reads neither. Matching bare mentions would also flag this module's own
 * documentation, every architecture note, and any test naming both.
 *
 * That is not a narrowing to make a failure go away; it is the difference
 * between the property meant and the property written. A detector that flags
 * legitimate mentions is the one `forbidden-credentials.ts` warns about in its
 * own header: it "gets deleted by the first developer it inconveniences", and
 * the guarantee dies with it. `readsEnvironmentVariable` states the real
 * property, and a test pins both directions.
 */
function readsEnvironmentVariable(text: string, name: string): boolean {
  // `process.env.NAME`, `process.env['NAME']`, `env.NAME`, `env["NAME"]`.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const access = String.raw`(?:process\s*\.\s*)?env\s*(?:\.\s*${escaped}\b|\[\s*['"\`]${escaped}['"\`]\s*\])`

  return new RegExp(access).test(text)
}

export function modulesReadingBothSides(
  sources: readonly { readonly path: string; readonly text: string }[],
  manifest: DeployManifest,
): readonly BoundaryViolation[] {
  const { extraction, reasoning } = manifest.sides
  const reads = (text: string, names: readonly string[]) =>
    names.some((name) => readsEnvironmentVariable(text, name))

  return sources
    .filter((source) => reads(source.text, extraction.credentials) && reads(source.text, reasoning.credentials))
    .map((source) => ({
      kind: 'module-reads-both' as const,
      detail: `${source.path} reads credentials on both sides of the boundary.`,
    }))
}
